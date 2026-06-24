// /messages — 운영자 Zalo 채팅 (T6.6, Stitch b14-zalo-chat 변환, ADR-0003·ADR-0007·ADR-0009)
// RSC: ZaloConversation 인박스 + 선택 대화(?c=) 스레드 조회. select 화이트리스트 — 마진·금액 필드 미조회.
// ADR-0007 개인 스코프: where ownerAdminId = session.user.id (관리자A 대화를 B가 못 봄 — 누수 0).
// ADR-0009: 아바타(D8)·별명(D9)·번역모드(D7)·상대타입(D1)만 조회.
//   공유 후보(빌라/제안/정산)는 클릭 비용에서 분리(perf, 2026-06-24) — 공유 모달 첫 오픈 시
//   GET /api/zalo/conversations/[id]/candidates로 지연 조회한다(누수 분기는 그 라우트가 보존).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ZaloThreadType } from "@prisma/client";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
// 메시지 매핑 단일 진실원 — page.tsx 초기 로드와 이전 메시지 GET이 동일 함수로 매핑(prepend 정합).
import { toChatMessages } from "@/lib/zalo-chat-message";
import { Inbox, type InboxItem } from "./inbox";
import { ResizableSplit } from "./resizable-split";
import {
  ChatPane,
  type ChatMessage,
  type ChatHeader,
  type CounterpartyType,
  type TranslateMode,
} from "./chat-pane";
import { AutoRefresh } from "./auto-refresh";
import { NewMessageToaster } from "./new-message-toaster";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("messages")} — Villa PMS` };
}

// 수신 메시지가 폴링/refresh 없이는 RSC에 반영되지 않으므로 항상 동적 렌더링.
// (캐시되면 router.refresh()·AutoRefresh가 옛 데이터를 받아 "새로고침해야 보임" 버그)
export const dynamic = "force-dynamic";

/** 이름에서 이니셜 2자 추출 (아바타) — 한글/라틴 공통, 공백 분할 우선 */
function initials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase();
}

/** 그룹 멤버 스냅샷 1건 — groupMembers Json([{zaloId,name,avatarUrl}]) 의 원소.
 *  이름·아바타만 사용(누수 무관: 공개 프로필). 그 외 필드는 무시. */
interface GroupMember {
  zaloId: string;
  name: string | null;
  avatarUrl: string | null;
}

/** groupMembers Json(unknown) → GroupMember[] 정규화. zaloId 없는 항목은 제외.
 *  null·비배열·형식 불일치는 빈 배열. 발신자명·아바타 매핑 + 멤버수 표시의 단일 진실원. */
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

/** 인박스 시각 표기: 오늘 HH:mm / 어제 / 그 외 MM.DD (Asia/Ho_Chi_Minh) */
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

/** 정산 yearMonth(YYYY-MM) → 표시 라벨. 최종 문자열 생성은 i18n 콜백에 위임 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  // 개인 스코프 — 본인(ownerAdminId)이 받은 대화만 (ADR-0007 D3, 누수 0).
  const session = await auth();
  // RBAC(ADR-0013) — 운영자(OWNER/MANAGER/STAFF/ADMIN) 허용. 과거 'ADMIN' 하드코딩은 OWNER로
  // 마이그된 테오가 /messages→/login→/dashboard로 튕기던 버그(RBAC 마이그 누락). 미들웨어와 동일 술어.
  if (!session?.user?.id || !isOperator(session.user.role)) {
    redirect("/login");
  }
  const ownerAdminId = session.user.id;
  const tm = await getTranslations("adminMessages");

  const { c: selectedId } = await searchParams;
  const now = new Date();

  // 인박스 — 마진·금액 필드 미조회(누수 차단). 본인 대화만. 연결된 사용자명/빌라명만.
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
      // 인박스 미리보기 비정규화(perf, 2026-06-24) — 대화별 messages take1 서브쿼리 제거.
      // 그 서브쿼리(463개 대화 × 최신 1건 정렬)가 클릭마다 재실행되던 인박스 병목이었다.
      lastMessageText: true,
      lastMessageType: true,
      user: {
        select: {
          name: true,
          villas: { select: { name: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // 표시명 우선순위 (D9.2): nickname > User.name > Zalo displayName > 이니셜
  const displayNameOf = (
    c: {
      nickname: string | null;
      user: { name: string | null } | null;
      displayName: string | null;
    },
    unknownLabel: string
  ) => c.nickname ?? c.user?.name ?? c.displayName ?? unknownLabel;

  const inboxItems: InboxItem[] = conversations.map((c) => {
    const name = displayNameOf(c, tm("inbox.unknownName"));
    // 그룹 대화(threadType=GROUP) — 그룹 아이콘·멤버수로 1:1과 시각 구분(S4 D4).
    const isGroup = c.threadType === ZaloThreadType.GROUP;
    const memberCount = isGroup ? parseGroupMembers(c.groupMembers).length : 0;
    return {
      id: c.id,
      name,
      initials: initials(name),
      avatarUrl: c.avatarUrl,
      counterpartyType: c.counterpartyType as CounterpartyType,
      isGroup,
      // 멤버 스냅샷이 없으면(groupMembers=null) 0 → 인박스에서 멤버수 칩 생략.
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

  // 선택 대화 스레드
  let header: ChatHeader | null = null;
  let messages: ChatMessage[] = [];
  // 초기엔 최근 80개만 로드(즉시 표시). 더 있으면 hasOlder=true + oldestCursor(가장 오래된 createdAt ISO)로
  // ChatPane이 상단 스크롤 시 이전 메시지를 점진 로드(prepend). 80개 이하면 동작 변화 0.
  let hasOlder = false;
  let oldestCursor: string | null = null;
  // 초기 로드 개수 — 81개 조회로 "더 있음" 판단(80개로 슬라이스).
  const INITIAL_TAKE = 80;
  // 그룹 대화 @멘션용 멤버 목록(이름·아바타·zaloId만 — 누수 무관: 공개 프로필).
  // 그룹이 아니면 빈 배열 → ChatPane 입력창은 @멘션 비활성(1:1 기존 그대로).
  let groupMembers: GroupMember[] = [];
  // ADR-0006 D5.5 — 개인계정은 48h 제약 없음. 채팅 입력창 항상 활성.
  const windowOpen = true;

  if (selectedId) {
    // 소유 스코프 — 본인 대화만 열람 가능(id 추측으로 타 관리자 대화 접근 차단, 누수 0).
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
          // 성능: 최근 메시지부터 INITIAL_TAKE+1건만(4000+ 대화 즉시 표시). 아래서 asc로 재정렬.
          orderBy: { createdAt: "desc" },
          take: INITIAL_TAKE + 1,
          select: {
            id: true,
            direction: true,
            source: true,
            msgType: true,
            // 그룹 메시지 발신자 Zalo id — groupMembers 스냅샷에서 이름·아바타 해석(1:1은 null).
            senderUid: true,
            text: true,
            translatedText: true,
            attachmentUrls: true,
            status: true,
            createdAt: true,
            // 인용 점프(Nike) — 자기 zaloMsgId(점프 앵커)와 인용 대상 zaloMsgId. id·msgId만, 누수 무관.
            zaloMsgId: true,
            quotedMsgId: true,
            // ADR-0009 R3-2/R3-3 — 답글 인용 스냅샷 + 리액션 집계(둘 다 누수 무관: 본문/아이콘 카운트만)
            quotedText: true,
            quotedSender: true,
            reactions: true,
          },
        },
      },
    });

    // 무효·타 관리자 소유 대화 ID → 목록으로 되돌림. (모바일에선 인박스·빈 pane 둘 다 숨어
    //  백지가 되고, 보안상으로도 ID 추측 접근을 깔끔히 차단)
    if (!conv) {
      redirect("/messages");
    }

    {
      const name = displayNameOf(conv, tm("inbox.unknownName"));
      const counterpartyType = conv.counterpartyType as CounterpartyType;
      // 그룹 대화 — 버블에 발신자별 이름·아바타 표시(S4 D4). 1:1은 기존 단일 상대 그대로.
      const isGroup = conv.threadType === ZaloThreadType.GROUP;
      // 그룹 멤버 스냅샷 zaloId→{name,avatarUrl} 조회 맵(발신자 해석 원천). 1:1은 빈 맵.
      const memberMap = new Map<string, GroupMember>();
      if (isGroup) {
        const parsed = parseGroupMembers(conv.groupMembers);
        for (const m of parsed) memberMap.set(m.zaloId, m);
        // @멘션 드롭다운에 넘길 멤버 목록(그룹일 때만). 이름·아바타·zaloId만.
        groupMembers = parsed;
      }
      header = {
        name,
        initials: initials(name),
        avatarUrl: conv.avatarUrl,
        connected: Boolean(conv.userId && conv.user?.zaloUserId),
        villaName: conv.user?.villas[0]?.name ?? null,
        zaloOriginalName: conv.displayName,
        counterpartyType,
        isGroup,
        translateMode: conv.translateMode as TranslateMode,
        // 별명 편집 인풋 초깃값 — 현재 별명(없으면 빈 문자열)
        nickname: conv.nickname ?? "",
      };

      // 최근순(desc)으로 INITIAL_TAKE+1건 조회됨 — "더 있음" 판단 후 표시 순서(asc)로 재정렬.
      // 81개면 더 있음(hasOlder) → 80개로 슬라이스, 80개 이하면 동작 변화 0(hasOlder=false).
      const rowsDesc = conv.messages;
      hasOlder = rowsDesc.length > INITIAL_TAKE;
      const recentDesc = hasOlder ? rowsDesc.slice(0, INITIAL_TAKE) : rowsDesc;
      // 화면 표시 순서(오래된→최신). 가장 오래된 로드 메시지의 createdAt = 이전 더보기 커서.
      const recentAsc = recentDesc.slice().reverse();
      oldestCursor = recentAsc.length > 0 ? recentAsc[0].createdAt.toISOString() : null;
      // 매핑은 공용 유틸로 일원화(GET 엔드포인트와 동일 결과 — prepend 정합).
      messages = toChatMessages(recentAsc, {
        isGroup,
        memberMap,
        headerAvatarUrl: header.avatarUrl,
        headerInitials: header.initials,
      }) as ChatMessage[];
      // 공유 후보(빌라/제안/정산)는 여기서 조회하지 않는다(perf) — 공유 모달 첫 오픈 시
      // GET /api/zalo/conversations/[id]/candidates로 지연 조회(누수 분기는 그 라우트가 보존).
    }
  }

  return (
    <div className="-m-4 md:-m-8 h-[calc(100dvh-3.5rem)] lg:h-screen flex">
      <AutoRefresh />
      {/* 다른 상대의 신규 채팅 토스트 알림 — 현재 대화 외 unread 증가 시 상단 토스트 */}
      <NewMessageToaster items={inboxItems} selectedId={selectedId ?? null} />
      {/* 인박스|채팅 리사이즈 분할 — 데스크톱에서 구분선 드래그로 좌측 너비 조절(너비 localStorage 저장) */}
      <ResizableSplit
        conversationSelected={Boolean(selectedId)}
        inbox={
          <Inbox
            items={inboxItems}
            totalUnread={totalUnread}
            conversationSelected={Boolean(selectedId)}
          />
        }
        chat={
          <ChatPane
            conversationId={selectedId ?? null}
            header={header}
            messages={messages}
            hasOlder={hasOlder}
            oldestCursor={oldestCursor}
            windowOpen={windowOpen}
            groupMembers={groupMembers}
            hasUnread={
              inboxItems.find((i) => i.id === selectedId)?.unreadCount
                ? true
                : false
            }
          />
        }
      />
    </div>
  );
}
