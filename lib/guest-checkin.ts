// lib/guest-checkin.ts — 게스트 셀프 체크인 토큰 로직 (ADR-0019 S3)
//
// /g/[token] 비로그인 접근의 단일 예약 스코프 토큰. 만료·회수 상태 판정은 순수 함수로 단위 테스트.
//   ★ 토큰은 자기 예약 하나만 연다(재고 비공개 원칙1). 게스트엔 판매가만 — 원가·마진·타예약 비노출(§9).
import { randomBytes } from "node:crypto";

/** URL-safe 랜덤 토큰(제안 토큰과 동일 강도). */
export function generateGuestToken(): string {
  return randomBytes(24).toString("base64url");
}

export type GuestTokenState = "OK" | "EXPIRED" | "REVOKED";

/** 토큰 사용 가능 상태 — 회수 우선, 그다음 만료. 순수. */
export function guestTokenState(
  token: { expiresAt: Date; revokedAt: Date | null },
  now: Date
): GuestTokenState {
  if (token.revokedAt != null) return "REVOKED";
  if (token.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "OK";
}

export function isGuestTokenUsable(
  token: { expiresAt: Date; revokedAt: Date | null },
  now: Date
): boolean {
  return guestTokenState(token, now) === "OK";
}

/** 기본 만료 = 체크아웃 다음날 자정(현지 표시 무관, UTC 기준 +1일). 순수. */
export function defaultGuestTokenExpiry(checkOut: Date): Date {
  return new Date(checkOut.getTime() + 24 * 60 * 60 * 1000);
}
