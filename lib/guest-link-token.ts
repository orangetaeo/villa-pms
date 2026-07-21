// lib/guest-link-token.ts — 게스트 링크 토큰 확보(재사용/발급) — 채널 독립 (T-webchat-cards-inbox-zalo-links)
//
// 어느 채널(웹챗·Zalo 등)이든 게스트 링크(/g)를 보낼 때 예약의 GuestCheckinToken을 확보한다.
//   활성(미회수·미만료) 토큰이 있으면 재사용(이미 QR·링크로 전달된 토큰을 깨지 않음),
//   없으면 신규 발급(upsert revokedAt:null). ★WebChat 의존 없음 — (C) Zalo 게스트 링크 공유가 그대로 재사용.
//   ★기존 bookings/[id]/guest-token POST는 무조건 재발급(구 토큰 무효화)이라 여기서는 재사용 분기를 별도로 둔다.
import { prisma } from "@/lib/prisma";
import {
  generateGuestToken,
  defaultGuestTokenExpiry,
  isGuestTokenUsable,
} from "@/lib/guest-checkin";

export interface EnsureGuestLinkTokenResult {
  /** 확보된 토큰(재사용 또는 신규). */
  token: string;
  /** true=기존 활성 토큰 재사용, false=신규 발급. */
  reused: boolean;
}

/**
 * 예약의 게스트 체크인 토큰을 확보한다(활성 재사용 / 없으면 발급).
 *   발급 시맨틱(generateGuestToken + defaultGuestTokenExpiry + upsert revokedAt:null)은 기존 라우트와 동일.
 *   ★활성 토큰은 무효화하지 않는다(재사용 우선 — 이미 전달된 QR·링크 보존).
 * @throws Error("BOOKING_NOT_FOUND") 예약 미존재 시. 호출부가 사전 검증할 것(방어적).
 */
export async function ensureGuestLinkToken(
  bookingId: string,
  now: Date = new Date()
): Promise<EnsureGuestLinkTokenResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, checkOut: true },
  });
  if (!booking) throw new Error("BOOKING_NOT_FOUND");

  const existing = await prisma.guestCheckinToken.findUnique({
    where: { bookingId: booking.id },
    select: { token: true, expiresAt: true, revokedAt: true },
  });

  if (existing && isGuestTokenUsable(existing, now)) {
    return { token: existing.token, reused: true };
  }

  const token = generateGuestToken();
  const expiresAt = defaultGuestTokenExpiry(booking.checkOut);
  await prisma.guestCheckinToken.upsert({
    where: { bookingId: booking.id },
    create: { bookingId: booking.id, token, expiresAt },
    update: { token, expiresAt, revokedAt: null },
  });
  return { token, reused: false };
}
