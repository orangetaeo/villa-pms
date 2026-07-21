// lib/webchat-card.ts — 웹챗 카드형 메시지 공용(순수) (T-webchat-cards-inbox-zalo-links)
//
// 위젯 번들(방문자)·서버 라우트·운영자 컴포넌트 공용. ⚠ 서버 의존성 없음(위젯 번들 안전).
//   카드 메시지 = 링크 발송(체크인/부가서비스/영수증/제안)을 구조화 카드(제목·부제·"열기")로 렌더.
//   payload는 방문자에게도 나가지만 url·표시값만 담는다 — ★금액·bookingId·proposalId 원문 미포함.

/** 카드 종류 — send-link kind와 일치(null=일반 텍스트, 구 메시지 하위호환). */
export type WebChatCardKind = "checkin" | "options" | "receipt" | "proposal";

export interface WebChatCardPayload {
  /** 카드 "열기" 버튼 링크. 방문자에게도 나가는 값(이미 발송되는 링크라 누수 무관). */
  url: string;
}

/** kind 문자열이 알려진 카드 종류인지(그 외·null이면 폴백 텍스트 렌더). */
export function isWebChatCardKind(kind: string | null | undefined): kind is WebChatCardKind {
  return kind === "checkin" || kind === "options" || kind === "receipt" || kind === "proposal";
}

/** Json payload → 안전한 카드 페이로드(url 문자열만 추출). 형식 불량은 null. */
export function parseWebChatCardPayload(payload: unknown): WebChatCardPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const url = (payload as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? { url } : null;
}

/**
 * 카드 링크 스킴 안전성 — http(s) 절대 URL 또는 동일 오리진 상대경로만 허용.
 *   javascript:·data: 등 위험 스킴, //호스트(스킴 상대 → 타 호스트)는 차단.
 */
export function isSafeCardUrl(url: string): boolean {
  const u = url.trim();
  if (u.startsWith("//")) return false; // 스킴 상대(타 호스트) 차단
  if (u.startsWith("/")) return true; // 동일 오리진 상대경로(위젯 로더와 동일 오리진)
  return /^https?:\/\//i.test(u); // http(s) 절대 URL만
}
