// Zalo 채팅(b14) 순수 로직 — 48h 응답 창 판정 (T6.6, ADR-0003)
// CS 무료 상담 메시지는 마지막 수신(lastInboundAt) 후 48시간 내에만 발신 가능.
// 시스템 알림(Notification)은 이 창과 무관하게 발송됨 — 본 판정은 b14 수동 채팅 입력창에만 적용.

/** CS 응답 창 길이 (밀리초) — 48시간 */
export const REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * 수동 채팅 발신 가능 여부.
 * - lastInboundAt 없음(수신 이력 없음) → 닫힘(false): 공급자가 먼저 말을 걸어야 무료 상담 창이 열림
 * - lastInboundAt + 48h > now → 열림(true)
 * - lastInboundAt + 48h <= now → 닫힘(false): 입력창 비활성 + amber 경고 배너
 */
export function isReplyWindowOpen(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (lastInboundAt == null) return false;
  const inbound =
    lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(inbound.getTime())) return false;
  return inbound.getTime() + REPLY_WINDOW_MS > now.getTime();
}
