"use client";

// 웹 채팅 인박스 목록 (T-webchat-inbox) — 좌측 패널
// 항목: 언어 뱃지·lastMessageText·상대시간·unread 뱃지·sourcePage·연락처 아이콘·BLOCKED 표시.
// filter 칩(전체/열림/차단), 자체 커서 더보기(서버 페이지네이션 — 클라 slice 금지).
import { useTranslations } from "next-intl";
import {
  type WebChatSessionListItem,
  type WebChatFilter,
  localeBadge,
  hasContact,
} from "./webchat-types";
import { SourcePageLabel } from "./webchat-source-badge";

/** 상대시간(간이) — 방금 / N분 전 / N시간 전 / 어제 / MM.DD (Asia/Ho_Chi_Minh). */
function relativeTime(
  iso: string | null,
  now: number,
  t: ReturnType<typeof useTranslations>
): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return "";
  const diff = now - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("time.now");
  if (min < 60) return t("time.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hoursAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day === 1) return t("time.yesterday");
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/\.$/, "")
    .replace(/\. /, ".");
}

export function WebChatInbox({
  sessions,
  filter,
  totalUnread,
  hasMore,
  loadingMore,
  conversationSelected,
  selectedId,
  onFilter,
  onSelect,
  onLoadMore,
}: {
  sessions: WebChatSessionListItem[];
  filter: WebChatFilter;
  totalUnread: number;
  hasMore: boolean;
  loadingMore: boolean;
  conversationSelected: boolean;
  selectedId: string | null;
  onFilter: (f: WebChatFilter) => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const t = useTranslations("adminWebchat");
  const now = Date.now();
  void conversationSelected; // 폭·hide/show는 ResizableSplit wrapper 책임(시그니처 유지)

  const chips: { key: WebChatFilter; label: string }[] = [
    { key: "open", label: t("filter.open") },
    { key: "blocked", label: t("filter.blocked") },
    { key: "all", label: t("filter.all") },
  ];

  return (
    <section className="flex w-full h-full min-w-0 bg-slate-900 flex-col">
      <div className="px-5 pt-5 pb-3 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-white tracking-tight">{t("title")}</h1>
          {totalUnread > 0 && (
            <span className="bg-blue-600 text-white text-[10px] font-black min-w-[18px] px-1.5 py-0.5 rounded-full text-center">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onFilter(c.key)}
              className={
                filter === c.key
                  ? "px-2.5 py-1 rounded-full bg-blue-600 text-white text-[11px] font-bold"
                  : "px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 hover:text-slate-200 text-[11px] font-medium border border-slate-700"
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sessions.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">{t("empty")}</p>
        ) : (
          <>
            {sessions.map((s) => {
              const selected = s.id === selectedId;
              const blocked = s.status === "BLOCKED";
              const itemClass = selected
                ? "flex items-start gap-3 px-5 py-3.5 bg-slate-800 border-l-2 border-blue-500 w-full text-left"
                : "flex items-start gap-3 px-5 py-3.5 hover:bg-slate-800/60 transition-colors border-l-2 border-transparent w-full text-left";
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={selected ? "true" : undefined}
                  className={itemClass}
                >
                  {/* 언어 뱃지 아바타 */}
                  <span
                    className={
                      blocked
                        ? "w-10 h-10 rounded-full bg-slate-700/40 text-slate-500 flex items-center justify-center font-black text-[11px] shrink-0"
                        : "w-10 h-10 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-black text-[11px] shrink-0"
                    }
                    title={s.visitorLocale}
                  >
                    {localeBadge(s.visitorLocale)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5 gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <SourcePageLabel sourcePage={s.sourcePage} />
                        {hasContact(s) && (
                          <span
                            className="material-symbols-outlined text-[14px] text-emerald-400 shrink-0"
                            title={t("hasContact")}
                          >
                            contact_page
                          </span>
                        )}
                        {blocked && (
                          <span className="shrink-0 inline-flex items-center rounded bg-red-500/15 text-red-400 px-1.5 py-0.5 text-[9px] font-bold">
                            {t("blockedBadge")}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                        {relativeTime(s.lastMessageAt, now, t)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={
                          s.unreadForAdmin > 0
                            ? "text-xs text-slate-300 truncate font-medium"
                            : "text-xs text-slate-400 truncate"
                        }
                      >
                        {s.lastMessageDirection === "OUTBOUND" ? "↩ " : ""}
                        {s.lastMessageText || "—"}
                      </p>
                      {s.unreadForAdmin > 0 && (
                        <span className="bg-blue-600 text-white text-[10px] font-black min-w-[18px] px-1 py-0.5 rounded-full text-center shrink-0">
                          {s.unreadForAdmin}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {hasMore && (
              <div className="px-5 py-3">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  {loadingMore ? t("loading") : t("loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
