"use client";

// /messages 좌측 인박스 (b14 LEFT pane) — 공급자+고객 혼합 목록 + 검색 + 상대 타입 필터
// ADR-0009: 아바타 img+이니셜 폴백(D8), 상대 타입 배지·필터 칩(D1).
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CounterpartyType } from "./chat-pane";
import { CounterpartyBadge } from "./counterparty-badge";

export interface InboxItem {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  counterpartyType: CounterpartyType;
  lastText: string;
  lastMsgType: string;
  time: string;
  unreadCount: number;
  windowExpired: boolean;
  selected: boolean;
}

type Filter = "ALL" | CounterpartyType;

/** 마지막 메시지 미리보기 — 공유 메시지는 텍스트가 비거나 요약이므로 종류 라벨로 폴백 */
function previewText(item: InboxItem, t: ReturnType<typeof useTranslations>): string {
  if (item.lastText) return item.lastText;
  switch (item.lastMsgType) {
    case "photo":
      return t("preview.photo");
    case "villa_share":
      return t("preview.villaShare");
    case "proposal_share":
      return t("preview.proposalShare");
    case "settlement_share":
      return t("preview.settlementShare");
    default:
      return "—";
  }
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
  const [filter, setFilter] = useState<Filter>("ALL");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter !== "ALL" && i.counterpartyType !== filter) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, filter]);

  const chips: { key: Filter; label: string }[] = [
    { key: "ALL", label: t("filter.all") },
    { key: "SUPPLIER", label: t("counterparty.supplier") },
    { key: "CUSTOMER", label: t("counterparty.customer") },
    { key: "TRAVEL_AGENCY", label: t("counterparty.travelAgency") },
    { key: "LAND_AGENCY", label: t("counterparty.landAgency") },
    { key: "UNKNOWN", label: t("counterparty.unknown") },
  ];

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
        {/* 상대 타입 필터 칩 (D1) */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
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
              <Avatar avatarUrl={item.avatarUrl} initials={item.initials} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-bold text-white truncate">{item.name}</span>
                    <CounterpartyBadge type={item.counterpartyType} t={t} size="xs" />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
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
                    {previewText(item, t)}
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

/** 아바타 — avatarUrl 있으면 img(onError 시 이니셜 폴백), 없으면 이니셜 원 (D8.3) */
function Avatar({ avatarUrl, initials }: { avatarUrl: string | null; initials: string }) {
  const [broken, setBroken] = useState(false);
  if (avatarUrl && !broken) {
    // 외부 Zalo CDN URL 만료 리스크 — onError 시 이니셜 폴백. next/image 대신 <img>(만료 안전).
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        className="w-10 h-10 rounded-full object-cover shrink-0 bg-slate-700"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
      {initials}
    </div>
  );
}
