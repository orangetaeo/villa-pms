"use client";

// /messages 좌측 인박스 (b14 LEFT pane) — 공급자+고객 혼합 목록 + 검색 + 상대 타입 필터
// ADR-0009: 아바타 img+이니셜 폴백(D8), 상대 타입 배지·필터 칩(D1).
// perf #2: onSelect가 있으면 클라이언트 전환(button, 서버 왕복 없음). 없으면(레거시) <Link href=?c=>.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CounterpartyType } from "./chat-pane";
import { CounterpartyBadge } from "./counterparty-badge";

export interface InboxItem {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  counterpartyType: CounterpartyType;
  // 그룹(단톡방) 여부 — true면 그룹 아이콘·멤버수로 1:1과 시각 구분(S4 D4).
  isGroup: boolean;
  // 그룹 멤버수(groupMembers 배열 길이). 0이면(스냅샷 없음) 멤버수 칩 생략.
  memberCount: number;
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
  conversationSelected,
  onSelect,
}: {
  items: InboxItem[];
  totalUnread: number;
  // 모바일(<lg): 대화 선택 시 인박스 숨김(채팅 전체폭). 데스크톱(lg:)은 항상 표시.
  conversationSelected: boolean;
  // perf #2: 있으면 클릭 시 서버 네비게이션 대신 클라이언트 전환(MessagesClient.handleSelect).
  onSelect?: (id: string) => void;
}) {
  const t = useTranslations("adminMessages");
  const router = useRouter();
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

  // 너비·모바일 hide/show·우측 구분선은 ResizableSplit wrapper가 담당.
  // 인박스는 부여받은 폭을 채우기만 한다(w-full h-full).
  void conversationSelected; // wrapper로 책임 이전(prop 시그니처 유지 — page.tsx 호환)
  return (
    <section className="flex w-full h-full min-w-0 bg-slate-900 flex-col">
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
          filtered.map((item) => {
            const itemClass =
              item.selected
                ? "flex items-start gap-3 px-5 py-4 bg-slate-800 border-l-2 border-blue-500"
                : "flex items-start gap-3 px-5 py-4 hover:bg-slate-800/60 transition-colors border-l-2 border-transparent";
            const inner = (
              <>
              <Avatar
                avatarUrl={item.avatarUrl}
                initials={item.initials}
                isGroup={item.isGroup}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {/* 그룹 표시(D4) — 이름 앞 그룹 아이콘 + 뒤 멤버수 칩으로 1:1과 시각 구분 */}
                    {item.isGroup && (
                      <span
                        className="material-symbols-outlined text-[16px] text-teal-400 shrink-0"
                        title={t("group.label")}
                      >
                        groups
                      </span>
                    )}
                    <span className="text-sm font-bold text-white truncate">{item.name}</span>
                    {item.isGroup && item.memberCount > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 tabular-nums">
                        <span className="material-symbols-outlined text-[12px] leading-none">person</span>
                        {item.memberCount}
                      </span>
                    )}
                    {!item.isGroup && (
                      <CounterpartyBadge type={item.counterpartyType} t={t} size="xs" />
                    )}
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
              </>
            );
            // perf #2: onSelect면 클라이언트 전환(button — 서버 왕복 없음). 없으면 레거시 <Link href=?c=>.
            if (onSelect) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={item.selected ? "true" : undefined}
                  className={`${itemClass} w-full text-left`}
                >
                  {inner}
                </button>
              );
            }
            return (
              <Link
                key={item.id}
                href={`/messages?c=${item.id}`}
                // 탭 직전 해당 대화 데이터를 미리 가져와(prefetch) 열 때 머뭇거림 제거.
                onPointerDown={() => router.prefetch(`/messages?c=${item.id}`)}
                aria-current={item.selected ? "true" : undefined}
                className={itemClass}
              >
                {inner}
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

/** 아바타 — avatarUrl 있으면 img(onError 시 폴백), 없으면 폴백.
 *  그룹(isGroup)은 폴백이 그룹 아이콘(여러 사람), 1:1은 이니셜 원 (D8.3 / S4 D4). */
function Avatar({
  avatarUrl,
  initials,
  isGroup = false,
}: {
  avatarUrl: string | null;
  initials: string;
  isGroup?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  if (avatarUrl && !broken) {
    // 외부 Zalo CDN URL 만료 리스크 — onError 시 폴백. next/image 대신 <img>(만료 안전).
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
  if (isGroup) {
    // 그룹 폴백 — 그룹 아이콘(아바타가 없거나 깨졌을 때 1:1 이니셜 대신).
    return (
      <div className="w-10 h-10 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-[22px]">groups</span>
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
      {initials}
    </div>
  );
}
