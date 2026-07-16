"use client";

// 인스타그램 DM 인박스(클라이언트) — /messages(Zalo) 2-pane 패턴 재사용.
//   좌: 스레드 목록(미읽음 뱃지·마지막 메시지 미리보기·상대 이름) + 서버 페이지네이션(controlled).
//   우: 대화 뷰(IN 좌/OUT 우 버블·autoReplied 라벨) + 답장 입력 + "카카오 안내 보내기".
//   모바일: 목록↔대화 스택 네비(선택 시 대화만, 뒤로 버튼).
//   24h 응답 창: window.expiresAt 기준 남은 시간 표시, 만료 시 입력 비활성 + 안내.
//   ★ 클라 slice 금지 — 목록은 서버 페이지네이션 그대로. 대화는 서버 200개 상한(messages-inbox-performance).
//   ★ 누수 없음: 모델에 가격/원가 필드 부재.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";

const KST_OFFSET_MS = 9 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

type Direction = "IN" | "OUT";

interface ThreadItem {
  threadId: string;
  senderName: string | null;
  lastMessage: { text: string; direction: Direction; at: string } | null;
  unreadCount: number;
  lastInboundAt: string | null;
  windowExpiresAt: string | null;
  windowExpired: boolean;
}

interface ThreadDetailMessage {
  id: string;
  direction: Direction;
  text: string;
  attachments: unknown;
  receivedAt: string;
  readByAdmin: boolean;
  autoReplied: boolean;
}

interface ThreadDetail {
  threadId: string;
  senderName: string | null;
  window: { lastInboundAt: string | null; expiresAt: string | null; expired: boolean };
  messages: ThreadDetailMessage[];
}

type Toast = { msg: string; kind: "ok" | "err" };

/** UTC ISO → KST 표시 파트. */
function kstParts(iso: string): { dateKey: string; dateLabel: string; hm: string } {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  const dateKey = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dateLabel = `${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return { dateKey, dateLabel, hm };
}

/** 목록 미리보기 시각 — 오늘이면 HH:MM, 아니면 M.D. */
function shortTime(iso: string, nowKstDateKey: string): string {
  const p = kstParts(iso);
  return p.dateKey === nowKstDateKey ? p.hm : p.dateLabel;
}

export default function DmInbox() {
  const t = useTranslations("adminInstagram");

  // 목록 상태(서버 페이지네이션)
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [listLoading, setListLoading] = useState(true);

  // 선택 스레드 대화
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 입력·전송
  const [text, setText] = useState("");
  const [sending, setSending] = useState<null | "reply" | "kakao">(null);

  // 24h 창 갱신용 시계(1분 간격)
  const [now, setNow] = useState(() => Date.now());

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearInterval(id);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // 목록 로드
  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      const res = await fetch(`/api/instagram/dm?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as {
        threads: ThreadItem[];
        total: number;
        pageSize: number;
      };
      setThreads(data.threads);
      setTotal(data.total);
      setPageSize(data.pageSize ?? pageSize);
    } catch {
      notify(t("dm.loadError"), "err");
    } finally {
      setListLoading(false);
    }
  }, [page, pageSize, notify, t]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // 대화 열기(서버가 열람=읽음 처리) → 목록 미읽음 로컬 클리어
  const openThread = useCallback(
    async (threadId: string) => {
      setSelectedId(threadId);
      setDetail(null);
      setText("");
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/instagram/dm/${encodeURIComponent(threadId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("detail failed");
        const data = (await res.json()) as ThreadDetail;
        setDetail(data);
        // 열람 = 읽음: 목록 뱃지 즉시 0으로(서버는 이미 처리됨).
        setThreads((prev) =>
          prev.map((th) => (th.threadId === threadId ? { ...th, unreadCount: 0 } : th))
        );
      } catch {
        notify(t("dm.loadError"), "err");
      } finally {
        setDetailLoading(false);
      }
    },
    [notify, t]
  );

  // 대화 로드/전송 후 하단 스크롤
  useEffect(() => {
    if (detail && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [detail]);

  // 답장 응답 코드 → 안내 매핑
  const handleReplyError = useCallback(
    (status: number, code: string | undefined) => {
      if (status === 400 && code === "TEXT_TOO_LONG") return notify(t("dm.errTooLong"), "err");
      if (status === 400) return notify(t("dm.errEmpty"), "err");
      if (status === 409 && code === "WINDOW_EXPIRED") {
        notify(t("dm.errWindowExpired"), "err");
        // 창 만료를 즉시 반영(입력 잠금).
        setDetail((d) => (d ? { ...d, window: { ...d.window, expired: true } } : d));
        return;
      }
      if (status === 409 && code === "NO_INBOUND") return notify(t("dm.errNoInbound"), "err");
      if (status === 502) return notify(t("dm.errSendFailed"), "err");
      if (status === 403 || status === 401) return notify(t("dm.errForbidden"), "err");
      return notify(t("dm.errGeneric"), "err");
    },
    [notify, t]
  );

  // 답장/카카오 공통 발송
  const sendReply = useCallback(
    async (payload: string, mode: "reply" | "kakao") => {
      if (!selectedId || sending) return;
      const body = payload.trim();
      if (!body) {
        notify(t("dm.errEmpty"), "err");
        return;
      }
      setSending(mode);
      try {
        const res = await fetch(`/api/instagram/dm/${encodeURIComponent(selectedId)}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: body }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          handleReplyError(res.status, data.error);
          return;
        }
        const data = (await res.json()) as {
          ok: true;
          message: { id: string; direction: Direction; text: string; receivedAt: string };
        };
        // 낙관적 반영: 대화에 OUT 추가.
        setDetail((d) =>
          d
            ? {
                ...d,
                messages: [
                  ...d.messages,
                  {
                    id: data.message.id,
                    direction: data.message.direction,
                    text: data.message.text,
                    attachments: null,
                    receivedAt: data.message.receivedAt,
                    readByAdmin: true,
                    autoReplied: false,
                  },
                ],
              }
            : d
        );
        if (mode === "reply") setText("");
        notify(mode === "kakao" ? t("dm.kakaoSent") : t("dm.sent"), "ok");
        // 목록 미리보기 갱신(백그라운드).
        loadList();
      } catch {
        notify(t("dm.errGeneric"), "err");
      } finally {
        setSending(null);
      }
    },
    [selectedId, sending, notify, t, handleReplyError, loadList]
  );

  // 현재 대화의 창 상태(남은 시간)
  const expiresAt = detail?.window.expiresAt ?? null;
  const remainingMs = expiresAt ? Date.parse(expiresAt) - now : -1;
  const windowExpired = !detail
    ? true
    : detail.window.expired || !expiresAt || remainingMs <= 0;
  const remainingLabel = (() => {
    if (windowExpired || remainingMs <= 0) return "";
    const totalMin = Math.floor(remainingMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0
      ? t("dm.windowRemainingHours", { hours: h })
      : t("dm.windowRemainingMinutes", { minutes: m });
  })();
  const hasInbound = !!detail?.window.lastInboundAt;

  const nowKstKey = kstParts(new Date(now).toISOString()).dateKey;

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[30rem] gap-4">
      {/* 좌: 스레드 목록 */}
      <aside
        className={`${
          selectedId ? "hidden md:flex" : "flex"
        } w-full flex-col overflow-hidden rounded-xl border border-slate-800/50 bg-admin-card md:w-80 md:shrink-0`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-bold text-slate-200">{t("dm.threadListTitle")}</span>
          <span className="text-[11px] tabular-nums text-slate-500">{total}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-800/50" />
              ))}
            </div>
          ) : threads.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-500">{t("dm.empty")}</p>
              <p className="mt-1 text-[12px] text-slate-600">{t("dm.emptyHint")}</p>
            </div>
          ) : (
            <ul>
              {threads.map((th) => {
                const active = th.threadId === selectedId;
                const preview =
                  th.lastMessage?.text?.trim() ||
                  (th.lastMessage ? t("dm.mediaLabel") : t("dm.noPreview"));
                return (
                  <li key={th.threadId}>
                    <button
                      type="button"
                      onClick={() => openThread(th.threadId)}
                      className={`flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition-colors ${
                        active ? "bg-slate-800/60" : "hover:bg-slate-800/30"
                      }`}
                    >
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/30 to-indigo-500/30 text-slate-300">
                        <span className="material-symbols-outlined text-[18px]">person</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold text-slate-100">
                            {th.senderName ?? t("card.noVilla")}
                          </span>
                          {th.lastMessage && (
                            <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                              {shortTime(th.lastMessage.at, nowKstKey)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] text-slate-400">
                            {th.lastMessage?.direction === "OUT" && (
                              <span className="text-slate-500">{t("dm.you")}: </span>
                            )}
                            {preview}
                          </span>
                          {th.unreadCount > 0 && (
                            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-500 px-1.5 text-[10px] font-bold tabular-nums text-white">
                              {th.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* 목록 페이지네이션(controlled) */}
        <div className="border-t border-slate-800 px-2 py-1">
          <PaginationBar
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </div>
      </aside>

      {/* 우: 대화 뷰 */}
      <section
        className={`${
          selectedId ? "flex" : "hidden md:flex"
        } min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800/50 bg-admin-card`}
      >
        {!selectedId ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
            {t("dm.selectThread")}
          </div>
        ) : (
          <>
            {/* 대화 헤더 */}
            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800 md:hidden"
                aria-label={t("dm.back")}
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              </button>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/30 to-indigo-500/30 text-slate-300">
                <span className="material-symbols-outlined text-[18px]">person</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-100">
                  {detail?.senderName ?? t("card.noVilla")}
                </p>
                <p
                  className={`text-[11px] font-semibold ${
                    windowExpired ? "text-red-400" : "text-emerald-300"
                  }`}
                >
                  {windowExpired
                    ? hasInbound
                      ? t("dm.windowExpiredTitle")
                      : t("dm.windowNoInbound")
                    : remainingLabel}
                </p>
              </div>
            </div>

            {/* 메시지 영역 */}
            <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
              {detailLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`h-10 w-2/3 animate-pulse rounded-2xl bg-slate-800/50 ${
                        i % 2 ? "ml-auto" : ""
                      }`}
                    />
                  ))}
                </div>
              ) : detail && detail.messages.length > 0 ? (
                <MessageList messages={detail.messages} t={t} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {t("dm.loading")}
                </div>
              )}
            </div>

            {/* 입력 푸터 */}
            <div className="border-t border-slate-800 px-4 py-3">
              {windowExpired ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                  <p className="text-[12px] font-bold text-red-300">
                    {hasInbound ? t("dm.windowExpiredTitle") : t("dm.windowNoInbound")}
                  </p>
                  {hasInbound && (
                    <p className="mt-0.5 text-[11px] text-red-300/80">{t("dm.windowExpiredHint")}</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          sendReply(text, "reply");
                        }
                      }}
                      rows={2}
                      maxLength={1000}
                      placeholder={t("dm.inputPlaceholder")}
                      className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                    />
                    <button
                      type="button"
                      onClick={() => sendReply(text, "reply")}
                      disabled={!!sending || !text.trim()}
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-admin-primary px-4 text-sm font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">send</span>
                      {sending === "reply" ? t("dm.sending") : t("dm.send")}
                    </button>
                  </div>
                  {/* 카카오 안내 원클릭 */}
                  <button
                    type="button"
                    onClick={() => sendReply(t("dm.kakaoMessage"), "kakao")}
                    disabled={!!sending}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">forum</span>
                    {sending === "kakao" ? t("dm.kakaoSending") : t("dm.kakaoButton")}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* 토스트 */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg ${
            toast.kind === "ok" ? "bg-admin-primary text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/** 메시지 버블 목록 — 날짜 구분선 + IN 좌/OUT 우 버블. */
function MessageList({
  messages,
  t,
}: {
  messages: ThreadDetailMessage[];
  t: ReturnType<typeof useTranslations>;
}) {
  let lastDate = "";
  return (
    <>
      {messages.map((m) => {
        const p = kstParts(m.receivedAt);
        const showDivider = p.dateKey !== lastDate;
        lastDate = p.dateKey;
        const out = m.direction === "OUT";
        const hasText = !!m.text?.trim();
        const hasMedia = !hasText && m.attachments != null;
        return (
          <div key={m.id}>
            {showDivider && (
              <div className="my-3 flex items-center justify-center">
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
                  {p.dateLabel}
                </span>
              </div>
            )}
            <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div className={`flex max-w-[78%] flex-col ${out ? "items-end" : "items-start"}`}>
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                    out
                      ? "rounded-br-md bg-admin-primary text-white"
                      : "rounded-bl-md bg-slate-800 text-slate-200"
                  }`}
                >
                  {hasMedia ? (
                    <span className="italic text-slate-400">{t("dm.mediaLabel")}</span>
                  ) : hasText ? (
                    m.text
                  ) : (
                    <span className="italic opacity-70">{t("dm.noPreview")}</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 px-1">
                  {out && m.autoReplied && (
                    <span className="inline-flex items-center rounded border border-slate-600/60 bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                      {t("dm.autoReplied")}
                    </span>
                  )}
                  <span className="text-[10px] tabular-nums text-slate-500">{p.hm}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
