import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * POST /api/p/[token]/payment-notice — 게스트 입금통보 (비로그인, B1)
 *
 * 배경: 게스트가 계좌이체 후 운영자가 수동으로 은행 대조해 확정한다. 이 라우트는
 *   게스트→운영자 "입금했어요" 신호만 기록한다(상태는 바꾸지 않음 — 확정은 운영자 수동).
 *
 * 보안 모델은 roster route와 동일:
 * - 토큰은 경로값(스푸핑 불가) + proposalItem→proposal.token 교차 토큰 가드(불일치 404)
 * - rate-limit(토큰·IP) — 공개 엔드포인트 폭주 방어
 * - HOLD만 허용(이미 확정·만료·취소는 통보 불필요 → 409)
 * - 마진 비공개: select·응답에 판매가·원가 없음(id·status·교차토큰만 조회)
 */

const NOTICE_TOKEN_LIMIT = { max: 20, windowMs: 10 * 60_000 };
const NOTICE_IP_LIMIT = { max: 40, windowMs: 10 * 60_000 };

const bodySchema = z.object({
  bookingId: z.string().min(1),
  depositorName: z.string().max(100, "입금자명은 100자 이하여야 합니다").optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // 교차출처 위조 차단 (보안 P1-S9)
  const csrf = await assertSameOrigin(req, "p-payment-notice");
  if (csrf) return csrf;

  const ip = clientIp(req.headers);
  const tokenOk = checkRateLimit(`payment-notice:token:${token}`, NOTICE_TOKEN_LIMIT).allowed;
  const ipOk = ip ? checkRateLimit(`payment-notice:ip:${ip}`, NOTICE_IP_LIMIT).allowed : true;
  if (!tokenOk || !ipOk) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // 교차 토큰 가드 — bookingId가 이 token의 제안 소속인지 (roster route와 동일 패턴)
  const booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    select: {
      id: true,
      status: true,
      proposalItem: { select: { proposal: { select: { token: true } } } },
    },
  });
  if (!booking || booking.proposalItem?.proposal.token !== token) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  // 확정·만료·취소·체크인 이후 예약은 입금통보 불필요 (HOLD에서만 의미 있음)
  if (booking.status !== BookingStatus.HOLD) {
    return Response.json({ error: "closed" }, { status: 409 });
  }

  const depositorName = parsed.data.depositorName?.trim() || null;

  // 공개 액션 → userId null (외부 게스트). meta는 AuditLog의 유일한 JSON 컬럼(changes)에 기록.
  // changes 형식({field:{new}})은 운영자 활동로그 리더(status 키만 검사)와 호환.
  await writeAuditLog({
    userId: null,
    action: "GUEST_PAYMENT_NOTICE",
    entity: "Booking",
    entityId: booking.id,
    changes: {
      depositorName: { new: depositorName },
      notedAt: { new: new Date().toISOString() },
    },
  });

  return Response.json({ ok: true });
}
