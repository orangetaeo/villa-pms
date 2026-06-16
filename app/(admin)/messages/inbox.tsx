"use client";

// /messages 좌측 인박스 (b14 LEFT pane) — 공급자 대화 목록 + 검색
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

export interface InboxItem {
  id: string;
  name: string;
  initials: string;
  lastText: string;
  time: string;
  unreadCount: number;
  windowExpired: boolean;
  selected: boolean;
}

export function Inbox({
  items,
  totalUnread,
}: {
  items: InboxItem[];
  totalUnread: number;
}) {
  const t = useTranslations("adminMessages");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <section className="w-[280px] sm:w-[320px] shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col">
      <div className="px-5 pt-6 pb-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white tracking-tight">{t("title")}</h1>
          {totalUnread > 0 && (
            <span className="bg-blue-600 text-white text-[10px] font-black min-w-[18px] px-1.5 py-0.5 rounded-full text-center">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-500 text-sm">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full bg-slate-800/60 border border-slate-700 text-sm rounded-lg pl-9 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-200 placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">{t("empty")}</p>
        ) : (
          filtered.map((item) => (
            <Link
              key={item.id}
              href={`/messages?c=${item.id}`}
              aria-current={item.selected ? "true" : undefined}
              className={
                item.selected
                  ? "flex items-start gap-3 px-5 py-4 bg-slate-800 border-l-2 border-blue-500"
                  : "flex items-start gap-3 px-5 py-4 hover:bg-slate-800/60 transition-colors border-l-2 border-transparent"
              }
            >
              <div className="w-10 h-10 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
                {item.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-bold text-white truncate">{item.name}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums shrink-0 ml-2">
                    {item.time}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={
                      item.unreadCount > 0
                        ? "text-xs text-slate-300 truncate font-medium"
                        : "text-xs text-slate-400 truncate"
                    }
                  >
                    {item.lastText || "—"}
                  </p>
                  {item.unreadCount > 0 ? (
                    <span className="bg-blue-600 text-white text-[10px] font-black min-w-[18px] px-1 py-0.5 rounded-full text-center shrink-0">
                      {item.unreadCount}
                    </span>
                  ) : item.windowExpired ? (
                    <span className="bg-slate-700/80 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0">
                      {t("windowExpiredBadge")}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
