import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createHoldFromProposalItem, HoldRejectedError } from "@/lib/hold";
import { MissingRateError } from "@/lib/pricing";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import {
  CANCELLATION_POLICY_KEY,
  parseCancellationPolicy,
} from "@/lib/cancellation-policy";
import { isPublicLang } from "@/lib/public-i18n";
import { BookingChannel, BookingSeller, type Currency } from "@prisma/client";

/** B2C 결제 조건 동의 스냅샷 (policyConsentJson.b2c) — JSON 직렬화용 구체 타입(원가·마진·FX원본 없음).
 *  ★type 별칭 사용(interface는 Prisma InputJsonObject 인덱스시그니처에 할당 불가 — TS 함정). */
type B2cConsentSnapshot = {
  termsVersion: number;
  billingCurrency: Currency;
  depositRatePct: number;
  balanceLeadDays: number;
  totalVnd: string;
  depositDueVnd: string;
  balanceDueVnd: string;
  fullPrepay: boolean;
};
import { resolveBookingAnchorVnd, computeB2cSchedule } from "@/lib/b2c-payment";
import { resolveB2cSettings } from "@/lib/b2c-schedule";
import { B2C_TERMS_VERSION } from "@/lib/b2c-terms";

// 공개·미인증 엔드포인트 폭주 방어 (T-sec-public-hardening)
// 토큰: 경로값이라 스푸핑 불가(1차) / IP: best-effort(XFF). 제안 ACTIVE→USED 가드로
// 토큰당 성공 HOLD는 1건이라 본 제한은 플러드·DB 부하·로그 스팸 완화 목적.
const HOLD_TOKEN_LIMIT = { max: 15, windowMs: 10 * 60_000 };
const HOLD_IP_LIMIT = { max: 30, windowMs: 10 * 60_000 };

/**
 * POST /api/p/[token]/hold — 공개 가예약 생성 (비로그인, SPEC F3 흐름 3)
 *
 * T2.3 QA 이관 이행:
 * - 거부 사유는 "expired"/"closed" 2종으로만 축약 — HoldRejectedError의 내부
 *   reasons(검수 게이트 NOT_SELLABLE 등)는 공개 응답에 절대 미노출
 * - MissingRateError는 500이 아닌 "closed"로 처리
 */

const bodySchema = z.object({
  itemId: z.string().min(1),
  guestName: z.string().trim().min(1).max(100),
  guestPhone: z.string().trim().regex(/^[0-9+\-\s]{9,20}$/),
  guestCount: z.number().int().min(1).max(16),
  // 취소·환불 규정 전자 동의 (T-proposal-policy-consent). 정책 enabled=true일 때만 필수.
  //   정책 값 자체는 서버가 AppSetting에서 읽어 산출(클라 값 불신) — 여기선 동의 플래그·표시 언어만 수신.
  policyConsent: z.boolean().optional(),
  locale: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // 교차출처 위조 차단 (보안 P1-S9)
  const csrf = await assertSameOrigin(req, "p-hold");
  if (csrf) return csrf;

  // 폭주 방어 — 토큰(스푸핑 불가)·IP(best-effort) 양 윈도우. 초과 시 429.
  const ip = clientIp(req.headers);
  const tokenOk = checkRateLimit(`hold:token:${token}`, HOLD_TOKEN_LIMIT).allowed;
  const ipOk = ip ? checkRateLimit(`hold:ip:${ip}`, HOLD_IP_LIMIT).allowed : true;
  if (!tokenOk || !ipOk) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // 교차 토큰 차단 — itemId가 이 token의 제안 소속인지 확인.
  //   B2C 동의 스냅샷(ADR-0048 P5c)용 필드도 함께 로드(채널·통화·총액·스냅샷 환율·체크인).
  const item = await prisma.proposalItem.findUnique({
    where: { id: parsed.data.itemId },
    select: {
      id: true,
      checkIn: true,
      totalKrw: true,
      totalVnd: true,
      totalUsd: true,
      proposal: {
        select: {
          token: true,
          channel: true,
          seller: true,
          saleCurrency: true,
          fxVndPerKrw: true,
          fxVndPerUsd: true,
        },
      },
    },
  });
  if (!item || item.proposal.token !== token) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // 취소·환불 규정 전자 동의 게이트 (T-proposal-policy-consent, 직판 분쟁 방어).
  //   정책은 서버가 AppSetting에서 읽어 판정·스냅샷 산출(클라 값 불신). enabled=false면 미요구·미저장.
  const policyRow = await prisma.appSetting.findUnique({
    where: { key: CANCELLATION_POLICY_KEY },
    select: { value: true },
  });
  const policy = parseCancellationPolicy(policyRow?.value);
  const now = new Date();

  // B2C 결제 조건 동의 스냅샷 (ADR-0048 P5c) — 직접(일반고객)·운영자 판매 제안만.
  //   book 화면(P5b)에 계약금/잔금·잔금 환율변동 공시를 노출했고, 동의 당시 조건을 증빙 저장한다.
  //   VND 앵커 스냅샷(청구통화→예약 시점 환율). 앵커 산출 불가(환율 미상)면 미기록. BigInt→문자열(Json).
  //   ⚠ 마진·원가·소비자가·FX 원본 미포함 — 계약금/잔금 VND·정책값·버전만(원칙2).
  let b2cConsent: B2cConsentSnapshot | null = null;
  if (
    item.proposal.channel === BookingChannel.DIRECT &&
    item.proposal.seller === BookingSeller.OPERATOR
  ) {
    const anchorVnd = resolveBookingAnchorVnd({
      saleCurrency: item.proposal.saleCurrency,
      totalSaleKrw: item.totalKrw,
      totalSaleVnd: item.totalVnd,
      totalSaleUsd: item.totalUsd,
      fxVndPerKrw: item.proposal.fxVndPerKrw != null ? item.proposal.fxVndPerKrw.toString() : null,
      fxVndPerUsd: item.proposal.fxVndPerUsd != null ? item.proposal.fxVndPerUsd.toString() : null,
    });
    if (anchorVnd != null && anchorVnd > 0n) {
      const settings = await resolveB2cSettings(prisma);
      const sched = computeB2cSchedule({ totalVnd: anchorVnd, checkIn: item.checkIn, now, ...settings });
      b2cConsent = {
        termsVersion: B2C_TERMS_VERSION,
        billingCurrency: item.proposal.saleCurrency,
        depositRatePct: settings.depositRatePct,
        balanceLeadDays: settings.balanceLeadDays,
        totalVnd: anchorVnd.toString(),
        depositDueVnd: sched.depositDueVnd.toString(),
        balanceDueVnd: sched.balanceDueVnd.toString(),
        fullPrepay: sched.fullPrepay,
      };
    }
  }

  let policyConsentJson: {
    agreedAt: string;
    // S3: N단계 스냅샷. ★ 기존 예약의 v1 스냅샷({fullDays,...})은 그대로 보존 — 재해석 금지(동의 당시 조건이 정본).
    policy?: { tiers: { fromDays: number; refundPct: number }[] };
    b2c?: B2cConsentSnapshot;
    locale: string;
    source: "proposal";
  } | null = null;
  if (policy.enabled) {
    if (parsed.data.policyConsent !== true) {
      return Response.json({ error: "CONSENT_REQUIRED" }, { status: 400 });
    }
  }
  // 취소규정 동의 또는 B2C 결제 조건 중 하나라도 있으면 스냅샷 저장(동의 당시 조건 증빙, 이후 정책 변경 불변).
  if (policy.enabled || b2cConsent) {
    policyConsentJson = {
      agreedAt: now.toISOString(),
      ...(policy.enabled
        ? { policy: { tiers: policy.tiers.map((t) => ({ fromDays: t.fromDays, refundPct: t.refundPct })) } }
        : {}),
      ...(b2cConsent ? { b2c: b2cConsent } : {}),
      locale: isPublicLang(parsed.data.locale) ? parsed.data.locale : "ko",
      source: "proposal",
    };
  }

  try {
    const booking = await createHoldFromProposalItem(prisma, {
      proposalItemId: item.id,
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      guestPhone: parsed.data.guestPhone,
      policyConsentJson,
      now,
    });
    return Response.json({ bookingId: booking.id }, { status: 201 });
  } catch (e) {
    if (e instanceof HoldRejectedError) {
      // 정원 초과 — 입력 문제라 별도 코드로 노출(인원 수정 유도, consumer-bugs #1)
      if (e.reason === "OVER_CAPACITY") {
        return Response.json({ error: "over_capacity" }, { status: 409 });
      }
      // 만료 계열 → expired, 그 외(마감·중복·재고 소실) → closed — 내부 사유 미노출
      const publicReason =
        e.reason === "PROPOSAL_EXPIRED" || e.reason === "HOLD_EXPIRED" ? "expired" : "closed";
      return Response.json({ error: publicReason }, { status: 409 });
    }
    if (e instanceof MissingRateError) {
      return Response.json({ error: "closed" }, { status: 409 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input" }, { status: 400 });
    }
    console.error("[p/hold] 가예약 생성 실패", e);
    return Response.json({ error: "신청 처리에 실패했습니다" }, { status: 500 });
  }
}
