// /messages — 운영자 Zalo 채팅 (T6.6, Stitch b14-zalo-chat 변환, ADR-0003·ADR-0007)
// RSC: ZaloConversation 인박스 + 선택 대화(?c=) 스레드 조회. select 화이트리스트 — 마진·금액 필드 미조회.
// ADR-0007 개인 스코프: where ownerAdminId = session.user.id (관리자A 대화를 B가 못 봄 — 누수 0).
import type { Metadata } from "next";
import {
  ZaloMessageDirection,
  ZaloMessageSource,
} from "@prisma/client";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Inbox, type InboxItem } from "./inbox";
import { ChatPane, type ChatMessage, type ChatHeader } from "./chat-pane";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = {
  title: "메시지 — Villa PMS",
};

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

/** 인박스 시각 표기: 오늘 HH:mm / 어제 / 그 외 MM.DD (Asia/Ho_Chi_Minh) */
function inboxTime(date: Date | null, now: Date): string {
  if (!date) return "";
  const tz = "Asia/Ho_Chi_Minh";
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ko-KR", { timeZone: tz, ...opts }).format(d);
  const dayKey = (d: Date) => fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const key = dayKey(date);
  if (key === today) return fmt(date, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (key === yesterday) return "어제";
  return fmt(date, { month: "2-digit", day: "2-digit" }).replace(/\.$/, "").replace(/\. /, ".");
}

/** 스레드 메시지 시각 HH:mm (Asia/Ho_Chi_Minh) */
function msgTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 날짜 구분자 YYYY.MM.DD (Asia/Ho_Chi_Minh) */
function dayDivider(date: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  // 개인 스코프 — 본인(ownerAdminId)이 받은 대화만 (ADR-0007 D3, 누수 0).
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    redirect("/login");
  }
  const ownerAdminId = session.user.id;

  const { c: selectedId } = await searchParams;
  const now = new Date();

  // 인박스 — 마진·금액 필드 미조회(누수 차단). 본인 대화만. 연결된 사용자명/빌라명만.
  const conversations = await prisma.zaloConversation.findMany({
    where: { ownerAdminId },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      displayName: true,
      lastMessageAt: true,
      lastInboundAt: true,
      unreadCount: true,
      userId: true,
      user: {
        select: {
          name: true,
          villas: { select: { name: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { text: true },
      },
    },
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const inboxItems: InboxItem[] = conversations.map((c) => {
    const name = c.user?.name ?? c.displayName ?? "(이름 미확인)";
    return {
      id: c.id,
      name,
      initials: initials(name),
      lastText: c.messages[0]?.text ?? "",
      time: inboxTime(c.lastMessageAt, now),
      unreadCount: c.unreadCount,
      // ADR-0006 D5.5 — 개인계정은 48h 제약 없음. 입력창 항상 활성(만료 배지 미표시).
      windowExpired: false,
      selected: c.id === selectedId,
    };
  });

  // 선택 대화 스레드
  let header: ChatHeader | null = null;
  let messages: ChatMessage[] = [];
  // ADR-0006 D5.5 — 개인계정은 48h 제약 없음. 채팅 입력창 항상 활성.
  const windowOpen = true;

  if (selectedId) {
    // 소유 스코프 — 본인 대화만 열람 가능(id 추측으로 타 관리자 대화 접근 차단, 누수 0).
    const conv = await prisma.zaloConversation.findFirst({
      where: { id: selectedId, ownerAdminId },
      select: {
        id: true,
        displayName: true,
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
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            direction: true,
            source: true,
            text: true,
            translatedText: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (conv) {
      const name = conv.user?.name ?? conv.displayName ?? "(이름 미확인)";
      header = {
        name,
        initials: initials(name),
        connected: Boolean(conv.userId && conv.user?.zaloUserId),
        villaName: conv.user?.villas[0]?.name ?? null,
      };

      let prevDay = "";
      messages = conv.messages.map((m) => {
        const day = dayDivider(m.createdAt);
        const divider = day !== prevDay ? day : null;
        prevDay = day;
        const isInbound = m.direction === ZaloMessageDirection.INBOUND;
        const isSystem = m.source === ZaloMessageSource.SYSTEM;
        return {
          id: m.id,
          kind: isSystem ? "system" : isInbound ? "inbound" : "outbound",
          text: m.text ?? "",
          translatedText: m.translatedText,
          time: msgTime(m.createdAt),
          status: m.status,
          dayDivider: divider,
          initials: header!.initials,
        } satisfies ChatMessage;
      });
    }
  }

  return (
    <div className="-m-4 md:-m-8 h-[calc(100vh-3.5rem)] lg:h-screen flex">
      <AutoRefresh />
      <Inbox items={inboxItems} totalUnread={totalUnread} />
      <ChatPane
        conversationId={selectedId ?? null}
        header={header}
        messages={messages}
        windowOpen={windowOpen}
        hasUnread={
          inboxItems.find((i) => i.id === selectedId)?.unreadCount
            ? true
            : false
        }
      />
    </div>
  );
}
