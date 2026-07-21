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

  // 실시간(SSE) 우선 + 폴링 폴백 (realtime-sse 계약).
  //
  // 기본: EventSource("/api/zalo/stream") 구독. 서버가 새 수신("inbound")/발신("outbound") 신호를
  //   푸시하면 즉시 refreshInbox() + (현재 열린 대화면) fetchThread()로 갱신(1초 이내 반영).
  //   payload는 신호만 — 실데이터는 기존 fetch 재사용(누수 0 경로 보존).
  // 폴백: EventSource 미지원/연결 실패가 지속되면 기존 5초 폴링으로 전환(기능 회귀 0).
  // 가시성: 탭 숨김 시 연결 종료(SSE·폴링 모두), 복귀 시 재연결 + 즉시 1회 갱신.
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let usingFallback = false;
    let errorCount = 0; // 연속 onerror 횟수 — 일시 끊김과 지속 실패 구분.
    let disposed = false;

    // 인박스 + (열린 대화) 스레드 1회 갱신 — 신호 도착·폴링·복귀 공용.
    const refreshOnce = (conversationId?: string) => {
      void refreshInbox();
      const cur = selectedIdRef.current;
      // 신호에 대화 id가 있으면 현재 열린 대화와 일치할 때만 스레드 갱신(불필요한 fetch 절감).
      // 폴링·복귀(신호 없음)는 열린 대화가 있으면 항상 갱신.
      if (cur && (!conversationId || conversationId === cur)) {
        void fetchThread(cur, false);
      }
    };

    // ── 폴링 폴백 ──
    const startPolling = () => {
      if (pollTimer) return;
      usingFallback = true;
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") refreshOnce();
      }, POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    // ── SSE 연결 ──
    const closeStream = () => {
      if (es) {
        es.close();
        es = null;
      }
    };
    const connectStream = () => {
      if (es || disposed) return;
      if (typeof EventSource === "undefined") {
        startPolling(); // 미지원 환경 — 폴링으로.
        return;
      }
      try {
        es = new EventSource("/api/zalo/stream");
      } catch {
        startPolling(); // 생성 실패 — 폴링으로.
        return;
      }
      es.onopen = () => {
        errorCount = 0;
        // SSE가 살아나면 폴백 폴링 정지(중복 갱신 방지).
        if (usingFallback) {
          stopPolling();
          usingFallback = false;
        }
      };
      es.onmessage = (ev) => {
        errorCount = 0;
        // payload는 { type, conversationId } 신호만. 파싱 실패해도 인박스는 갱신.
        let conversationId: string | undefined;
        try {
          const data = JSON.parse(ev.data) as { conversationId?: string };
          if (typeof data?.conversationId === "string") conversationId = data.conversationId;
        } catch {
          /* ready/하트비트 등 — 신호로만 처리 */
        }
        refreshOnce(conversationId);
      };
      es.onerror = () => {
        // 브라우저 EventSource는 자동 재연결을 시도하지만, 지속 실패면 폴링으로 폴백.
        errorCount += 1;
        if (errorCount >= 3 && !usingFallback) {
          closeStream();
          startPolling();
        }
      };
    };

    // ── 가시성 전환 ──
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshOnce(); // 복귀 즉시 1회
        if (usingFallback) startPolling();
        else connectStream();
      } else {
        // 숨김 — 연결·폴링 모두 정지(불필요한 트래픽·연결 유지 회피).
        closeStream();
        stopPolling();
      }
    };

    if (document.visibilityState === "visible") connectStream();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      closeStream();
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchThread, refreshInbox]);

  // selected 하이라이트 — 인박스 항목에 현재 선택 반영(서버 selected 무시, 클라 상태가 진실원).
  const itemsWithSelection: InboxItem[] = items.map((it) =>
    it.selected === (it.id === selectedId) ? it : { ...it, selected: it.id === selectedId }
  );

  // ── iOS 키보드 대응 (messages-kb-viewport 계약) ──
  // 컨테이너가 100dvh 기반 고정 높이인데 iOS는 키보드가 떠도 layout viewport를 줄이지 않아,
  // 첫 포커스에서 사파리 자동 팬이 안 되면 입력창이 키보드 뒤에 가려졌다(두 번째부터만 정상).
  // → visualViewport 높이를 추적해 모바일(<lg)에서 키보드 열림이 감지되면 컨테이너를
  //   보이는 높이(vv.height − 고정 헤더 3.5rem)로 줄이고 scrollTo(0,0)으로 팬을 상쇄한다.
  //   키보드가 닫히면 인라인 height 제거(원래 Tailwind 높이로 복귀). 데스크톱·vv 미지원은 무영향.
  const [kbHeight, setKbHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const MOBILE_HEADER_PX = 56; // 고정 모바일 헤더 3.5rem — 키보드가 떠도 상단에 유지
    const KEYBOARD_MIN_PX = 150; // 이보다 큰 축소만 키보드로 판정(URL바 변화 등 오탐 방지)
    const update = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) {
        setKbHeight(null);
        return;
      }
      const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_PX;
      if (keyboardOpen) {
        window.scrollTo(0, 0); // 사파리 팬 상쇄 — 헤더·컨테이너를 뷰포트 상단에 고정
        setKbHeight(Math.max(240, Math.round(vv.height) - MOBILE_HEADER_PX));
      } else {
        setKbHeight(null);
      }
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    // 모바일: 헤더(3.5rem)+하단 네비(4rem) 제외한 높이 / 데스크톱: 풀높이(하단 네비 없음)
    // 키보드 열림(모바일): 인라인 height로 visual viewport에 맞춤 — 입력창이 항상 키보드 위에 보임
    <div
      className="-m-4 md:-m-8 h-[calc(100dvh-7.5rem-env(safe-area-inset-top))] lg:h-screen flex"
      style={kbHeight != null ? { height: `${kbHeight}px` } : undefined}
    >
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
            // thread 도착 시 ChatPane를 완전한 데이터로 재마운트한다. (로딩 중 thread=null로 먼저
            // 마운트되면 hasOlder/oldestCursor가 false/null로 굳어 "이전 메시지 더보기"가 영영 안 됐다.)
            // 폴링(같은 대화 thread 갱신)은 thread!=null 유지라 key 불변 → 재마운트 없이 메시지만 갱신.
            key={selectedId == null ? "none" : thread == null ? `loading:${selectedId}` : selectedId}
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
