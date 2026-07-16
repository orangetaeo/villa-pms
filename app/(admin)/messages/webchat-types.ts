// 웹 채팅 인박스 공용 타입 (T-webchat-inbox)
// API 정본: GET /api/webchat/inbox · GET /api/webchat/sessions/[id] 응답 형태와 일치.

export type WebChatStatus = "OPEN" | "CLOSED" | "BLOCKED";
export type WebChatDirection = "INBOUND" | "OUTBOUND";
export type WebChatFilter = "open" | "blocked" | "all";

/** 인박스 목록 항목 — /api/webchat/inbox 의 sessions[] 요소(비정규화 필드만). */
export interface WebChatSessionListItem {
  id: string;
  visitorLocale: string;
  status: WebChatStatus;
  sourcePage: string | null;
  contactEmail: string | null;
  contactZalo: string | null;
  contactKakao: string | null;
  unreadForAdmin: number;
  lastMessageText: string | null;
  lastMessageDirection: WebChatDirection | null;
  lastMessageAt: string | null;
  createdAt: string;
}

/** 스레드 메시지 — /api/webchat/sessions/[id] 의 messages[] 요소. */
export interface WebChatThreadMessage {
  id: string;
  direction: WebChatDirection;
  text: string;
  sourceLocale: string;
  translatedText: string | null;
  translatedTo: string | null;
  translationFailed: boolean;
  status: string;
  sentBy: string | null;
  createdAt: string;
}

/** 스레드 상세 — /api/webchat/sessions/[id] 의 session. */
export interface WebChatThreadData {
  id: string;
  visitorLocale: string;
  status: WebChatStatus;
  sourcePage: string | null;
  contactEmail: string | null;
  contactZalo: string | null;
  contactKakao: string | null;
  unreadForAdmin: number;
  lastMessageAt: string | null;
  createdAt: string;
  messages: WebChatThreadMessage[];
}

/** 방문자 언어 코드 → 짧은 뱃지 라벨. 알 수 없는 코드는 대문자 폴백. */
export function localeBadge(locale: string): string {
  const code = (locale || "").trim().toLowerCase().slice(0, 2);
  return code ? code.toUpperCase() : "?";
}

/**
 * sourcePage 파싱 — 부착면 코드값을 읽기 좋은 뱃지로 변환.
 *   `g:XXXXXXXX`(게스트 포털)·`p:XXXXXXXX`(제안 링크)는 토큰 앞 8자 프리픽스만 저장됨(계약 §B).
 *   `auth`(로그인·가입)·`intro`/`intro-vendor`/`intro-partner`(모집 소개)는 고정 라벨.
 *   labelKey는 adminWebchat.source.* 하위 키 — 컴포넌트가 t()로 렌더. code는 뱃지 옆 짧은 식별자.
 */
export type SourcePageInfo =
  | { labelKey: string; code: string | null; raw: null } // 알려진 종류
  | { labelKey: null; code: null; raw: string }; // 미분류(원문 그대로)

export function parseSourcePage(sourcePage: string | null): SourcePageInfo {
  const v = (sourcePage || "").trim();
  if (!v) return { labelKey: "unknown", code: null, raw: null };
  if (v.startsWith("g:")) return { labelKey: "guest", code: v.slice(2) || null, raw: null };
  if (v.startsWith("p:")) return { labelKey: "proposal", code: v.slice(2) || null, raw: null };
  if (v === "auth") return { labelKey: "auth", code: null, raw: null };
  // T-webchat-chat-landing: 소비자 직행 /chat 유입면(화이트리스트: chat·ig·kakao·qr·direct).
  if (v === "chat") return { labelKey: "chat", code: null, raw: null };
  if (v === "ig") return { labelKey: "ig", code: null, raw: null };
  if (v === "kakao") return { labelKey: "kakao", code: null, raw: null };
  if (v === "qr") return { labelKey: "qr", code: null, raw: null };
  if (v === "direct") return { labelKey: "direct", code: null, raw: null };
  if (v === "intro") return { labelKey: "intro", code: null, raw: null };
  if (v === "intro-vendor") return { labelKey: "introVendor", code: null, raw: null };
  if (v === "intro-partner") return { labelKey: "introPartner", code: null, raw: null };
  return { labelKey: null, code: null, raw: v };
}

/** 연락처 존재 여부. */
export function hasContact(s: {
  contactEmail: string | null;
  contactZalo: string | null;
  contactKakao: string | null;
}): boolean {
  return Boolean(s.contactEmail || s.contactZalo || s.contactKakao);
}
