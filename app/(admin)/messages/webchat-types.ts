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

/** 연락처 존재 여부. */
export function hasContact(s: {
  contactEmail: string | null;
  contactZalo: string | null;
  contactKakao: string | null;
}): boolean {
  return Boolean(s.contactEmail || s.contactZalo || s.contactKakao);
}
