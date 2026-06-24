"use client";

// /messages 클라이언트 컨테이너 (perf #2, 2026-06-24)
//
// 배경: 인박스 클릭이 ?c= 서버 네비게이션 → page.tsx 전체 재실행(인박스 463개 재조회·재직렬화)이라
//   미세 지연이 남았다. 이 컨테이너가 인박스/선택/스레드 상태를 소유하고, 클릭은 서버 왕복 없이
//   API(/api/zalo/inbox, /api/zalo/conversations/[id]/thread)로 스레드만 교체한다.
//
// - URL: history.pushState로 ?c= 갱신(딥링크·뒤로가기 보존). popstate로 브라우저 뒤/앞 동기화.
// - 폴링: AutoRefresh(router.refresh) 대신 여기서 5초 클라이언트 fetch(탭 숨김 시 정지·복귀 시 즉시 1회).
// - 읽음: 대화 열면 로컬 unread=0 낙관적 + chat-pane MARK_READ PATCH 유지(서버 정합은 폴링이 보장).
//
// 누수 0: 두 API가 본인 스코프 + 화이트리스트를 보존(클라이언트는 그 결과만 렌더).
import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox, type InboxItem } from "./inbox";
import { ResizableSplit } from "./resizable-split";
import { ChatPane } from "./chat-pane";
import { NewMessageToaster } from "./new-message-toaster";
import type { ThreadData } from "./_thread-data";

const POLL_INTERVAL_MS = 5000;

export function MessagesClient({
  initialItems,
  initialTotalUnread,
  initialSelectedId,
  initialThread,
}: {
  initialItems: InboxItem[];
  initialTotalUnread: number;
  initialSelectedId: string | null;
  initialThread: ThreadData | null;
}) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [totalUnread, setTotalUnread] = useState(initialTotalUnread);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [thread, setThread] = useState<ThreadData | null>(initialThread);
  const [threadLoading, setThreadLoading] = useState(false);

  // 스레드 fetch 경합 방지 — 최신 요청만 반영(빠른 연속 클릭 시 옛 응답이 덮어쓰지 않게).
  const threadReqIdRef = useRef(0);
  // 현재 선택 id를 폴링 콜백에서 안정적으로 참조(폴링 effect가 selectedId 변화로 재구독되지 않게).
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // 인박스에서 한 대화의 unread를 0으로 낙관적 갱신 + totalUnread 재계산.
  const clearUnreadLocally = useCallback((id: string) => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (it.id === id && it.unreadCount > 0) {
          changed = true;
          return { ...it, unreadCount: 0 };
        }
        return it;
      });
      if (!changed) return prev;
      setTotalUnread(next.reduce((sum, it) => sum + it.unreadCount, 0));
      return next;
    });
  }, []);

  // 스레드 fetch — 최신 요청만 setThread. 404(타 관리자/삭제)면 목록으로 되돌림.
  const fetchThread = useCallback(
    async (id: string, withLoading: boolean) => {
      const reqId = ++threadReqIdRef.current;
      if (withLoading) setThreadLoading(true);
      try {
        const res = await fetch(`/api/zalo/conversations/${id}/thread`);
        if (reqId !== threadReqIdRef.current) return; // 더 최신 요청이 진행 중 — 폐기
        if (res.status === 404) {
          // 무효·타 관리자 대화 → 목록으로(모바일 백지·id 추측 차단).
          setSelectedId(null);
          setThread(null);
          window.history.pushState(null, "", "/messages");
          return;
        }
        if (!res.ok) return; // 일시 실패는 조용히 — 다음 폴링에 재시도
        const data = (await res.json()) as ThreadData;
        if (reqId !== threadReqIdRef.current) return;
        setThread(data);
      } catch {
        /* noop — 다음 폴링에 재시도 */
      } finally {
        if (reqId === threadReqIdRef.current && withLoading) setThreadLoading(false);
      }
    },
    []
  );

  // 인박스 클릭/토스트 클릭 — 서버 왕복 없이 대화 교체 + URL ?c= 갱신(딥링크·뒤로가기 보존).
  const handleSelect = useCallback(
    (id: string) => {
      if (id === selectedIdRef.current) return; // 같은 대화 재클릭 무시
      setSelectedId(id);
      setThread(null); // 이전 대화 잔상 제거(loading 표시로 교체)
      window.history.pushState(null, "", `/messages?c=${id}`);
      clearUnreadLocally(id); // 낙관적 읽음(뱃지 0). PATCH는 chat-pane이 hasUnread 보고 호출.
      void fetchThread(id, true);
    },
    [clearUnreadLocally, fetchThread]
  );

  // 모바일 뒤로가기/스와이프 — 인박스 복귀.
  const handleBack = useCallback(() => {
    setSelectedId(null);
    setThread(null);
    window.history.pushState(null, "", "/messages");
  }, []);

  // 브라우저 뒤로/앞으로 — URL의 ?c= 를 읽어 선택 상태 동기화.
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("c");
      if (id === selectedIdRef.current) return;
      setSelectedId(id);
      if (id) {
        setThread(null);
        clearUnreadLocally(id);
        void fetchThread(id, true);
      } else {
        setThread(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [clearUnreadLocally, fetchThread]);

  // 인박스만 갱신(폴링·변경 후 공용). 스레드는 호출처가 별도 fetchThread.
  const refreshInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/zalo/inbox");
      if (res.ok) {
        const data = (await res.json()) as { items: InboxItem[]; totalUnread: number };
        setItems(data.items);
        setTotalUnread(data.totalUnread);
      }
    } catch {
      /* noop */
    }
  }, []);

  // 채팅 내 변경(발신·리액션·공유·별명·번역·분류) 후 즉시 갱신 — 스레드 + 인박스 미리보기.
  // chat-pane이 MutationContext로 받아 router.refresh() 대신 호출(서버 왕복 = page.tsx 재실행 제거).
  const handleMutated = useCallback(() => {
    const cur = selectedIdRef.current;
    if (cur) void fetchThread(cur, false); // 로딩 표시 없이 — 자동스크롤은 messages id 변화로
    void refreshInbox();
  }, [fetchThread, refreshInbox]);

  // 폴링 — 5초마다 인박스 갱신 + 열린 대화 스레드 갱신(새 메시지 반영). 탭 숨김 시 정지·복귀 시 즉시 1회.
  // (auto-refresh.tsx 패턴 계승 — visibilitychange로 start/stop)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const pollOnce = async () => {
      await refreshInbox();
      // 열린 대화 스레드 갱신(로딩 표시 없이 — 조용히 새 메시지 반영). chat-pane이 messages id 변화로 자동스크롤.
      const cur = selectedIdRef.current;
      if (cur) void fetchThread(cur, false);
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void pollOnce();
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pollOnce(); // 복귀 즉시 1회
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchThread, refreshInbox]);

  // selected 하이라이트 — 인박스 항목에 현재 선택 반영(서버 selected 무시, 클라 상태가 진실원).
  const itemsWithSelection: InboxItem[] = items.map((it) =>
    it.selected === (it.id === selectedId) ? it : { ...it, selected: it.id === selectedId }
  );

  return (
    <div className="-m-4 md:-m-8 h-[calc(100dvh-3.5rem)] lg:h-screen flex">
      {/* 다른 상대의 신규 채팅 토스트 — 클릭 시 onSelect로 클라이언트 전환(서버 왕복 없음) */}
      <NewMessageToaster
        items={itemsWithSelection}
        selectedId={selectedId}
        onSelect={handleSelect}
      />
      <ResizableSplit
        conversationSelected={!!selectedId}
        inbox={
          <Inbox
            items={itemsWithSelection}
            totalUnread={totalUnread}
            conversationSelected={!!selectedId}
            onSelect={handleSelect}
          />
        }
        chat={
          <ChatPane
            key={selectedId ?? "none"}
            conversationId={selectedId}
            header={thread?.header ?? null}
            messages={thread?.messages ?? []}
            hasOlder={thread?.hasOlder ?? false}
            oldestCursor={thread?.oldestCursor ?? null}
            windowOpen={true}
            groupMembers={thread?.groupMembers ?? []}
            hasUnread={thread?.hasUnread ?? false}
            loading={threadLoading}
            onBack={handleBack}
            onMarkedRead={() => selectedId && clearUnreadLocally(selectedId)}
            onMutated={handleMutated}
          />
        }
      />
    </div>
  );
}
