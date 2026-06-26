// lib/zalo-chat-message.ts — ZaloMessage(DB row) → ChatMessage(UI DTO) 매핑 단일 진실원.
//
// /messages 의 RSC(page.tsx 초기 로드)와 이전 메시지 GET 엔드포인트(app/api/zalo/messages GET)가
// 동일 함수로 매핑해 결과가 일치하게 한다(prepend 정합). 기존 page.tsx 인라인 매핑(L321~364)을
// 그대로 추출한 것 — 동작 회귀 0이 목표.
//
// 누수 0: 입력 row는 화이트리스트 select 필드만(마진·판매가·supplierCost·credential 미포함).
//   이 함수는 추가 조회를 하지 않으며, 발신자명·아바타는 공개 프로필(groupMembers 스냅샷)만 사용.
import { ZaloMessageDirection, ZaloMessageSource } from "@prisma/client";

/** 이름에서 이니셜 2자 추출 (아바타) — 한글/라틴 공통, 공백 분할 우선. page.tsx initials와 동일 규칙. */
export function chatInitials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase();
}

/** 스레드 메시지 시각 HH:mm (Asia/Ho_Chi_Minh) */
export function msgTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 날짜 구분자 YYYY.MM.DD (Asia/Ho_Chi_Minh) */
export function dayDivider(date: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

/** 리액션 Json({HEART:2,...})을 Record<string,number>로 정규화 — 양수 카운트만. 비정상/빈값은 null. */
export function normalizeReactions(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && v > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 매핑 입력 row — page.tsx 스레드 select / GET 엔드포인트 select 화이트리스트와 동일 필드. */
export interface ChatMessageRow {
  id: string;
  direction: ZaloMessageDirection;
  source: ZaloMessageSource;
  msgType: string | null;
  senderUid: string | null;
  text: string | null;
  translatedText: string | null;
  attachmentUrls: string[];
  status: string;
  createdAt: Date;
  zaloMsgId: string | null;
  /** zca-js globalMsgId — 답글 인용 앵커 변환용(resolveQuotedAnchors). 선택(미조회 경로 호환). */
  globalMsgId?: string | null;
  quotedMsgId: string | null;
  quotedText: string | null;
  quotedSender: string | null;
  reactions: unknown;
}

/** 매핑 결과 DTO — chat-pane.tsx ChatMessage 와 구조 동일(직렬화 안전한 평면값만). */
export interface ChatMessageDTO {
  id: string;
  kind: "inbound" | "outbound" | "system";
  msgType: string;
  text: string;
  translatedText: string | null;
  attachmentUrls: string[];
  time: string;
  status: string;
  dayDivider: string | null;
  avatarUrl: string | null;
  initials: string;
  senderName: string | null;
  zaloMsgId: string | null;
  quotedMsgId: string | null;
  quotedText: string | null;
  quotedSender: string | null;
  reactions: Record<string, number> | null;
}

export interface ToChatMessagesOptions {
  /** 그룹(단톡방) 여부 — true면 수신 버블에 발신자별 이름·아바타(R14 폴백). */
  isGroup: boolean;
  /** 그룹 멤버 스냅샷 zaloId→{name,avatarUrl} (1:1은 빈 맵). 공개 프로필만(누수 무관). */
  memberMap: Map<string, { name: string | null; avatarUrl: string | null }>;
  /** 대화 상대(헤더) 아바타 — 1:1·OUTBOUND·SYSTEM 버블 폴백. */
  headerAvatarUrl: string | null;
  /** 대화 상대(헤더) 이니셜 — 헤더 아바타 폴백. */
  headerInitials: string;
}

/**
 * ZaloMessage row 배열(표시 순서 = createdAt asc)을 ChatMessage DTO로 매핑.
 * dayDivider는 **배치 내부 기준**(이전 메시지와의 day 비교) — prepend 시 경계 day 중복은 허용.
 * 발신자 해석(R14): 그룹 수신만 senderUid→memberMap. 미해석 시 senderUid 원문 폴백·이니셜 아바타.
 * OUTBOUND·SYSTEM·1:1은 발신자명 null + 헤더 아바타/이니셜(회귀 0).
 */
export function toChatMessages(
  rows: ChatMessageRow[],
  opts: ToChatMessagesOptions
): ChatMessageDTO[] {
  const { isGroup, memberMap, headerAvatarUrl, headerInitials } = opts;
  let prevDay = "";
  return rows.map((m) => {
    const day = dayDivider(m.createdAt);
    const divider = day !== prevDay ? day : null;
    prevDay = day;
    const isInbound = m.direction === ZaloMessageDirection.INBOUND;
    const isSystem = m.source === ZaloMessageSource.SYSTEM;
    // 그룹 수신 버블 발신자 해석(R14): senderUid → 멤버 스냅샷 name·avatarUrl.
    // 미해석(멤버에 없거나 groupMembers=null) → 이름은 senderUid 원문 폴백, 아바타는 이니셜.
    let senderName: string | null = null;
    let senderAvatarUrl: string | null = null;
    if (isGroup && isInbound && !isSystem) {
      const member = m.senderUid ? memberMap.get(m.senderUid) : undefined;
      senderName = member?.name ?? m.senderUid ?? null;
      senderAvatarUrl = member?.avatarUrl ?? null;
    }
    return {
      id: m.id,
      kind: isSystem ? "system" : isInbound ? "inbound" : "outbound",
      msgType: m.msgType ?? "text",
      text: m.text ?? "",
      translatedText: m.translatedText,
      attachmentUrls: m.attachmentUrls,
      time: msgTime(m.createdAt),
      status: m.status,
      dayDivider: divider,
      // 그룹 수신 버블은 발신자별 아바타·이니셜. 1:1·OUTBOUND·SYSTEM은 헤더 아바타·이니셜(회귀 0).
      avatarUrl: senderAvatarUrl ?? headerAvatarUrl,
      initials: senderName ? chatInitials(senderName) : headerInitials,
      senderName,
      zaloMsgId: m.zaloMsgId,
      quotedMsgId: m.quotedMsgId,
      quotedText: m.quotedText,
      quotedSender: m.quotedSender,
      reactions: normalizeReactions(m.reactions),
    } satisfies ChatMessageDTO;
  });
}
