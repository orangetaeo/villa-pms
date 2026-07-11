// POST /api/g/[token]/service-orders — 게스트 셀프 부가옵션 요청 (ADR-0019 v2 · ADR-0033 직접 발주)
//   비로그인(토큰). 서버가 카탈로그 기준으로 가격 재계산(클라 금액 신뢰 금지, §9.5) — VND 단일통화.
//   priceVnd 스냅샷 + priceKrw=priceKrwCeil(totalVnd, fx) 스냅샷 저장(현재 환율, 미설정이면 0).
//   상태=REQUESTED, requestedVia=GUEST, costVnd=0(운영자 확정 시 입력). 결제 없음 — 체크아웃 정산.
//   ★자동 발주(테오 지시): 카탈로그 벤더가 승인(APPROVED)·활성(active)이면 생성 시점에 즉시
//     vendorStatus=PENDING_VENDOR·poSentAt 세팅 + 벤더 Zalo/인앱 발주 통보(운영자 수동 dispatch 불필요).
//     벤더 미배정·미승인·비활성이면 현행대로 REQUESTED만 생성(운영자 수동 폴백). 운영자 A1 알림은 유지(정보성).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit } from "@/lib/guest-rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { parseCatalogOptions, resolveOrderPricing, ServiceSelectionError, parseAudiences } from "@/lib/service-catalog";
import { priceKrwCeil } from "@/lib/service-display";
import { getFxVndPerKrw } from "@/lib/pricing";
import { parseUtcDateOnly } from "@/lib/date-vn";
import type { Prisma } from "@prisma/client";
import { notifyOperatorsServiceOrderRequested } from "@/lib/consumer-signal-notify";
import { sendVendorPoNotifications } from "@/lib/vendor-dispatch";

const schema = z.object({
  catalogItemId: z.string().min(1).max(40),
  variantKey: z.string().max(40).optional().nullable(),
  addonKeys: z.array(z.string().max(40)).max(60).optional(),
  modifierKeys: z.array(z.string().max(40)).max(40).optional(),
  quantity: z.number().int().min(1).max(99),
  // 게스트 신청은 희망 날짜·시간 필수 — 배송/예약 시간대 확정용(미입력 저장 방지)
  serviceDate: z.string().min(1),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/),
  guestNote: z.string().max(500).optional().nullable(),
  // ★이용자 이름 — 서비스 받으실 분(예약 대표자와 다를 수 있음). 빈값이면 서버가 대표자(guestName) 폴백.
  customerName: z.string().max(80).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 비인증 게스트 mutation 폭주 방어 (보안 P0-3)
  const rl = await guestRateLimit("g-service-orders", token, req);
  if (rl) return rl;
  const csrf = await assertSameOrigin(req, "g-service-orders");
  if (csrf) return csrf;
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true, firstUsedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const serviceDate = parseUtcDateOnly(d.serviceDate);
  if (serviceDate === null) {
    return NextResponse.json({ error: "INVALID_SERVICE_DATE" }, { status: 400 });
  }

  const item = await prisma.serviceCatalogItem.findUnique({
    where: { id: d.catalogItemId },
    // 자동 발주 판정용 벤더 관계 — 승인·활성·Zalo 연결 여부. ★ bankInfo·마진 미select(누수 0).
    include: {
      vendor: {
        select: {
          id: true,
          userId: true,
          approvalStatus: true,
          active: true,
          user: { select: { zaloUserId: true, locale: true } },
        },
      },
    },
  });
  // 게스트 자격(GUEST) 항목만 주문 가능 — 과일 바구니 등 PARTNER 전용은 차단(ADR-0023 §9.2, id 추측 방지).
  if (!item || !item.active || !parseAudiences(item.audiences).includes("GUEST")) {
    return NextResponse.json({ error: "CATALOG_ITEM_NOT_FOUND" }, { status: 404 });
  }

  let pricing;
  try {
    pricing = resolveOrderPricing(
      { priceVnd: item.priceVnd },
      parseCatalogOptions(item.options),
      { variantKey: d.variantKey, addonKeys: d.addonKeys, modifierKeys: d.modifierKeys, quantity: d.quantity }
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

  // ★자동 발주 조건 — 벤더 배정 + 승인(APPROVED) + 활성(active). 하나라도 아니면 REQUESTED만(수동 폴백).
  const vendor = item.vendor;
  const autoDispatch =
    !!item.vendorId && vendor?.approvalStatus === "APPROVED" && vendor?.active === true;
  const now = new Date();

  // 빌라 정보(운영자 A1 통지 + 벤더 발주 통보 공용) + 예약 대표자 이름(이용자 이름 폴백).
  //   ★create 이전에 조회 — 이용자 이름 폴백(guestName)이 create data에 들어가야 하므로. best-effort.
  const bookingInfo = await prisma.booking.findUnique({
    where: { id: t.bookingId },
    select: { guestName: true, villa: { select: { name: true, address: true } } },
  });
  // ★이용자 이름 — 게스트 입력값(trim) 우선, 없으면 예약 대표자(guestName) 폴백. 항상 값이 차도록.
  const customerName = (d.customerName?.trim() || null) ?? bookingInfo?.guestName ?? null;

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: t.bookingId,
      type: item.type,
      status: "REQUESTED",
      serviceDate,
      serviceTime: d.serviceTime ?? null,
      costVnd: 0n, // 운영자 확정 시 실원가 입력
      priceKrw,
      priceVnd: pricing.totalPriceVnd,
      catalogItemId: item.id,
      vendorId: item.vendorId, // 원천 공급자 스냅샷 (ADR-0023 §4.3)
      quantity: pricing.quantity,
      selectedOptions: pricing.snapshot as unknown as Prisma.InputJsonValue,
      requestedVia: "GUEST",
      guestNote: d.guestNote ?? null,
      customerName, // ★이용자 이름 스냅샷(입력 또는 대표자 폴백) — 벤더 발주 문구·보드 노출용

      // ★자동 발주 — 생성 시점이라 동시성 가드 불필요(신규 행). 벤더가 /vendor에서 수락하면 자동 확정.
      ...(autoDispatch ? { vendorStatus: "PENDING_VENDOR" as const, poSentAt: now } : {}),
    },
    select: { id: true },
  });

  if (t.firstUsedAt == null) {
    await prisma.guestCheckinToken.update({ where: { token }, data: { firstUsedAt: new Date() } });
  }

  await writeAuditLog({
    db: prisma,
    userId: null,
    action: "CREATE",
    entity: "ServiceOrder",
    entityId: created.id,
    changes: {
      requestedVia: { new: "GUEST" },
      catalogItemId: { new: item.id },
      // 자동 발주된 경우만 발주 필드 기록(운영자 수동 발주와 감사 이력 구분)
      ...(autoDispatch
        ? { vendorStatus: { new: "PENDING_VENDOR" }, poSentAt: { new: now.toISOString() } }
        : {}),
    },
  });

  // ★자동 발주 통보 — 벤더 Zalo(연결 시) + 인앱. costVnd=0이므로 payload costVnd=null(미확정).
  if (autoDispatch) {
    await sendVendorPoNotifications({
      vendor,
      villaName: bookingInfo?.villa.name ?? null,
      villaAddress: bookingInfo?.villa.address ?? null,
      serviceDate,
      serviceTime: d.serviceTime ?? null,
      itemName: item.nameKo,
      quantity: pricing.quantity,
      selectedOptions: pricing.snapshot,
      costVnd: 0n,
      guestNote: d.guestNote ?? null,
      customerName, // ★이용자 이름 — 벤더가 응대 대상 식별용(이름만)
    });
  }

  // 운영자 Zalo 통지 (A1) — 요청이 예약 상세에만 묻히지 않게(자동 발주 여부와 무관하게 유지). best-effort.
  await notifyOperatorsServiceOrderRequested(prisma, {
    bookingId: t.bookingId,
    orderId: created.id,
    villaName: bookingInfo?.villa.name ?? "-",
    serviceName: item.nameKo,
    quantity: pricing.quantity,
    serviceDate: d.serviceDate,
    serviceTime: d.serviceTime ?? null,
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
