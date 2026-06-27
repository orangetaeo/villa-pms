// app/(admin)/messages/_thread-data.ts — /messages 인박스·스레드 조회 단일 진실원 (perf #2, 2026-06-24)
//
// 배경: 인박스 클릭이 ?c= 서버 네비게이션 → page.tsx 전체 재실행(인박스 463개 재조회·재직렬화)이라
//   미세 지연이 남았다. 클릭을 클라이언트화(MessagesClient)하면서, 인박스/스레드 조회 로직을 이 모듈로
//   추출해 ① page.tsx(딥링크 SSR) ② GET /api/zalo/inbox ③ GET /api/zalo/conversations/[id]/thread 가
//   동일 쿼리·매핑·누수 분기를 공유하게 한다(중복 제거 + 회귀 0).
//
// 누수 0(사업 원칙 1·2): select 화이트리스트 — 마진·판매가(KRW)·원가·credential 미조회.
//   기존 page.tsx 인박스 쿼리(L110-175)·스레드 블록(L192-293)을 필드 단위로 그대로 이식.
// 개인 스코프(ADR-0007): 모든 쿼리 where 에 ownerAdminId 강제. 타 관리자 대화는 인박스에 없고,
//   스레드는 null 반환(라우트가 404, page.tsx는 redirect)으로 id 추측 접근 차단.
import { ZaloThreadType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { toChatMessages } from "@/lib/zalo-chat-message";
import { resolveQuotedAnchors } from "@/lib/zalo-quote-anchor";
import type { InboxItem } from "./inbox";
import type {
  ChatMessage,
  ChatHeader,
  CounterpartyType,
  TranslateMode,
  GroupMember,
} from "./chat-pane";

// 초기 스레드 로드 개수 — 81개 조회로 "더 있음" 판단(80개로 슬라이스). page.tsx INITIAL_TAKE 동일.
const INITIAL_TAKE = 80;

/** 이름에서 이니셜 2자 추출 (아바타) — 한글/라틴 공통, 공백 분할 우선. page.tsx initials와 동일 규칙. */
function initials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase();
}

/** groupMembers Json(unknown) → GroupMember[] 정규화. zaloId 없는 항목은 제외(누수 무관: 공개 프로필). */
function parseGroupMembers(value: unknown): GroupMember[] {
  if (!Array.isArray(value)) return [];
  const out: GroupMember[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const zaloId = typeof m.zaloId === "string" ? m.zaloId : null;
    if (!zaloId) continue;
    out.push({
      zaloId,
      name: typeof m.name === "string" ? m.name : null,
      avatarUrl: typeof m.avatarUrl === "string" ? m.avatarUrl : null,
    });
  }
  return out;
}

/** 인박스 시각 표기: 오늘 HH:mm / 어제 / 그 외 MM.DD (Asia/Ho_Chi_Minh). page.tsx inboxTime 동일. */
function inboxTime(date: Date | null, now: Date, yesterdayLabel: string): string {
  if (!date) return "";
  const tz = "Asia/Ho_Chi_Minh";
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ko-KR", { timeZone: tz, ...opts }).format(d);
  const dayKey = (d: Date) => fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const key = dayKey(date);
  if (key === today) return fmt(date, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (key === yesterday) return yesterdayLabel;
  return fmt(date, { month: "2-digit", day: "2-digit" }).replace(/\.$/, "").replace(/\. /, ".");
}

/** 표시명 우선순위 (D9.2): nickname > User.name > Zalo displayName > 이니셜 폴백. page.tsx displayNameOf 동일. */
function displayNameOf(
  c: {
    nickname: string | null;
    user: { name: string | null } | null;
    displayName: string | null;
  },
  unknownLabel: string
): string {
  return c.nickname ?? c.user?.name ?? c.displayName ?? unknownLabel;
}

export interface InboxData {
  items: InboxItem[];
  totalUnread: number;
}

/**
 * 인박스 조회 — 본인(ownerAdminId) 대화 목록 + totalUnread.
 * 마진·금액 미조회(누수 0). lastMessageText/Type 비정규화 미리보기 사용(서브쿼리 제거 perf).
 * selectedId를 넘기면 해당 항목의 selected=true(SSR 초기 하이라이트용 — 클라이언트는 prop으로 재계산).
 */
export async function getInboxData(
  ownerAdminId: string,
  selectedId: string | null
): Promise<InboxData> {
  const tm = await getTranslations("adminMessages");
  const now = new Date();

  const conversations = await prisma.zaloConversation.findMany({
    where: { ownerAdminId },
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      displayName: true,
      nickname: true,
      avatarUrl: true,
      counterpartyType: true,
      threadType: true,
      groupMembers: true,
      lastMessageAt: true,
      lastInboundAt: true,
      unreadCount: true,
      userId: true,
      // 인박스 미리보기 비정규화(perf) — 대화별 messages take1 서브쿼리 제거.
      lastMessageText: true,
      lastMessageType: true,
      // 표시명만 필요(displayNameOf=user.name). villas 서브쿼리는 인박스에서 미사용이라
      // 제거(대화 N개마다 take1 상관 서브쿼리가 돌던 N+1 제거 — perf). villaName은 스레드 헤더 전용.
      user: { select: { name: true } },
    },
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const items: InboxItem[] = conversations.map((c) => {
    const name = displayNameOf(c, tm("inbox.unknownName"));
    const isGroup = c.threadType === ZaloThreadType.GROUP;
    const memberCount = isGroup ? parseGroupMembers(c.groupMembers).length : 0;
    return {
      id: c.id,
      name,
      initials: initials(name),
      avatarUrl: c.avatarUrl,
      counterpartyType: c.counterpartyType as CounterpartyType,
      isGroup,
      memberCount,
      lastText: c.lastMessageText ?? "",
      lastMsgType: c.lastMessageType ?? "text",
      time: inboxTime(c.lastMessageAt, now, tm("inbox.yesterday")),
      unreadCount: c.unreadCount,
      // ADR-0006 D5.5 — 개인계정은 48h 제약 없음. 입력창 항상 활성(만료 배지 미표시).
      windowExpired: false,
      selected: c.id === selectedId,
    };
  });

  return { items, totalUnread };
}

export interface ThreadData {
  header: ChatHeader;
  messages: ChatMessage[];
  hasOlder: boolean;
  oldestCursor: string | null;
  groupMembers: GroupMember[];
  hasUnread: boolean;
}

/**
 * 선택 대화 스레드 조회 — 헤더 + 최근 80개(asc) + hasOlder/oldestCursor + groupMembers + hasUnread.
 * 본인 대화가 아니거나 미존재면 null(라우트는 404, page.tsx는 redirect("/messages")).
 * 누수 0: page.tsx 스레드 select 화이트리스트 동일 — 마진·판매가 미조회.
 */
export async function getThreadData(
  ownerAdminId: string,
  selectedId: string
): Promise<ThreadData | null> {
  const tm = await getTranslations("adminMessages");

  const conv = await prisma.zaloConversation.findFirst({
    where: { id: selectedId, ownerAdminId },
    select: {
      id: true,
      displayName: true,
      nickname: true,
      avatarUrl: true,
      counterpartyType: true,
      threadType: true,
      groupMembers: true,
      translateMode: true,
      lastInboundAt: true,
      unreadCount: true,
      userId: true,
      user: {
        select: {
          name: true,
          zaloUserId: true,
          villas: { select: { name: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      },
      messages: {
        // 성능: 최근 메시지부터 INITIAL_TAKE+1건만. 아래서 asc로 재정렬.
        orderBy: { createdAt: "desc" },
        take: INITIAL_TAKE + 1,
        select: {
          id: true,
          direction: true,
          source: true,
          msgType: true,
          senderUid: true,
          text: true,
          translatedText: true,
          attachmentUrls: true,
          status: true,
          createdAt: true,
          zaloMsgId: true,
          globalMsgId: true,
          cliMsgId: true,
          quotedMsgId: true,
          quotedText: true,
          quotedSender: true,
          reactions: true,
        },
      },
    },
  });

  if (!conv) return null;

  const name = displayNameOf(conv, tm("inbox.unknownName"));
  const counterpartyType = conv.counterpartyType as CounterpartyType;
  const isGroup = conv.threadType === ZaloThreadType.GROUP;

  // 그룹 멤버 스냅샷 zaloId→{name,avatarUrl} 조회 맵(발신자 해석 원천). 1:1은 빈 맵.
  const memberMap = new Map<string, GroupMember>();
  let groupMembers: GroupMember[] = [];
  if (isGroup) {
    const parsed = parseGroupMembers(conv.groupMembers);
    for (const m of parsed) memberMap.set(m.zaloId, m);
    groupMembers = parsed;
  }

  const header: ChatHeader = {
    name,
    initials: initials(name),
    avatarUrl: conv.avatarUrl,
    connected: Boolean(conv.userId && conv.user?.zaloUserId),
    villaName: conv.user?.villas[0]?.name ?? null,
    zaloOriginalName: conv.displayName,
    counterpartyType,
    isGroup,
    translateMode: conv.translateMode as TranslateMode,
    nickname: conv.nickname ?? "",
  };

  // 최근순(desc)으로 INITIAL_TAKE+1건 조회됨 — "더 있음" 판단 후 표시 순서(asc)로 재정렬.
  const rowsDesc = conv.messages;
  const hasOlder = rowsDesc.length > INITIAL_TAKE;
  const recentDesc = hasOlder ? rowsDesc.slice(0, INITIAL_TAKE) : rowsDesc;
  const recentAsc = recentDesc.slice().reverse();
  const oldestCursor = recentAsc.length > 0 ? recentAsc[0].createdAt.toISOString() : null;
  const mapped = toChatMessages(recentAsc, {
    isGroup,
    memberMap,
    headerAvatarUrl: header.avatarUrl,
    headerInitials: header.initials,
  });
  // 답글 인용 점프 앵커 변환 — 수신 답글의 quotedMsgId(globalMsgId)를 버블 앵커 zaloMsgId로 치환.
  const messages = (await resolveQuotedAnchors(mapped, recentAsc, conv.id)) as ChatMessage[];

  return {
    header,
    messages,
    hasOlder,
    oldestCursor,
    groupMembers,
    hasUnread: conv.unreadCount > 0,
  };
}
