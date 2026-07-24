// lib/webchat-card.ts — 웹챗 카드형 메시지 공용(순수) (T-webchat-cards-inbox-zalo-links)
//
// 위젯 번들(방문자)·서버 라우트·운영자 컴포넌트 공용. ⚠ 서버 의존성 없음(위젯 번들 안전).
//   카드 메시지 = 링크 발송(체크인/부가서비스/영수증/제안)을 구조화 카드(제목·부제·"열기")로 렌더.
//   payload는 방문자에게도 나가지만 url·표시값만 담는다 — ★금액·bookingId·proposalId 원문 미포함.

/** 카드 종류 — send-link kind와 일치(null=일반 텍스트, 구 메시지 하위호환). */
export type WebChatCardKind = "checkin" | "options" | "receipt" | "proposal" | "villa";

export interface WebChatCardPayload {
  /**
   * 카드 "열기"/"상세 보기" 버튼 링크. 방문자에게도 나가는 값(이미 발송되는 링크라 누수 무관).
   * ★villa 카드는 공개 상세페이지가 없으면 url이 없다 — 선택(optional). 그 외 링크 카드는 항상 존재.
   */
  url?: string;
  /** villa 카드 전용 — 공유 대상 빌라 id(누수 무관: 판매가·원가·마진 아님). */
  villaId?: string;
}

/** kind 문자열이 알려진 카드 종류인지(그 외·null이면 폴백 텍스트 렌더). */
export function isWebChatCardKind(kind: string | null | undefined): kind is WebChatCardKind {
  return (
    kind === "checkin" ||
    kind === "options" ||
    kind === "receipt" ||
    kind === "proposal" ||
    kind === "villa"
  );
}

/**
 * Json payload → 안전한 카드 페이로드. 형식 불량은 null. **kind별 분기**:
 *  - villa: villaId 필수, url 선택(공개 상세페이지 없으면 url 없이 villaId만 있어도 카드로 렌더).
 *           villaId도 없으면 null.
 *  - 그 외(checkin/options/receipt/proposal)·kind 미지정: 기존대로 url 필수(url 없으면 null).
 * @param kind 메시지 kind(호출부가 isWebChatCardKind 통과 후 그대로 전달). 미지정이면 url 필수 규칙.
 */
export function parseWebChatCardPayload(
  payload: unknown,
  kind?: string | null
): WebChatCardPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const rawUrl = (payload as { url?: unknown }).url;
  const url = typeof rawUrl === "string" && rawUrl.length > 0 ? rawUrl : undefined;

  if (kind === "villa") {
    const rawVillaId = (payload as { villaId?: unknown }).villaId;
    const villaId =
      typeof rawVillaId === "string" && rawVillaId.length > 0 ? rawVillaId : undefined;
    if (!villaId) return null; // villa인데 식별자 없으면 카드 불가(폴백 텍스트)
    return url ? { villaId, url } : { villaId };
  }
  // 그 외 링크 카드는 url 필수 유지(회귀 방지).
  return url ? { url } : null;
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
