// /messages — 운영자 Zalo 채팅 (T6.6, Stitch b14-zalo-chat 변환, ADR-0003·ADR-0007·ADR-0009)
// RSC: ZaloConversation 인박스 + 선택 대화(?c=) 스레드 조회. select 화이트리스트 — 마진·금액 필드 미조회.
// ADR-0007 개인 스코프: where ownerAdminId = session.user.id (관리자A 대화를 B가 못 봄 — 누수 0).
// ADR-0009: 아바타(D8)·별명(D9)·번역모드(D7)·상대타입(D1) + 공유 후보 목록(빌라/제안/정산)을
//   상대 타입별 누수 분기로 서버에서 최소 필드만 조회해 클라(공유 모달)에 전달 — 마진·반대편 통화 미유입.
import type { Metadata } from "next";
import {
  Currency,
  ZaloCounterpartyType,
  ZaloMessageDirection,
  ZaloMessageSource,
} from "@prisma/client";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/serialize";
import { isSellSideType, currencyForType } from "@/lib/zalo-counterparty";
import { Inbox, type InboxItem } from "./inbox";
import {
  ChatPane,
  type ChatMessage,
  type ChatHeader,
  type CounterpartyType,
  type TranslateMode,
  type VillaCandidate,
  type ProposalCandidate,
  type SettlementCandidate,
} from "./chat-pane";
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

/** 리액션 Json({HEART:2,...})을 Record<string,number>로 정규화 — 양수 카운트만. 비정상/빈값은 null. */
function normalizeReactions(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && v > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 정산 yearMonth(YYYY-MM) → "2026년 6월 정산" 표시 라벨 */
function settlementLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}년 ${Number(m)}월 정산`;
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
      nickname: true,
      avatarUrl: true,
      counterpartyType: true,
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
        select: { text: true, msgType: true },
      },
    },
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // 표시명 우선순위 (D9.2): nickname > User.name > Zalo displayName > 이니셜
  const displayNameOf = (c: {
    nickname: string | null;
    user: { name: string | null } | null;
    displayName: string | null;
  }) => c.nickname ?? c.user?.name ?? c.displayName ?? "(이름 미확인)";

  const inboxItems: InboxItem[] = conversations.map((c) => {
    const name = displayNameOf(c);
    return {
      id: c.id,
      name,
      initials: initials(name),
      avatarUrl: c.avatarUrl,
      counterpartyType: c.counterpartyType as CounterpartyType,
      lastText: c.messages[0]?.text ?? "",
      lastMsgType: c.messages[0]?.msgType ?? "text",
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
  let villaCandidates: VillaCandidate[] = [];
  let proposalCandidates: ProposalCandidate[] = [];
  let settlementCandidates: SettlementCandidate[] = [];
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
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            direction: true,
            source: true,
            msgType: true,
            text: true,
            translatedText: true,
            attachmentUrls: true,
            status: true,
            createdAt: true,
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
      const name = displayNameOf(conv);
      const counterpartyType = conv.counterpartyType as CounterpartyType;
      header = {
        name,
        initials: initials(name),
        avatarUrl: conv.avatarUrl,
        connected: Boolean(conv.userId && conv.user?.zaloUserId),
        villaName: conv.user?.villas[0]?.name ?? null,
        zaloOriginalName: conv.displayName,
        counterpartyType,
        translateMode: conv.translateMode as TranslateMode,
        // 별명 편집 인풋 초깃값 — 현재 별명(없으면 빈 문자열)
        nickname: conv.nickname ?? "",
      };

      let prevDay = "";
      const isInboundAvatar = header.avatarUrl;
      const isInboundInitials = header.initials;
      messages = conv.messages.map((m) => {
        const day = dayDivider(m.createdAt);
        const divider = day !== prevDay ? day : null;
        prevDay = day;
        const isInbound = m.direction === ZaloMessageDirection.INBOUND;
        const isSystem = m.source === ZaloMessageSource.SYSTEM;
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
          avatarUrl: isInboundAvatar,
          initials: isInboundInitials,
          // 답글 인용 스냅샷(자기 화면 표시 — R3-2). 둘 중 하나라도 있으면 인용 블록 렌더.
          quotedText: m.quotedText,
          quotedSender: m.quotedSender,
          // 리액션 집계 Json {HEART:n,...} → Record<string,number>로 정규화(아니면 null). 누수 무관.
          reactions: normalizeReactions(m.reactions),
        } satisfies ChatMessage;
      });

      // ── 공유 후보 목록 — 상대 타입별 누수 분기로 최소 필드만 (D2/D4) ──
      // 마진·반대편 통화는 어떤 후보 쿼리에도 미조회. 모달은 이름·식별자 위주.
      if (counterpartyType === ZaloCounterpartyType.SUPPLIER && conv.userId) {
        // 공급자 대화 — 그 공급자 소유 빌라만, 원가만. 제안 후보 없음(고객 전용).
        const villas = await prisma.villa.findMany({
          where: { supplierId: conv.userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            complex: true,
            bedrooms: true,
            bathrooms: true,
            photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            rates: {
              orderBy: { season: "asc" },
              // LOW(비수기) 원가를 대표 표시값으로 — salePrice*/margin 미조회
              select: { season: true, supplierCostVnd: true },
            },
          },
        });
        villaCandidates = serializeBigInt(
          villas.map((v) => {
            const low = v.rates.find((r) => r.season === "LOW") ?? v.rates[0];
            return {
              id: v.id,
              name: v.name,
              complex: v.complex,
              bedrooms: v.bedrooms,
              bathrooms: v.bathrooms,
              photoUrl: v.photos[0]?.url ?? null,
              priceLabelKind: "supplierCostVnd" as const,
              priceVnd: low ? low.supplierCostVnd : null,
              priceKrw: null,
            };
          })
        ) as VillaCandidate[];

        // 본인(supplierId=userId) 정산만 — totalVnd·건수·상태. 판매가·마진 없음.
        const settlements = await prisma.settlement.findMany({
          where: { supplierId: conv.userId },
          orderBy: { yearMonth: "desc" },
          select: {
            id: true,
            yearMonth: true,
            totalVnd: true,
            status: true,
            _count: { select: { items: true } },
          },
        });
        settlementCandidates = serializeBigInt(
          settlements.map((s) => ({
            id: s.id,
            yearMonth: s.yearMonth,
            label: settlementLabel(s.yearMonth),
            totalVnd: s.totalVnd,
            itemCount: s._count.items,
            status: s.status,
          }))
        ) as SettlementCandidate[];
      } else if (isSellSideType(counterpartyType)) {
        // 판매가측 그룹(CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY) — ACTIVE+isSellable 빌라만, 판매가만.
        // 통화는 currencyForType로 분기: CUSTOMER=KRW, TRAVEL_AGENCY/LAND_AGENCY=VND.
        // 원가(supplierCostVnd)·마진(marginType/marginValue)은 화이트리스트에서 영구 제외 — 누수 불변식.
        const sellCurrency = currencyForType(counterpartyType);
        const useKrw = sellCurrency === Currency.KRW;
        const villas = await prisma.villa.findMany({
          where: { status: "ACTIVE", isSellable: true },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            name: true,
            complex: true,
            bedrooms: true,
            bathrooms: true,
            photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            rates: {
              orderBy: { season: "asc" },
              // 판매가만 — salePriceKrw·salePriceVnd 둘 다 화이트리스트. supplierCostVnd·margin* 미조회.
              select: { season: true, salePriceKrw: true, salePriceVnd: true },
            },
          },
        });
        villaCandidates = serializeBigInt(
          villas.map((v) => {
            const low = v.rates.find((r) => r.season === "LOW") ?? v.rates[0];
            return {
              id: v.id,
              name: v.name,
              complex: v.complex,
              bedrooms: v.bedrooms,
              bathrooms: v.bathrooms,
              photoUrl: v.photos[0]?.url ?? null,
              priceLabelKind: (useKrw ? "salePriceKrw" : "salePriceVnd") as
                | "salePriceKrw"
                | "salePriceVnd",
              priceVnd: useKrw ? null : low ? low.salePriceVnd : null,
              priceKrw: useKrw ? (low ? low.salePriceKrw : null) : null,
            };
          })
        ) as VillaCandidate[];

        // 제안 후보 — ACTIVE + 미만료만. 판매가 총액(채널 통화)만. 원가·마진 없음.
        const proposals = await prisma.proposal.findMany({
          where: { status: "ACTIVE", expiresAt: { gt: now } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            clientName: true,
            saleCurrency: true,
            expiresAt: true,
            items: {
              select: {
                totalKrw: true,
                totalVnd: true,
                villa: { select: { name: true } },
              },
            },
          },
        });
        proposalCandidates = serializeBigInt(
          proposals.map((p) => {
            const useKrw = p.saleCurrency === Currency.KRW;
            const totalKrw = p.items.reduce((sum, it) => sum + (it.totalKrw ?? 0), 0);
            const totalVnd = p.items.reduce(
              (sum, it) => sum + (it.totalVnd ?? BigInt(0)),
              BigInt(0)
            );
            const expiresInHours = Math.max(
              0,
              Math.round((p.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000))
            );
            return {
              id: p.id,
              clientName: p.clientName,
              villaNames: p.items.map((it) => it.villa.name),
              currency: p.saleCurrency,
              totalKrw: useKrw ? totalKrw : null,
              totalVnd: useKrw ? null : totalVnd,
              expiresInHours,
            };
          })
        ) as ProposalCandidate[];
      }
    }
  }

  return (
    <div className="-m-4 md:-m-8 h-[calc(100vh-3.5rem)] lg:h-screen flex">
      <AutoRefresh />
      <Inbox
        items={inboxItems}
        totalUnread={totalUnread}
        conversationSelected={Boolean(selectedId)}
      />
      <ChatPane
        conversationId={selectedId ?? null}
        header={header}
        messages={messages}
        windowOpen={windowOpen}
        villaCandidates={villaCandidates}
        proposalCandidates={proposalCandidates}
        settlementCandidates={settlementCandidates}
        hasUnread={
          inboxItems.find((i) => i.id === selectedId)?.unreadCount
            ? true
            : false
        }
      />
    </div>
  );
}
