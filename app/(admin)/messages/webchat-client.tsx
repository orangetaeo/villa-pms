"use client";

// 웹 채팅 인박스 컨테이너 (T-webchat-inbox)
//
// /messages?tab=webchat 진입 시 렌더. 기존 Zalo MessagesClient와 독립(별도 상태·별도 커서·별도 SSE 구독).
// - 목록/스레드는 서버 API(/api/webchat/*)만 소비 — 누수 0 화이트리스트는 라우트가 보장, 클라는 결과만 렌더.
// - 페이지네이션 서버 side(자체 커서, Zalo 목록과 병합 없음). 클라 slice 금지.
// - 실시간: 기존 realtime-bus SSE(/api/zalo/stream) 재사용. source==="webchat" 신호만 반응(Zalo 무변경).
// - URL: ?tab=webchat&session=<id> pushState(딥링크·알림 링크 호환). popstate 동기화.
import { useCallback, useEffect, useRef, useState } from "react";
import { ResizableSplit } from "./resizable-split";
import { WebChatInbox } from "./webchat-inbox";
import { WebChatThread } from "./webchat-thread";
import { useTranslations } from "next-intl";
import type {
  WebChatSessionListItem,
  WebChatThreadData,
  WebChatFilter,
  WebChatThreadMessage,
  QuickLinkKind,
} from "./webchat-types";

const POLL_INTERVAL_MS = 5000;

export function WebChatClient({
  initialSelectedId,
  canCreateProposal,
}: {
  initialSelectedId: string | null;
  /** 제안 생성 권한(canSetPrice) — page.tsx가 세션 role로 계산해 주입. 서버가 정본. */
  canCreateProposal: boolean;
}) {
  const t = useTranslations("adminWebchat");
  const [sessions, setSessions] = useState<WebChatSessionListItem[]>([]);
  const [filter, setFilter] = useState<WebChatFilter>("open");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [thread, setThread] = useState<WebChatThreadData | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const filterRef = useRef(filter);
  const selectedIdRef = useRef(selectedId);
  const threadReqIdRef = useRef(0);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const totalUnread = sessions.reduce((sum, s) => sum + s.unreadForAdmin, 0);

  // 인박스 조회 — cursor 없으면 교체, 있으면 이어붙임(서버 페이지네이션).
  const fetchInbox = useCallback(async (f: WebChatFilter, cursor: string | null) => {
    try {
      const qs = new URLSearchParams({ filter: f });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/webchat/inbox?${qs.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        sessions: WebChatSessionListItem[];
        nextCursor: string | null;
      };
      if (filterRef.current !== f) return; // 필터가 바뀐 늦은 응답 폐기
      setNextCursor(data.nextCursor);
      if (cursor) {
        setSessions((prev) => {
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...data.sessions.filter((s) => !seen.has(s.id))];
        });
      } else {
        setSessions(data.sessions);
      }
    } catch {
      /* 일시 실패 — 다음 폴링/신호에 재시도 */
    }
  }, []);

  // 목록만 새로고침(현재 필터, 첫 페이지) — 폴링·신호·변경 후 공용.
  const refreshInbox = useCallback(() => {
    void fetchInbox(filterRef.current, null);
  }, [fetchInbox]);

  // 스레드 조회 — 최신 요청만 반영. 404(타 운영자/미존재)면 목록으로.
  const fetchThread = useCallback(
    async (id: string, withLoading: boolean) => {
      const reqId = ++threadReqIdRef.current;
      if (withLoading) setThreadLoading(true);
      try {
        const res = await fetch(`/api/webchat/sessions/${id}`);
        if (reqId !== threadReqIdRef.current) return;
        if (res.status === 404) {
          setSelectedId(null);
          setThread(null);
          window.history.pushState(null, "", "/messages?tab=webchat");
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { session: WebChatThreadData };
        if (reqId !== threadReqIdRef.current) return;
        setThread(data.session);
        // API가 열람 시 unread=0 리셋 → 목록도 낙관적으로 0 반영.
        setSessions((prev) =>
          prev.map((s) => (s.id === id && s.unreadForAdmin > 0 ? { ...s, unreadForAdmin: 0 } : s))
        );
      } catch {
        /* noop */
      } finally {
        if (reqId === threadReqIdRef.current && withLoading) setThreadLoading(false);
      }
    },
    []
  );

  // 최초 로드 + 딥링크 스레드.
  useEffect(() => {
    void fetchInbox("open", null);
    if (initialSelectedId) void fetchThread(initialSelectedId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      if (id === selectedIdRef.current) return;
      setSelectedId(id);
      setThread(null);
      window.history.pushState(null, "", `/messages?tab=webchat&session=${id}`);
      void fetchThread(id, true);
    },
    [fetchThread]
  );

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setThread(null);
    window.history.pushState(null, "", "/messages?tab=webchat");
  }, []);

  // 브라우저 뒤로/앞으로 — URL의 ?session= 동기화(웹챗 탭에 한함).
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") !== "webchat") return; // Zalo 탭 전환은 서버 네비게이션이 처리
      const id = params.get("session");
      if (id === selectedIdRef.current) return;
      setSelectedId(id);
      if (id) {
        setThread(null);
        void fetchThread(id, true);
      } else {
        setThread(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [fetchThread]);

  const handleFilter = useCallback(
    (f: WebChatFilter) => {
      if (f === filterRef.current) return;
      setFilter(f);
      filterRef.current = f;
      setNextCursor(null);
      void fetchInbox(f, null);
    },
    [fetchInbox]
  );

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchInbox(filterRef.current, nextCursor);
    setLoadingMore(false);
  }, [fetchInbox, nextCursor, loadingMore]);

  // 답장 — 낙관적 append 후 서버 반영(번역 반영 위해 스레드 재조회). 409는 상태 배너로.
  const handleSend = useCallback(
    async (text: string) => {
      const id = selectedIdRef.current;
      if (!id || sending) return;
      setSending(true);
      const tempId = `temp-${Date.now()}`;
      const optimistic: WebChatThreadMessage = {
        id: tempId,
        direction: "OUTBOUND",
        text,
        sourceLocale: "ko",
        translatedText: null,
        translatedTo: null,
        translationFailed: false,
        status: "SENT",
        sentBy: null,
        createdAt: new Date().toISOString(),
      };
      setThread((prev) =>
        prev && prev.id === id ? { ...prev, messages: [...prev.messages, optimistic] } : prev
      );
      try {
        const res = await fetch(`/api/webchat/sessions/${id}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as { status?: string };
          // 낙관적 메시지 제거 + 상태 반영(입력창 → 배너).
          setThread((prev) =>
            prev && prev.id === id
              ? {
                  ...prev,
                  status: (data.status as WebChatThreadData["status"]) ?? prev.status,
                  messages: prev.messages.filter((m) => m.id !== tempId),
                }
              : prev
          );
          return;
        }
        if (!res.ok) {
          setThread((prev) =>
            prev && prev.id === id
              ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) }
              : prev
          );
          window.alert(t("sendFailed"));
          return;
        }
        // 성공 — 서버 진실로 재조회(번역·정확한 id/시각) + 목록 미리보기 갱신.
        await fetchThread(id, false);
        refreshInbox();
      } catch {
        setThread((prev) =>
          prev && prev.id === id
            ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) }
            : prev
        );
        window.alert(t("sendFailed"));
      } finally {
        setSending(false);
      }
    },
    [sending, fetchThread, refreshInbox, t]
  );

  // 차단/해제 — confirm 후 POST. 성공 시 상태 반영 + 목록 갱신.
  const handleToggleBlock = useCallback(
    async (nextBlocked: boolean) => {
      const id = selectedIdRef.current;
      if (!id || blocking) return;
      const ok = window.confirm(nextBlocked ? t("block.confirmBlock") : t("block.confirmUnblock"));
      if (!ok) return;
      setBlocking(true);
      try {
        const res = await fetch(`/api/webchat/sessions/${id}/block`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blocked: nextBlocked }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        const status = (data.status as WebChatThreadData["status"]) ?? (nextBlocked ? "BLOCKED" : "OPEN");
        setThread((prev) => (prev && prev.id === id ? { ...prev, status } : prev));
        // BLOCKED은 열림 필터에서 사라지므로 목록 재조회로 정합.
        refreshInbox();
      } catch {
        /* noop */
      } finally {
        setBlocking(false);
      }
    },
    [blocking, refreshInbox, t]
  );

  // 예약 연결 — POST booking-link. 성공 시 스레드 재조회(배지 반영) + 목록 갱신.
  const handleLinkBooking = useCallback(
    async (bookingId: string): Promise<boolean> => {
      const id = selectedIdRef.current;
      if (!id) return false;
      try {
        const res = await fetch(`/api/webchat/sessions/${id}/booking-link`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookingId }),
        });
        if (!res.ok) return false;
        await fetchThread(id, false);
        refreshInbox();
        return true;
      } catch {
        return false;
      }
    },
    [fetchThread, refreshInbox]
  );

  // 예약 해제 — DELETE booking-link(멱등). 성공 시 스레드 재조회 + 목록 갱신.
  const handleUnlinkBooking = useCallback(async (): Promise<boolean> => {
    const id = selectedIdRef.current;
    if (!id) return false;
    try {
      const res = await fetch(`/api/webchat/sessions/${id}/booking-link`, { method: "DELETE" });
      if (!res.ok) return false;
      await fetchThread(id, false);
      refreshInbox();
      return true;
    } catch {
      return false;
    }
  }, [fetchThread, refreshInbox]);

  // 빠른 링크 발송 — POST send-link. 성공 시 스레드 재조회(발신 즉시 반영) + 목록 갱신.
  //   실패 시 서버 error 코드를 그대로 반환(quick-links가 전용 문구로 토스트).
  const handleSendLink = useCallback(
    async (kind: QuickLinkKind): Promise<{ ok: boolean; error?: string }> => {
      const id = selectedIdRef.current;
      if (!id) return { ok: false, error: "send_failed" };
      try {
        const res = await fetch(`/api/webchat/sessions/${id}/send-link`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: data.error ?? "send_failed" };
        }
        await fetchThread(id, false);
        refreshInbox();
        return { ok: true };
      } catch {
        return { ok: false, error: "send_failed" };
      }
    },
    [fetchThread, refreshInbox]
  );

  // 제안 링크 발송 — POST send-link(kind=proposal, proposalId). 성공 시 스레드 재조회 + 목록 갱신.
  //   기존 제안 선택·새 제안 생성(모달) 양쪽이 최종적으로 이 핸들러로 발송한다.
  const handleSendProposal = useCallback(
    async (proposalId: string): Promise<{ ok: boolean; error?: string }> => {
      const id = selectedIdRef.current;
      if (!id) return { ok: false, error: "send_failed" };
      try {
        const res = await fetch(`/api/webchat/sessions/${id}/send-link`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "proposal", proposalId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: data.error ?? "send_failed" };
        }
        await fetchThread(id, false);
        refreshInbox();
        return { ok: true };
      } catch {
        return { ok: false, error: "send_failed" };
      }
    },
    [fetchThread, refreshInbox]
  );

  // 실시간(SSE) + 폴링 폴백 — source==="webchat" 신호에만 반응.
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let usingFallback = false;
    let errorCount = 0;
    let disposed = false;

    const refreshOnce = (conversationId?: string) => {
      refreshInbox();
      const cur = selectedIdRef.current;
      if (cur && (!conversationId || conversationId === cur)) {
        void fetchThread(cur, false);
      }
    };

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

    const closeStream = () => {
      if (es) {
        es.close();
        es = null;
      }
    };
    const connectStream = () => {
      if (es || disposed) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      try {
        es = new EventSource("/api/zalo/stream");
      } catch {
        startPolling();
        return;
      }
      es.onopen = () => {
        errorCount = 0;
        if (usingFallback) {
          stopPolling();
          usingFallback = false;
        }
      };
      es.onmessage = (ev) => {
        errorCount = 0;
        try {
          const data = JSON.parse(ev.data) as { source?: string; conversationId?: string };
          if (data?.source !== "webchat") return; // Zalo·기타 신호 무시
          refreshOnce(typeof data.conversationId === "string" ? data.conversationId : undefined);
        } catch {
          /* ready/하트비트 — 무시(웹챗 신호만 반응) */
        }
      };
      es.onerror = () => {
        errorCount += 1;
        if (errorCount >= 3 && !usingFallback) {
          closeStream();
          startPolling();
        }
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshOnce();
        if (usingFallback) startPolling();
        else connectStream();
      } else {
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

  return (
    <div className="h-full flex">
      <ResizableSplit
        conversationSelected={!!selectedId}
        inbox={
          <WebChatInbox
            sessions={sessions}
            filter={filter}
            totalUnread={totalUnread}
            hasMore={!!nextCursor}
            loadingMore={loadingMore}
            conversationSelected={!!selectedId}
            selectedId={selectedId}
            onFilter={handleFilter}
            onSelect={handleSelect}
            onLoadMore={handleLoadMore}
          />
        }
        chat={
          <WebChatThread
            thread={selectedId && thread?.id === selectedId ? thread : null}
            loading={threadLoading}
            sending={sending}
            blocking={blocking}
            canCreateProposal={canCreateProposal}
            onBack={handleBack}
            onSend={handleSend}
            onToggleBlock={handleToggleBlock}
            onLinkBooking={handleLinkBooking}
            onUnlinkBooking={handleUnlinkBooking}
            onSendLink={handleSendLink}
            onSendProposal={handleSendProposal}
          />
        }
      />
    </div>
  );
}
