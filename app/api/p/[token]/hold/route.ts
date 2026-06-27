import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createHoldFromProposalItem, HoldRejectedError } from "@/lib/hold";
import { MissingRateError } from "@/lib/pricing";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

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

  // 교차 토큰 차단 — itemId가 이 token의 제안 소속인지 확인
  const item = await prisma.proposalItem.findUnique({
    where: { id: parsed.data.itemId },
    select: { id: true, proposal: { select: { token: true } } },
  });
  if (!item || item.proposal.token !== token) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const booking = await createHoldFromProposalItem(prisma, {
      proposalItemId: item.id,
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      guestPhone: parsed.data.guestPhone,
      now: new Date(),
    });
    return Response.json({ bookingId: booking.id }, { status: 201 });
  } catch (e) {
    if (e instanceof HoldRejectedError) {
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
