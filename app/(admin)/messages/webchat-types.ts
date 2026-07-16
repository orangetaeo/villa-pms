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

/**
 * 예약 요약 — 세션↔예약 연결 배지·연결 응답용 (T-webchat-guest-link-share).
 * ★금액 필드(판매가·원가·마진·정산) 절대 미포함 — 운영자 표시 전용 화이트리스트.
 */
export interface BookingSummary {
  bookingId: string;
  guestName: string;
  villaName: string | null;
  checkIn: string;
  checkOut: string;
  status: string;
}

/**
 * 예약 후보 — 연결 팝오버의 자동 추천/검색 결과 요소.
 * matchType: token=링크 유입(신뢰도 최상)·contact=연락처 일치·search=수동 검색.
 * ★전화는 뒷 4자리만(guestPhoneLast4), 금액 필드 없음.
 */
export interface BookingCandidate {
  bookingId: string;
  guestName: string;
  guestPhoneLast4: string | null;
  villaName: string | null;
  checkIn: string;
  checkOut: string;
  status: string;
  matchType: "token" | "contact" | "search";
}

/** 빠른 링크 발송 종류 — send-link API kind와 일치. */
export type QuickLinkKind = "checkin" | "options" | "receipt" | "proposal";

/**
 * 기존 제안 후보 — 채팅 내 "제안 보내기" 모달의 A 섹션 목록 요소.
 * GET /api/webchat/sessions/[id]/proposal-candidates 응답 요소와 일치.
 * ★금액 필드 없음(라우트가 select 원천 배제) — clientName·빌라명·날짜만.
 */
export interface ProposalCandidate {
  proposalId: string;
  clientName: string;
  channel: string;
  villaNames: string[];
  checkIn: string | null; // 첫 item 기준(item마다 날짜 상이 가능)
  checkOut: string | null;
  expiresAt: string;
}

/**
 * 새 제안 생성용 빌라 후보 — 모달 B 섹션 목록 요소.
 * GET /api/proposals/candidates 응답 요소 중 표시에 쓰는 필드만(운영자 전용 다크 모달 내 표시라 판매가 노출 OK).
 * ★이 데이터는 방문자 폴링 응답으로 나가지 않는다(운영자 화면 전용).
 */
export interface ProposalVillaCandidate {
  id: string;
  name: string;
  complex: string | null;
  maxGuests: number;
  nights: number;
  totalSaleKrw: number | null;
  totalSaleVnd: string | null; // serializeBigInt → 문자열
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
  // 세션↔예약 연결(운영자 전용) — 미연결이면 둘 다 null. ★방문자 폴링 응답엔 부재.
  bookingId: string | null;
  booking: BookingSummary | null;
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
