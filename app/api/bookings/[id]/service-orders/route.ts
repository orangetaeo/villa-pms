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
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import {
  parseCatalogOptions,
  resolveOrderPricing,
  ServiceSelectionError,
} from "@/lib/service-catalog";
import { priceKrwCeil } from "@/lib/service-display";
import { getFxVndPerKrw } from "@/lib/pricing";
import { resolveOrderVendorId } from "@/lib/regional-vendor";
import { loadCanSellItem } from "@/lib/ticket-vendor-guard";
import { readVariantRule } from "@/lib/ticket-variant-rules";
import { validateTicketGuests } from "@/lib/ticket-order-validation";
import { loadCheckinRoster } from "@/lib/checkin-roster";
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
  // TICKET 이용자 선택 스냅샷(ADR-0036) — 게스트 라우트와 동일 shape. 이 예약의 체크인 확정본과 대조 검증(공유 lib).
  //   name은 OCR 미인식 시 null 가능. heightCm은 자가신고(무료/어린이 구분·현장 검표용, 선택). 최대 99인.
  ticketGuests: z
    .array(
      z.object({
        name: z.string().max(120).nullable(),
        birthDate: z.string().max(20).nullable(),
        heightCm: z.number().int().min(30).max(220).optional().nullable(),
      })
    )
    .max(99)
    .optional(),
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

  // TICKET 이용자 선택 스냅샷(ADR-0036) — 게스트 라우트와 동일 검증(공유 lib). 운영자는 이 예약의 체크인 확정본과 대조.
  //   선택 variant의 구분 규칙(있으면) — 명단 필수 판정 + 재검증에 공용(한 번만 파싱).
  const selectedVariantRule =
    item.type === "TICKET" && d.variantKey
      ? (() => {
          const vdef = (parseCatalogOptions(item.options).variants ?? []).find((x) => x.key === d.variantKey);
          return vdef ? readVariantRule(vdef) : null;
        })()
      : null;
  // 운영자 폼은 serviceDate가 선택 — 만나이 규칙 판정 기준일이 없으면 빈 문자열(관용 통과). 신장·출생년도 규칙은 그대로 강제.
  const ticketValidation = await validateTicketGuests({
    itemType: item.type,
    variantRule: selectedVariantRule,
    ticketGuests: d.ticketGuests,
    quantity: pricing.quantity,
    // 만나이 판정 기준일 — 명단 제공 + serviceDate 있을 때만 계산(운영자 폼은 날짜 선택).
    serviceDateOnly:
      d.ticketGuests && d.ticketGuests.length > 0 && serviceDate ? toDateOnlyString(serviceDate) : "",
    // 명단 정본 = 운영자 확정본 우선, 없으면 게스트 자동 OCR 잠정본(ADR-0043). 게스트 경로와 동일 원천.
    //   지연 로딩 보존 — 명단 미제공 시 이 콜백 미호출(체크인·토큰 조회 없음, 기존 동작).
    loadConfirmedGuests: () => loadCheckinRoster(prisma, id),
  });
  if (!ticketValidation.ok) {
    return NextResponse.json({ error: ticketValidation.error }, { status: 400 });
  }
  const ticketGuestsSnapshot: Prisma.InputJsonValue | undefined = ticketValidation.snapshot
    ? (ticketValidation.snapshot as unknown as Prisma.InputJsonValue)
    : undefined;

  // KRW 스냅샷 — 현재 환율로 VND→KRW 올림(미설정이면 0). VND가 진실원천.
  const fx = await getFxVndPerKrw(prisma);
  const priceKrw = fx ? priceKrwCeil(pricing.totalPriceVnd, fx) : 0;

  // ★지역 벤더 해석(ADR-0037) — MASSAGE·BARBER는 이 빌라의 지정 업체로 오버라이드, 그 외/미지정은 카탈로그 기본.
  const resolvedVendorId = await resolveOrderVendorId({
    itemType: item.type,
    itemVendorId: item.vendorId,
    villaId: booking.villaId,
  });

  // ★TICKET 판매가능 벤더 가드(계약 ticket-vendor-required-sale-block) — 게스트 라우트와 대칭. 해석된 벤더가
  //   승인·활성이 아니면 판매(주문 생성) 자체를 차단(티켓은 벤더 QR 발행 없이는 이행 불가). 무료 티켓 포함 품목
  //   단위 차단(부분 허용 없음). 비TICKET은 조회 없이 통과. TICKET은 resolvedVendorId로 승인·활성만 조회(누수 0).
  if (!(await loadCanSellItem({ itemType: item.type, resolvedVendorId }, prisma))) {
    return NextResponse.json({ error: "TICKET_VENDOR_REQUIRED" }, { status: 400 });
  }

  // ★무료 티켓(판매가 0 — 무료/유아 variant) — 업체 QR 발행·발주함 불필요(테오, 게스트 경로 준용).
  //   생성 시점 즉시 확정(CONFIRMED)+수락(VENDOR_ACCEPTED)으로 세팅해 발주함을 미경유한다(할 일 없음).
  const isFreeTicket = item.type === "TICKET" && pricing.totalPriceVnd === 0n;
  // TICKET은 이용일만(시간 미저장, 테오 2026-07-12) — 오전/오후/야간 구분은 카탈로그 variant로. 그 외는 현행(선택 시간 저장).
  const serviceTimeToSave = item.type === "TICKET" ? null : (d.serviceTime ?? null);
  const now = new Date();

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: id,
      type: item.type,
      // 무료 티켓은 생성 시점 즉시 확정(발주함 미경유), 그 외는 요청 status(기본 REQUESTED).
      status: isFreeTicket ? ("CONFIRMED" as const) : (d.status ?? "REQUESTED"),
      serviceDate,
      serviceTime: serviceTimeToSave,
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
      // TICKET 이용자 선택 스냅샷(이름·생년월일·신장) — 미선택·비TICKET이면 미저장(null).
      ...(ticketGuestsSnapshot ? { ticketGuests: ticketGuestsSnapshot } : {}),
      // 무료 티켓 — 즉시 확정+수락 원자 세팅. 발주함 미경유·발행 불필요(벤더 예약현황 정보 노출로 충분).
      ...(isFreeTicket
        ? { vendorStatus: "VENDOR_ACCEPTED" as const, poSentAt: now, vendorRespondedAt: now }
        : {}),
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
      // 무료 티켓 즉시 확정 경로만 상태 기록(운영자 일반 생성과 감사 이력 구분)
      ...(isFreeTicket
        ? {
            status: { new: "CONFIRMED" },
            vendorStatus: { new: "VENDOR_ACCEPTED" },
            poSentAt: { new: now.toISOString() },
            vendorRespondedAt: { new: now.toISOString() },
          }
        : {}),
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
