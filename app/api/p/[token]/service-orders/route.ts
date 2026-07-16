// POST /api/p/[token]/service-orders — 파트너(여행사/랜드사) 부가서비스 요청 (ADR-0023 S4, §5)
//
//   비로그인(제안 토큰). /g 게스트 라우트를 미러하되 다음만 다르다:
//   - 스코프: token→proposal→이 booking이 그 proposal 소속인지(done/roster 페이지와 동일 교차 토큰 가드).
//     + 제안 만료(expiresAt 경과)면 요청 불가(410). 상태 HOLD·CONFIRMED만.
//   - audience: 카탈로그는 PARTNER 자격 항목만 주문 가능(과일 바구니·도시락 등). GUEST 전용·id 추측 차단.
//   - requestedVia=PARTNER. 그 외 가격 재계산·변조 방지·VND/KRW 듀얼 스냅샷은 /g와 동일.
//   ★ 누수: 응답에 costVnd·vendorId·마진 미포함. vendorId는 발주 스냅샷으로 저장만(S2 dispatch가 사용).
import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import {
  parseCatalogOptions,
  resolveOrderPricing,
  ServiceSelectionError,
  parseAudiences,
} from "@/lib/service-catalog";
import { priceKrwCeil } from "@/lib/service-display";
import { getFxVndPerKrw } from "@/lib/pricing";
import { resolveOrderVendorId } from "@/lib/regional-vendor";
import { loadCanSellItem } from "@/lib/ticket-vendor-guard";
import { parseUtcDateOnly } from "@/lib/date-vn";
import type { Prisma } from "@prisma/client";
import { notifyOperatorsServiceOrderRequested } from "@/lib/consumer-signal-notify";
import { SERVICE_LIABILITY_VERSION } from "@/lib/service-liability";
import { isPublicLang } from "@/lib/public-i18n";

// 공개·미인증 엔드포인트 폭주 방어 (T-sec-public-hardening — hold/roster 라우트와 동일 모델)
const ORDER_TOKEN_LIMIT = { max: 40, windowMs: 10 * 60_000 };
const ORDER_IP_LIMIT = { max: 80, windowMs: 10 * 60_000 };

const schema = z.object({
  bookingId: z.string().min(1),
  catalogItemId: z.string().min(1).max(40),
  variantKey: z.string().max(40).optional().nullable(),
  addonKeys: z.array(z.string().max(40)).max(60).optional(),
  modifierKeys: z.array(z.string().max(40)).max(40).optional(),
  quantity: z.number().int().min(1).max(99),
  serviceDate: z.string().optional().nullable(),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  guestNote: z.string().max(500).optional().nullable(),
  // ★책임 제한 고지 동의 (계약 service-order-liability-consent) — /g와 대칭. version·locale은 서버 산출.
  liabilityConsent: z.boolean().optional(),
  locale: z.string().max(10).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // 교차출처 위조 차단 (보안 P1-S9)
  const csrf = await assertSameOrigin(req, "p-service-orders");
  if (csrf) return csrf;

  const ip = clientIp(req.headers);
  const tokenOk = checkRateLimit(`p-order:token:${token}`, ORDER_TOKEN_LIMIT).allowed;
  const ipOk = ip ? checkRateLimit(`p-order:ip:${ip}`, ORDER_IP_LIMIT).allowed : true;
  if (!tokenOk || !ipOk) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
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

  // ★책임 제한 고지 동의 게이트 (계약 service-order-liability-consent) — /g와 대칭. 미동의면 생성 거부(스냅샷 미저장).
  //   서버가 version(상수)·locale(표시언어 검증, 미지원=en)·source를 산출 — 클라 값은 동의 플래그·표시언어만 사용.
  if (d.liabilityConsent !== true) {
    return NextResponse.json({ error: "CONSENT_REQUIRED" }, { status: 400 });
  }
  const liabilityConsentJson = {
    agreedAt: new Date().toISOString(),
    version: SERVICE_LIABILITY_VERSION,
    locale: isPublicLang(d.locale) ? d.locale : "en",
    source: "partner" as const,
  };

  // 교차 토큰 가드 — bookingId가 이 token의 제안 소속인지 (done/roster 페이지·hold route와 동일 패턴)
  const booking = await prisma.booking.findUnique({
    where: { id: d.bookingId },
    select: {
      id: true,
      status: true,
      channel: true,
      villaId: true,
      proposalItem: {
        select: { proposal: { select: { token: true, expiresAt: true } } },
      },
    },
  });
  if (!booking || booking.proposalItem?.proposal.token !== token) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 만료된 제안 + 체크인 이후·취소는 요청 불가 (ADR-0022 파트너 포털이 정식 홈 — 만료 후엔 재발급)
  if (booking.proposalItem.proposal.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  }
  if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
    return NextResponse.json({ error: "CLOSED" }, { status: 409 });
  }

  let serviceDate: Date | null = null;
  if (d.serviceDate != null && d.serviceDate !== "") {
    serviceDate = parseUtcDateOnly(d.serviceDate);
    if (serviceDate === null) {
      return NextResponse.json({ error: "INVALID_SERVICE_DATE" }, { status: 400 });
    }
  }

  const item = await prisma.serviceCatalogItem.findUnique({ where: { id: d.catalogItemId } });
  // 파트너 자격(PARTNER) 항목만 주문 가능 — GUEST 전용은 차단(과일 바구니는 PARTNER 포함이라 OK, id 추측 방지).
  if (!item || !item.active || !parseAudiences(item.audiences).includes("PARTNER")) {
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

  // KRW 스냅샷 — 현재 환율로 VND→KRW 올림(미설정이면 0). VND가 진실원천(saleCurrency 무관 듀얼 저장, /g 동일).
  const fx = await getFxVndPerKrw(prisma);
  const priceKrw = fx ? priceKrwCeil(pricing.totalPriceVnd, fx) : 0;

  // ★지역 벤더 해석(ADR-0037) — MASSAGE·BARBER는 이 빌라의 지정 업체로 오버라이드, 그 외/미지정은 카탈로그 기본.
  const resolvedVendorId = await resolveOrderVendorId({
    itemType: item.type,
    itemVendorId: item.vendorId,
    villaId: booking.villaId,
  });

  // ★TICKET 판매가능 벤더 가드(계약 ticket-vendor-required-sale-block) — 게스트·운영자 라우트와 대칭.
  //   파트너(여행사) 채널도 예외 없음 — 벤더 QR 발행 없이는 이행 불가라 판매 시점에 벤더가 확보돼야 한다.
  //   이 라우트는 벤더 엔티티를 로드하지 않으므로 조회 래퍼로 승인·활성만 조회(누수 0). 비TICKET은 조회 없이 통과.
  if (!(await loadCanSellItem({ itemType: item.type, resolvedVendorId }, prisma))) {
    return NextResponse.json({ error: "TICKET_VENDOR_REQUIRED" }, { status: 400 });
  }

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: booking.id,
      type: item.type,
      status: "REQUESTED",
      serviceDate,
      serviceTime: d.serviceTime ?? null,
      costVnd: 0n, // 운영자 확정 시 실원가 입력
      priceKrw,
      priceVnd: pricing.totalPriceVnd,
      catalogItemId: item.id,
      quantity: pricing.quantity,
      selectedOptions: pricing.snapshot as unknown as Prisma.InputJsonValue,
      // 직판(DIRECT) 제안의 /p 신청자는 소비자 본인 — GUEST로 저장해야 /g 신청내역·
      //   체크아웃 정산 미리보기·셀프 취소에 잡힌다(뷰 분단 방지, consumer-bugs #2).
      //   여행사/랜드사 채널은 기존대로 PARTNER(파트너가 고객 대신 신청).
      requestedVia: booking.channel === "DIRECT" ? "GUEST" : "PARTNER",
      // 발주 대상 스냅샷(S2 dispatch가 사용) — 지역 지정 업체 해석 결과(ADR-0037). 응답엔 노출하지 않는다.
      vendorId: resolvedVendorId,
      guestNote: d.guestNote ?? null,
      // ★책임 제한 고지 동의 스냅샷(계약 service-order-liability-consent) — 신청 시점 증빙(불변).
      liabilityConsentJson: liabilityConsentJson as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: null,
    action: "CREATE",
    entity: "ServiceOrder",
    entityId: created.id,
    changes: {
      requestedVia: { new: booking.channel === "DIRECT" ? "GUEST" : "PARTNER" },
      catalogItemId: { new: item.id },
      liabilityConsentVersion: { new: SERVICE_LIABILITY_VERSION }, // 책임 고지 동의 증빙(계약 service-order-liability-consent)
    },
  });

  // 운영자 Zalo 통지 (A1) — 요청이 예약 상세에만 묻히지 않게. best-effort.
  const bookingInfo = await prisma.booking.findUnique({
    where: { id: booking.id },
    select: { villa: { select: { name: true } } },
  });
  await notifyOperatorsServiceOrderRequested(prisma, {
    bookingId: booking.id,
    orderId: created.id,
    villaName: bookingInfo?.villa.name ?? "-",
    serviceName: item.nameKo,
    quantity: pricing.quantity,
    serviceDate: d.serviceDate ?? null,
    serviceTime: d.serviceTime ?? null,
  });

  // ★ costVnd·vendorId·마진 미포함 — id만 반환.
  return NextResponse.json({ id: created.id }, { status: 201 });
}
