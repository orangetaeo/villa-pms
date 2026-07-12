// /api/bookings/[id]/service-orders — 예약별 부가서비스 주문 (ADR-0019 S2, 운영자 직접 생성)
//   POST: 카탈로그 항목 + 선택 옵션 → 서버가 가격 재계산(변조 방지) → ServiceOrder 생성.
//   GET: 예약의 주문 목록(원가 costVnd는 canViewFinance만).
//   게스트 셀프 요청(requestedVia=GUEST)은 S3의 토큰 경로에서 별도 — 여기는 운영자(세션) 전용.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, type Role } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { parseUtcDateOnly } from "@/lib/date-vn";
import {
  parseCatalogOptions,
  resolveOrderPricing,
  ServiceSelectionError,
} from "@/lib/service-catalog";
import { priceKrwCeil } from "@/lib/service-display";
import { getFxVndPerKrw } from "@/lib/pricing";
import { resolveOrderVendorId } from "@/lib/regional-vendor";
import type { Prisma } from "@prisma/client";

const createSchema = z.object({
  catalogItemId: z.string().min(1).max(40),
  variantKey: z.string().max(40).optional().nullable(),
  addonKeys: z.array(z.string().max(40)).max(60).optional(),
  modifierKeys: z.array(z.string().max(40)).max(40).optional(),
  quantity: z.number().int().min(1).max(999),
  serviceDate: z.string().optional().nullable(),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  guestNote: z.string().max(500).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  status: z.enum(["REQUESTED", "CONFIRMED"]).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isOperator(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const showCost = canViewFinance(role);
  const { id } = await params;

  const orders = await prisma.serviceOrder.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "desc" },
    include: { vendor: { select: { name: true } } },
  });
  const data = orders.map((o) => ({
    id: o.id,
    type: o.type,
    status: o.status,
    serviceDate: o.serviceDate,
    serviceTime: o.serviceTime,
    priceKrw: o.priceKrw,
    priceVnd: o.priceVnd?.toString() ?? null,
    quantity: o.quantity,
    selectedOptions: o.selectedOptions,
    requestedVia: o.requestedVia,
    guestNote: o.guestNote,
    vendorName: o.vendorName,
    note: o.note,
    createdAt: o.createdAt,
    // ADR-0023 S2 — 발주 게이트 상태(운영자 패널). vendorName은 자유입력·vendor.name은 거래처 마스터.
    vendorId: o.vendorId,
    vendorDisplayName: o.vendor?.name ?? o.vendorName ?? null,
    vendorStatus: o.vendorStatus,
    poSentAt: o.poSentAt,
    vendorRespondedAt: o.vendorRespondedAt,
    vendorRejectReason: o.vendorRejectReason,
    vendorSettledAt: o.vendorSettledAt,
    vendorSettleMethod: o.vendorSettleMethod,
    ...(showCost ? { costVnd: o.costVnd.toString() } : {}),
  }));
  return NextResponse.json({ orders: data });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const actorId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  let serviceDate: Date | null = null;
  if (d.serviceDate != null && d.serviceDate !== "") {
    serviceDate = parseUtcDateOnly(d.serviceDate);
    if (serviceDate === null) {
      return NextResponse.json({ error: "INVALID_SERVICE_DATE" }, { status: 400 });
    }
  }

  const booking = await prisma.booking.findUnique({ where: { id }, select: { id: true, status: true, villaId: true } });
  if (!booking) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  // 종결(취소·만료·노쇼)된 예약엔 주문 추가 불가 — 죽은 예약의 서비스 진행 방지 (A5)
  if (["CANCELLED", "EXPIRED", "NO_SHOW"].includes(booking.status)) {
    return NextResponse.json({ error: "BOOKING_CLOSED", bookingStatus: booking.status }, { status: 409 });
  }

  const item = await prisma.serviceCatalogItem.findUnique({ where: { id: d.catalogItemId } });
  if (!item || !item.active) {
    return NextResponse.json({ error: "CATALOG_ITEM_NOT_FOUND" }, { status: 404 });
  }

  // 서버 가격 재계산(클라 금액 신뢰 금지) — VND 단일통화. 알 수 없는 옵션 key·수량 위반은 거부
  let pricing;
  try {
    pricing = resolveOrderPricing(
      { priceVnd: item.priceVnd },
      parseCatalogOptions(item.options),
      {
        variantKey: d.variantKey,
        addonKeys: d.addonKeys,
        modifierKeys: d.modifierKeys,
        quantity: d.quantity,
      }
    );
  } catch (e) {
    if (e instanceof ServiceSelectionError) {
      return NextResponse.json({ error: "INVALID_SELECTION", code: e.code }, { status: 400 });
    }
    throw e;
  }

  // KRW 스냅샷 — 현재 환율로 VND→KRW 올림(미설정이면 0). VND가 진실원천.
  const fx = await getFxVndPerKrw(prisma);
  const priceKrw = fx ? priceKrwCeil(pricing.totalPriceVnd, fx) : 0;

  // ★지역 벤더 해석(ADR-0037) — MASSAGE·BARBER는 이 빌라의 지정 업체로 오버라이드, 그 외/미지정은 카탈로그 기본.
  const resolvedVendorId = await resolveOrderVendorId({
    itemType: item.type,
    itemVendorId: item.vendorId,
    villaId: booking.villaId,
  });

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: id,
      type: item.type,
      status: d.status ?? "REQUESTED",
      serviceDate,
      serviceTime: d.serviceTime ?? null,
      // 원가는 운영자 확정 단계에서 입력(PATCH) — 생성 시 0 placeholder
      costVnd: 0n,
      priceKrw,
      priceVnd: pricing.totalPriceVnd,
      catalogItemId: item.id,
      vendorId: resolvedVendorId, // 원천 공급자 스냅샷 — 지역 지정 업체 해석 결과 (ADR-0037·ADR-0023 §4.3)
      quantity: pricing.quantity,
      selectedOptions: pricing.snapshot as unknown as Prisma.InputJsonValue,
      requestedVia: "ADMIN",
      guestNote: d.guestNote ?? null,
      note: d.note ?? null,
    },
    select: { id: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "CREATE",
    entity: "ServiceOrder",
    entityId: created.id,
    changes: {
      bookingId: { new: id },
      catalogItemId: { new: item.id },
      priceKrw: { new: priceKrw },
      priceVnd: { new: pricing.totalPriceVnd.toString() },
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
