// /messages — 운영자 인박스: Zalo(기존) + 웹 채팅(T-webchat-inbox) 소스 탭
// RSC: 초기 인박스 + (딥링크 ?c= 면) 초기 스레드만 서버에서 조회(SSR 신선도)하고 MessagesClient에 주입.
//   클릭 전환·5초 폴링은 클라이언트(MessagesClient)가 API로 처리 — page.tsx 전체 재실행 제거(perf #2).
// 조회·매핑·누수 분기는 _thread-data.ts(getInboxData/getThreadData) 단일 진실원 — 인박스 라우트·스레드 라우트와 공유.
// ADR-0007 개인 스코프: where ownerAdminId = session.user.id (관리자A 대화를 B가 못 봄 — 누수 0).
// 누수 0: select 화이트리스트 — 마진·판매가(KRW)·원가·credential 미조회(_thread-data 보존).
//
// 소스 탭: ?tab=webchat 이면 웹 채팅 탭(WebChatClient, 자체 커서·자체 SSE 구독). 기본은 Zalo(기존 무변경).
//   탭 바만 상단에 감싸고 Zalo 브랜치의 로직/데이터는 그대로 둔다(탭 분기 바깥 무변경).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isOperator, canSetPrice } from "@/lib/permissions";
import { getInboxData, getThreadData } from "./_thread-data";
import { MessagesClient } from "./messages-client";
import { SourceTabs } from "./source-tabs";
import { WebChatClient } from "./webchat-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("messages")} — Villa Go` };
}

// 수신 메시지가 폴링 없이는 RSC에 반영되지 않으므로 초기 SSR은 항상 동적(딥링크 신선도).
export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tab?: string; session?: string }>;
}) {
  // 개인 스코프 — 본인(ownerAdminId)이 받은 대화만 (ADR-0007 D3, 누수 0).
  const session = await auth();
  // RBAC(ADR-0013) — 운영자(OWNER/MANAGER/STAFF/ADMIN) 허용. 미들웨어와 동일 술어.
  if (!session?.user?.id || !isOperator(session.user.role)) {
    redirect("/login");
  }
  const ownerAdminId = session.user.id;

  const { c: selectedId, tab, session: webchatSessionId } = await searchParams;
  const isWebchat = tab === "webchat";

  // 탭 뱃지용 미읽음 집계(양쪽, 저비용 aggregate) — 어느 탭이든 두 탭 뱃지 표시.
  const [zaloAgg, webchatAgg] = await Promise.all([
    prisma.zaloConversation.aggregate({
      where: { ownerAdminId },
      _sum: { unreadCount: true },
    }),
    // 웹챗 세션은 조직 공유 자산 — Zalo 대화(개인 스코프)와 다름 (T-webchat-expand).
    // 인박스가 조직 전체를 보여주므로 미읽음 뱃지도 ownerAdminId 불문 전 세션 집계.
    prisma.webChatSession.aggregate({
      where: { status: { not: "BLOCKED" } },
      _sum: { unreadForAdmin: true },
    }),
  ]);
  const zaloUnread = zaloAgg._sum.unreadCount ?? 0;
  const webchatUnread = webchatAgg._sum.unreadForAdmin ?? 0;

  // ── 웹 채팅 탭 ──
  if (isWebchat) {
    return (
      <div className="-m-4 md:-m-8 h-[calc(100dvh-7.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-screen flex flex-col">
        <SourceTabs active="webchat" zaloUnread={zaloUnread} webchatUnread={webchatUnread} />
        <div className="flex-1 min-h-0">
          {/* 제안 생성 권한(canSetPrice=OWNER/MANAGER) — 모달 B 섹션 UI 게이트. 서버 POST /api/proposals가 정본. */}
          <WebChatClient
            initialSelectedId={webchatSessionId ?? null}
            canCreateProposal={canSetPrice(session.user.role)}
          />
        </div>
      </div>
    );
  }

  // ── Zalo 탭(기존 무변경) ──
  // 초기 인박스(SSR) + 딥링크면 초기 스레드(SSR) 동시 조회 — 두 쿼리는 독립이라 병렬화(perf).
  const [inbox, initialThread] = await Promise.all([
    getInboxData(ownerAdminId, selectedId ?? null),
    selectedId ? getThreadData(ownerAdminId, selectedId) : Promise.resolve(null),
  ]);
  const { items, totalUnread } = inbox;

  // 딥링크 ?c= 가 무효·타 관리자 대화면(스레드 null) 목록으로 되돌림(id 추측 차단, 모바일 백지 방지).
  if (selectedId && !initialThread) {
    redirect("/messages");
  }

  // 탭 바(상단)만 감싸고, MessagesClient는 원본 그대로 렌더.
  // MessagesClient 루트의 자체 여백·전체높이는 wrapper CSS로 중화([&>div]:!m-0/!h-full) — 파일 무변경.
  return (
    <div className="-m-4 md:-m-8 h-[calc(100dvh-7.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-screen flex flex-col">
      <SourceTabs active="zalo" zaloUnread={zaloUnread} webchatUnread={webchatUnread} />
      <div className="flex-1 min-h-0 relative [&>div]:!m-0 [&>div]:!h-full">
        <MessagesClient
          initialItems={items}
          initialTotalUnread={totalUnread}
          initialSelectedId={selectedId ?? null}
          initialThread={initialThread}
        />
      </div>
    </div>
  );
}
