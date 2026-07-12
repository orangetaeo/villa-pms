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
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import type { Prisma } from "@prisma/client";
import { notifyOperatorsServiceOrderRequested } from "@/lib/consumer-signal-notify";
import { sendVendorPoNotifications } from "@/lib/vendor-dispatch";
import { resolveOrderVendorId } from "@/lib/regional-vendor";
import { guestsFromPassportOcr, ticketGuestKey } from "@/lib/ticket-guests";
import { readVariantRule, ruleHasAny, validateGuestForVariant } from "@/lib/ticket-variant-rules";

const schema = z.object({
  catalogItemId: z.string().min(1).max(40),
  variantKey: z.string().max(40).optional().nullable(),
  addonKeys: z.array(z.string().max(40)).max(60).optional(),
  modifierKeys: z.array(z.string().max(40)).max(40).optional(),
  quantity: z.number().int().min(1).max(99),
  // 게스트 신청은 희망 날짜 필수. 시간은 optional(품목 type 기준 서버 재검증) — TICKET은 이용일만(테오 2026-07-12).
  serviceDate: z.string().min(1),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  guestNote: z.string().max(500).optional().nullable(),
  // ★이용자 이름 — 서비스 받으실 분(예약 대표자와 다를 수 있음). 빈값이면 서버가 대표자(guestName) 폴백.
  customerName: z.string().max(80).optional().nullable(),
  // TICKET 이용자 선택 스냅샷(ADR-0036) — 소비자가 체크인 명단에서 고른 이용자(이름·생년월일·신장만).
  //   name은 OCR 미인식 시 null 가능. heightCm은 소비자 자가신고(무료/어린이 구분·현장 검표용, 선택).
  //   서버가 체크인 확정본과 대조 검증(주입 방지). ★허용 필드는 name·birthDate·heightCm 3개뿐. 최대 99인.
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

  // 시간 정책(테오 2026-07-12) — 비TICKET은 희망 시간 필수(기존 계약 유지). TICKET은 이용일만(시간 null 허용·저장).
  if (item.type !== "TICKET" && !d.serviceTime) {
    return NextResponse.json({ error: "SERVICE_TIME_REQUIRED" }, { status: 400 });
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

  // 선택 variant의 구분 규칙(있으면) — 명단 필수 판정 + 재검증에 공용(한 번만 파싱).
  const selectedVariantRule =
    item.type === "TICKET" && d.variantKey
      ? (() => {
          const vdef = (parseCatalogOptions(item.options).variants ?? []).find((x) => x.key === d.variantKey);
          return vdef ? readVariantRule(vdef) : null;
        })()
      : null;
  // ★가격 조작 우회 차단(QA) — 규칙 있는 variant(child/free/senior 등)는 이용자 명단이 필수다.
  //   명단을 아예 생략하고 규칙 variant 단가로 POST하면 아래 스냅샷 블록을 안 타 RULE_MISMATCH가 우회되므로,
  //   variant에 규칙이 하나라도 있으면 여기서 명단 존재를 강제한다. 규칙 없는 기본 variant·비TICKET은 현행(명단 없이 가능).
  if (selectedVariantRule && ruleHasAny(selectedVariantRule) && (!d.ticketGuests || d.ticketGuests.length === 0)) {
    return NextResponse.json({ error: "TICKET_GUESTS_REQUIRED" }, { status: 400 });
  }

  // ── TICKET 이용자 선택 스냅샷(ADR-0036) — TICKET 품목 + 제공 + 비어있지 않을 때만 검증·저장.
  //   비TICKET 품목에 온 ticketGuests는 무시(저장 안 함) — 잘못된 클라 입력에 관용.
  let ticketGuestsSnapshot: Prisma.InputJsonValue | undefined;
  if (item.type === "TICKET" && d.ticketGuests && d.ticketGuests.length > 0) {
    // 수량 일치 강제 — 선택 인원 수 = 발권 수량(quantity). variant별로 분리 주문되므로 그룹 인원수와 정합.
    if (d.ticketGuests.length !== pricing.quantity) {
      return NextResponse.json({ error: "TICKET_GUEST_COUNT_MISMATCH" }, { status: 400 });
    }
    // 스냅샷 정규화 — 허용 필드 name·birthDate·heightCm만(자가신고 신장은 있을 때만 부착).
    const clean = d.ticketGuests.map((g) => ({
      name: g.name ?? null,
      birthDate: g.birthDate ?? null,
      ...(typeof g.heightCm === "number" ? { heightCm: g.heightCm } : {}),
    }));
    // 주문 내 중복 인원 방지(QA 관찰 엣지) — 같은 name+birthDate 쌍이 2회 이상이면 400.
    const dupKeys = clean.map(ticketGuestKey);
    if (new Set(dupKeys).size !== dupKeys.length) {
      return NextResponse.json({ error: "TICKET_GUEST_DUPLICATE" }, { status: 400 });
    }
    // PII 주입 방지 — 각 원소가 체크인 확정본(passportOcrJson) 명단에 정확히 존재해야 함(name+birthDate 쌍).
    const ci = await prisma.checkInRecord.findUnique({
      where: { bookingId: t.bookingId },
      select: { passportOcrJson: true },
    });
    const confirmedKeys = new Set(guestsFromPassportOcr(ci?.passportOcrJson).map(ticketGuestKey));
    if (!clean.every((g) => confirmedKeys.has(ticketGuestKey(g)))) {
      return NextResponse.json({ error: "TICKET_GUEST_MISMATCH" }, { status: 400 });
    }
    // 구분(variant) 규칙 재검증(가격 조작 방지, ADR-0036 개정) — 제출 variantKey에 규칙이 있으면
    //   각 이용자가 이용일 기준으로 그 구분에 맞아야. 출생년도·만나이는 birthDate null이면 통과(자가신고 폴백),
    //   신장 규칙이면 heightCm 필수+상한 미만. 규칙 없는 기본(성인) variant는 검증 없음(위에서 명단 필수도 안 검).
    if (selectedVariantRule && ruleHasAny(selectedVariantRule)) {
      const onDate = toDateOnlyString(serviceDate);
      const bad = clean.some(
        (g) =>
          !validateGuestForVariant(selectedVariantRule, {
            birthDate: g.birthDate,
            heightCm: typeof g.heightCm === "number" ? g.heightCm : null,
            serviceDate: onDate,
          })
      );
      if (bad) return NextResponse.json({ error: "TICKET_GUEST_RULE_MISMATCH" }, { status: 400 });
    }
    ticketGuestsSnapshot = clean as unknown as Prisma.InputJsonValue;
  }

  // KRW 스냅샷 — 현재 환율로 VND→KRW 올림(미설정이면 0). VND가 진실원천.
  const fx = await getFxVndPerKrw(prisma);
  const priceKrw = fx ? priceKrwCeil(pricing.totalPriceVnd, fx) : 0;

  // 빌라 정보(운영자 A1 통지 + 벤더 발주 통보 공용) + 예약 대표자 이름(이용자 이름 폴백) + villaId(지역 벤더 해석).
  //   ★create 이전에 조회 — 이용자 이름 폴백(guestName)·지역 벤더 해석이 create data에 들어가야 하므로. best-effort.
  const bookingInfo = await prisma.booking.findUnique({
    where: { id: t.bookingId },
    select: { guestName: true, villa: { select: { id: true, name: true, address: true } } },
  });
  // ★이용자 이름 — 게스트 입력값(trim) 우선, 없으면 예약 대표자(guestName) 폴백. 항상 값이 차도록.
  const customerName = (d.customerName?.trim() || null) ?? bookingInfo?.guestName ?? null;

  // ★지역 벤더 해석(ADR-0037) — MASSAGE·BARBER는 이 빌라의 지정 업체로 오버라이드, 그 외/미지정은 카탈로그 기본(item.vendorId).
  const resolvedVendorId = await resolveOrderVendorId({
    itemType: item.type,
    itemVendorId: item.vendorId,
    villaId: bookingInfo?.villa.id ?? null,
  });

  // ★자동 발주 판정 대상 벤더 — 카탈로그 기본과 다른 업체로 오버라이드됐으면, 그 업체 엔티티를 같은 select로
  //   재조회해 승인·활성·Zalo 판정과 발송 대상을 함께 교체한다(item.vendor는 카탈로그 기본이라 잘못된 대상).
  let dispatchVendor = item.vendor;
  if (resolvedVendorId && resolvedVendorId !== item.vendorId) {
    dispatchVendor = await prisma.serviceVendor.findUnique({
      where: { id: resolvedVendorId },
      // ★ bankInfo·마진 미select(누수 0) — 자동 발주 판정·통보에 필요한 최소 필드만.
      select: {
        id: true,
        userId: true,
        approvalStatus: true,
        active: true,
        user: { select: { zaloUserId: true, locale: true } },
      },
    });
  }

  // ★무료 티켓(판매가 0 — 무료/유아 variant) — 업체 QR 발행·소비자 제시 불필요(테오). 그냥 입장.
  //   발주함(발행 완료 게이트) 대상이 되면 불필요한 업무가 생기므로, 생성 시점에 즉시 확정·수락으로 세팅하고
  //   발주함을 미경유한다(벤더 발주 통보 생략 — 벤더 예약현황 정보 노출로 충분). 운영자 A1 알림은 유지.
  const isFreeTicket = item.type === "TICKET" && pricing.totalPriceVnd === 0n;

  // ★자동 발주 조건 — 해석된 벤더 배정 + 승인(APPROVED) + 활성(active). 하나라도 아니면 REQUESTED만(수동 폴백).
  //   무료 티켓은 자동 발주 대상에서 제외(아래 무료 확정 경로가 우선) — PENDING_VENDOR·발주 통보를 타지 않게.
  const autoDispatch =
    !isFreeTicket &&
    !!resolvedVendorId &&
    dispatchVendor?.approvalStatus === "APPROVED" &&
    dispatchVendor?.active === true;
  const now = new Date();

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: t.bookingId,
      type: item.type,
      // 무료 티켓은 생성 시점 즉시 확정(발주함 미경유), 그 외는 REQUESTED(운영자 확정 대기).
      status: isFreeTicket ? ("CONFIRMED" as const) : ("REQUESTED" as const),
      serviceDate,
      serviceTime: d.serviceTime ?? null,
      costVnd: 0n, // 운영자 확정 시 실원가 입력
      priceKrw,
      priceVnd: pricing.totalPriceVnd,
      catalogItemId: item.id,
      vendorId: resolvedVendorId, // 원천 공급자 스냅샷 — 지역 지정 업체 해석 결과 (ADR-0037·ADR-0023 §4.3)
      quantity: pricing.quantity,
      selectedOptions: pricing.snapshot as unknown as Prisma.InputJsonValue,
      requestedVia: "GUEST",
      guestNote: d.guestNote ?? null,
      customerName, // ★이용자 이름 스냅샷(입력 또는 대표자 폴백) — 벤더 발주 문구·보드 노출용
      // TICKET 이용자 선택 스냅샷(이름·생년월일만) — 벤더 보드 표시용(ADR-0036). 미선택·비TICKET이면 미저장(null).
      ...(ticketGuestsSnapshot ? { ticketGuests: ticketGuestsSnapshot } : {}),

      // ★무료 티켓 — 생성 시점 즉시 확정(CONFIRMED)+수락(VENDOR_ACCEPTED) 원자 세팅. 발주함 미경유·발행 불필요.
      //   vendorId는 위에서 정상 스냅샷(resolvedVendorId) — 벤더 예약현황 정보 노출용.
      //   그 외: 자동 발주면 PENDING_VENDOR(생성 신규 행이라 동시성 가드 불필요), 벤더가 /vendor에서 수락하면 확정.
      ...(isFreeTicket
        ? {
            vendorStatus: "VENDOR_ACCEPTED" as const,
            poSentAt: now,
            vendorRespondedAt: now,
          }
        : autoDispatch
          ? { vendorStatus: "PENDING_VENDOR" as const, poSentAt: now }
          : {}),
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
      // 무료 확정·자동 발주된 경우만 관련 필드 기록(운영자 수동 발주와 감사 이력 구분)
      ...(isFreeTicket
        ? {
            status: { new: "CONFIRMED" },
            vendorStatus: { new: "VENDOR_ACCEPTED" },
            poSentAt: { new: now.toISOString() },
            vendorRespondedAt: { new: now.toISOString() },
          }
        : autoDispatch
          ? { vendorStatus: { new: "PENDING_VENDOR" }, poSentAt: { new: now.toISOString() } }
          : {}),
    },
  });

  // ★자동 발주 통보 — 벤더 Zalo(연결 시) + 인앱. costVnd=0이므로 payload costVnd=null(미확정).
  //   ★무료 티켓은 autoDispatch=false라 이 통보를 타지 않는다(할 일 아님 — 벤더 예약현황 정보 노출로 충분).
  if (autoDispatch) {
    await sendVendorPoNotifications({
      vendor: dispatchVendor,
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
