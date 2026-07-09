import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * POST /api/p/[token]/roster — 여행사 셀프 투숙객 명단 입력 (비로그인, 안 B)
 *
 * 접근 = 기존 제안 토큰 재사용. hold route와 동일 보안 모델:
 * - 토큰은 경로값(스푸핑 불가) + proposalItem→proposal.token 교차 토큰 가드
 * - rate-limit(토큰·IP) — 공개 엔드포인트 폭주 방어 (T-sec-public-hardening)
 * - 상태 HOLD·CONFIRMED만 허용(체크인 이후·취소·만료는 closed)
 * - guestRoster 단일 컬럼만 수정 — 상태·금액 등은 zod strip. 전이 무결성 불변.
 * - 마진 비공개: 응답·select에 판매가·원가 없음.
 *
 * ★만료 규약(의도): proposal.expiresAt은 검사하지 않는다 — 명단은 예약 수명주기
 *   (HOLD/CONFIRMED) 기준의 "예약 완결 액션"이라 제안 링크 유효기간과 무관하다.
 *   D-3 roster-reminder cron이 만료 한참 뒤의 CONFIRMED 예약에 이 링크를 보낸다.
 *   (반면 신규 구매인 service-orders는 expiresAt 경과 시 410 — ADR-0022 재발급 원칙.)
 */

const ROSTER_TOKEN_LIMIT = { max: 30, windowMs: 10 * 60_000 };
const ROSTER_IP_LIMIT = { max: 60, windowMs: 10 * 60_000 };

const bodySchema = z.object({
  bookingId: z.string().min(1),
  guestRoster: z.string().max(2000, "명단은 2000자 이하여야 합니다"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // 교차출처 위조 차단 (보안 P1-S9)
  const csrf = await assertSameOrigin(req, "p-roster");
  if (csrf) return csrf;

  const ip = clientIp(req.headers);
  const tokenOk = checkRateLimit(`roster:token:${token}`, ROSTER_TOKEN_LIMIT).allowed;
  const ipOk = ip ? checkRateLimit(`roster:ip:${ip}`, ROSTER_IP_LIMIT).allowed : true;
  if (!tokenOk || !ipOk) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // 교차 토큰 가드 — bookingId가 이 token의 제안 소속인지 (hold route와 동일 패턴)
  const booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    select: {
      id: true,
      status: true,
      guestRoster: true,
      proposalItem: { select: { proposal: { select: { token: true } } } },
    },
  });
  if (!booking || booking.proposalItem?.proposal.token !== token) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  // 체크인 이후·취소·만료 예약은 입력 불가 (명단은 체크인 전 준비용)
  if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
    return Response.json({ error: "closed" }, { status: 409 });
  }

  const roster = parsed.data.guestRoster.trim() === "" ? null : parsed.data.guestRoster;
  await prisma.booking.update({
    where: { id: booking.id },
    data: { guestRoster: roster },
    select: { id: true },
  });
  // 공개 액션 → userId null (시스템/외부 기록). ADMIN 입력과 같은 컬럼·같은 감사 형식.
  await writeAuditLog({
    userId: null,
    action: "UPDATE",
    entity: "Booking",
    entityId: booking.id,
    changes: { guestRoster: { old: booking.guestRoster, new: roster } },
  });

  return Response.json({ ok: true });
}
