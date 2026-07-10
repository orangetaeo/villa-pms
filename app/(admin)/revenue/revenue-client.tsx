"use client";

// 매출관리 클라이언트 — 필터 바 + 검색 + 정렬 + 합계 푸터 + CSV 내보내기 (read-only)
//
// ★ 서버(page.tsx)에서 isOperator+canViewFinance 게이트를 통과한 운영자만 도달.
//   여기서는 "받은 데이터만" 렌더하며, VND는 직렬화 경계상 string으로 받는다(BigInt 금지).
// 다크 admin 토큰. statistics-client·date-range-filter 스타일·URL 동기화 패턴 일관 적용.

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatThousands } from "@/lib/format";
import DateRangeFilter from "@/components/admin/statistics/date-range-filter";
import KpiCard from "@/components/admin/statistics/kpi-card";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

// 직렬화된 거래 행(VND BigInt → string) — page.tsx serializeBigInt 결과 형태와 정합.
interface RevenueTxnDto {
  id: string;
  bookingId: string;
  date: string;
  type: "ROOM" | "MINIBAR" | "SERVICE";
  villaId: string;
  villaName: string;
  channel: "TRAVEL_AGENCY" | "LAND_AGENCY" | "DIRECT" | null;
  partnerName: string | null;
  label: string;
  saleKrw: number | null;
  saleVnd: string | null;
  saleUsd: number | null;
  costVnd: string | null;
  saleVndEquivalent: string | null;
  marginVnd: string | null;
  fxMissing: boolean;
}

interface RevenueTotalsDto {
  count: number;
  saleKrw: number;
  saleVnd: string;
  saleUsd: number;
  costVnd: string;
  marginVnd: string;
  integratedRevenueVnd: string;
  fxMissingCount: number;
}

interface PeriodMeta {
  fromText: string;
  toText: string;
  presetKey: string | null;
}

interface ActiveFilters {
  types: ("ROOM" | "MINIBAR" | "SERVICE")[];
  channel: "TRAVEL_AGENCY" | "LAND_AGENCY" | "DIRECT" | null;
  villaId: string | null;
  partnerId: string | null;
  currency: "KRW" | "VND" | "USD" | null;
  includeAllStatuses: boolean;
}

interface Props {
  txns: RevenueTxnDto[];
  totals: RevenueTotalsDto;
  period: PeriodMeta;
  villas: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  activeFilters: ActiveFilters;
}

type SortKey = "date" | "saleVnd" | "marginVnd";
type SortDir = "asc" | "desc";

const TYPE_KEYS = ["ROOM", "MINIBAR", "SERVICE"] as const;
const CHANNEL_KEYS = ["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"] as const;

const TYPE_ICON: Record<string, string> = {
  ROOM: "hotel",
  MINIBAR: "local_bar",
  SERVICE: "room_service",
};

// 유형별 VND 매출 구성 바 색(요약 섹션) — 객실료=admin primary, 미니바=vnd, 부가서비스=emerald.
const TYPE_BAR_COLOR: Record<string, string> = {
  ROOM: "bg-admin-primary",
  MINIBAR: "bg-admin-vnd",
  SERVICE: "bg-emerald-500",
};

export default function RevenueClient(props: Props) {
  const t = useTranslations("revenue");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // 클라 페이지네이션 — 검색·정렬·데이터 변경 시 1페이지로 (전체 로드 후 메모리 슬라이스)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // URL 동기화 — 필터 1개 변경 시 해당 파라미터만 set/delete 후 router.replace(server 재로드).
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // 유형 토글 — types= 콤마 목록. 전체 선택(빈 목록)이면 파라미터 삭제.
  const toggleType = (type: string) => {
    const cur = new Set(props.activeFilters.types);
    if (cur.has(type as never)) cur.delete(type as never);
    else cur.add(type as never);
    const arr = TYPE_KEYS.filter((k) => cur.has(k));
    setParam("types", arr.length === 0 || arr.length === TYPE_KEYS.length ? null : arr.join(","));
  };

  // 검색(클라이언트) + 정렬 — 투숙객·빌라·파트너·품목명 부분일치. 서버가 기간·필터로 1차 거른 행 대상.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = props.txns;
    if (q) {
      r = r.filter(
        (x) =>
          x.label.toLowerCase().includes(q) ||
          x.villaName.toLowerCase().includes(q) ||
          (x.partnerName ?? "").toLowerCase().includes(q)
      );
    }
    const sorted = [...r].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      } else {
        // VND 금액 정렬 — 문자열 BigInt 비교(정밀도 유지). null은 최하단.
        const av = a[sortKey];
        const bv = b[sortKey];
        const an = av === null ? null : BigInt(av);
        const bn = bv === null ? null : BigInt(bv);
        if (an === null && bn === null) cmp = 0;
        else if (an === null) cmp = -1;
        else if (bn === null) cmp = 1;
        else cmp = an < bn ? -1 : an > bn ? 1 : 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [props.txns, search, sortKey, sortDir]);

  // 필터·검색·정렬이 바뀌면 1페이지로 되돌림
  useEffect(() => setPage(1), [search, sortKey, sortDir, props.txns]);

  // 현재 페이지 슬라이스 — 합계 푸터는 rows 전체 기준이므로 여기서만 잘라낸다
  const paged = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize]
  );

  // 검색 후(클라이언트 필터) 합계는 화면에 보이는 행 기준으로 재계산(통화 분리·BigInt 문자열 누적).
  const visibleTotals = useMemo(() => {
    let saleKrw = 0;
    let saleVnd = 0n;
    let saleUsd = 0;
    let marginVnd = 0n;
    let integratedRevenueVnd = 0n;
    let fxMissingCount = 0;
    let marginCounted = false;
    for (const x of rows) {
      if (x.saleKrw !== null) saleKrw += x.saleKrw;
      if (x.saleVnd !== null) saleVnd += BigInt(x.saleVnd);
      if (x.saleUsd !== null) saleUsd += x.saleUsd;
      if (x.saleVndEquivalent !== null) integratedRevenueVnd += BigInt(x.saleVndEquivalent);
      if (x.fxMissing) fxMissingCount++;
      if (x.marginVnd !== null) {
        marginVnd += BigInt(x.marginVnd);
        marginCounted = true;
      }
    }
    return {
      count: rows.length,
      saleKrw,
      saleVnd: saleVnd.toString(),
      saleUsd,
      integratedRevenueVnd: integratedRevenueVnd.toString(),
      fxMissingCount,
      marginVnd: marginCounted ? marginVnd.toString() : null,
    };
  }, [rows]);

  // 유형별(객실료/미니바/부가서비스) VND 매출 구성 — 상단 요약 분해 바(서버 필터 기준 props.txns).
  // KRW 채널 객실료(saleVnd=null)는 VND 구성에서 자연 제외(ADR-0003 통화 분리).
  const typeBreakdown = useMemo(() => {
    const byType: Record<RevenueTxnDto["type"], bigint> = { ROOM: 0n, MINIBAR: 0n, SERVICE: 0n };
    for (const x of props.txns) {
      if (x.saleVnd !== null) byType[x.type] += BigInt(x.saleVnd);
    }
    const total = byType.ROOM + byType.MINIBAR + byType.SERVICE;
    return { byType, total };
  }, [props.txns]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // CSV 내보내기 — 현재 서버 필터(기간·유형·채널·빌라·파트너·통화·전체상태) 그대로 export route로.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    const af = props.activeFilters;
    // 기간 — 프리셋 또는 from/to. searchParams의 range/from/to 그대로 승계.
    for (const k of ["range", "from", "to"] as const) {
      const v = searchParams.get(k);
      if (v) params.set(k, v);
    }
    if (af.types.length) params.set("types", af.types.join(","));
    if (af.channel) params.set("channel", af.channel);
    if (af.villaId) params.set("villaId", af.villaId);
    if (af.partnerId) params.set("partnerId", af.partnerId);
    if (af.currency) params.set("currency", af.currency);
    if (af.includeAllStatuses) params.set("all", "1");
    return `/api/revenue/export?${params.toString()}`;
  }, [props.activeFilters, searchParams]);

  const selectClass =
    "bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 px-2.5 py-1.5 " +
    "focus:ring-1 focus:ring-admin-primary focus:border-admin-primary";

  const typeLabel = (type: string) => t(`types.${type}`);

  const SortHeader = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`flex items-center gap-1 ${align === "right" ? "ml-auto" : ""} hover:text-white transition-colors`}
    >
      {label}
      {sortKey === k && (
        <span className="material-symbols-outlined text-sm">
          {sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
        </span>
      )}
    </button>
  );

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-lg font-bold text-white">{t("title")}</h1>
        <span className="text-slate-600">/</span>
        <span className="text-sm text-admin-muted">{t("subtitle")}</span>
      </div>

      {/* 필터 바 */}
      {/* 코치마크 앵커 */}
      <div data-tour="revenue-filters" className="mt-4 flex flex-col gap-3">
        {/* 기간 필터 (통계와 동일 컴포넌트) */}
        <DateRangeFilter
          presetKey={props.period.presetKey}
          fromText={props.period.fromText}
          toText={props.period.toText}
        />

        <div className="flex items-center gap-2 flex-wrap">
          {/* 유형 멀티 토글 */}
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
            {TYPE_KEYS.map((k) => {
              const active = props.activeFilters.types.length === 0 || props.activeFilters.types.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleType(k)}
                  className={
                    active
                      ? "flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded bg-admin-primary text-white"
                      : "flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-white"
                  }
                >
                  <span className="material-symbols-outlined text-sm">{TYPE_ICON[k]}</span>
                  {typeLabel(k)}
                </button>
              );
            })}
          </div>

          {/* 채널 */}
          <select
            aria-label={t("filters.channel")}
            value={props.activeFilters.channel ?? ""}
            onChange={(e) => setParam("channel", e.target.value || null)}
            className={selectClass}
          >
            <option value="">{t("filters.allChannels")}</option>
            {CHANNEL_KEYS.map((c) => (
              <option key={c} value={c}>
                {t(`channels.${c}`)}
              </option>
            ))}
          </select>

          {/* 빌라 */}
          <select
            aria-label={t("filters.villa")}
            value={props.activeFilters.villaId ?? ""}
            onChange={(e) => setParam("villaId", e.target.value || null)}
            className={selectClass}
          >
            <option value="">{t("filters.allVillas")}</option>
            {props.villas.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>

          {/* 파트너 */}
          <select
            aria-label={t("filters.partner")}
            value={props.activeFilters.partnerId ?? ""}
            onChange={(e) => setParam("partnerId", e.target.value || null)}
            className={selectClass}
          >
            <option value="">{t("filters.allPartners")}</option>
            {props.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* 통화 */}
          <select
            aria-label={t("filters.currency")}
            value={props.activeFilters.currency ?? ""}
            onChange={(e) => setParam("currency", e.target.value || null)}
            className={selectClass}
          >
            <option value="">{t("filters.allCurrencies")}</option>
            <option value="KRW">KRW</option>
            <option value="VND">VND</option>
            <option value="USD">USD</option>
          </select>

          {/* 전체 상태 포함 토글 */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={props.activeFilters.includeAllStatuses}
              onChange={(e) => setParam("all", e.target.checked ? "1" : null)}
              className="accent-admin-primary"
            />
            {t("filters.allStatuses")}
          </label>
        </div>

        {/* 검색 + CSV */}
        {/* 코치마크 앵커 */}
        <div data-tour="revenue-export" className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg pointer-events-none">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 pl-9 pr-3 py-2 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary"
            />
          </div>
          <a
            href={exportHref}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-admin-card text-white hover:bg-slate-700 transition-colors"
          >
            <span className="material-symbols-outlined text-base">download</span>
            {t("exportCsv")}
          </a>
        </div>
      </div>

      {/* 요약 — 통합 환산 매출(≈VND) + 환산 후 마진 + 건수 (검색 전 서버 필터 기준) */}
      {/* 모바일은 1열(큰 금액 잘림 방지), sm부터 2열·lg 3열 */}
      {/* 코치마크 앵커 */}
      <div data-tour="revenue-summary" className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          label={t("summary.integratedRevenue")}
          value={formatThousands(props.totals.integratedRevenueVnd)}
          unit="₫"
          accent="vnd"
          icon="account_balance_wallet"
          iconClassName="text-admin-vnd"
          footer={
            <p className="text-[10px] text-slate-500">
              {t("summary.fxApprox")}
              {props.totals.fxMissingCount > 0 &&
                ` · ${t("summary.fxMissing", { count: props.totals.fxMissingCount })}`}
            </p>
          }
        />
        <KpiCard
          label={t("summary.marginVnd")}
          value={formatThousands(props.totals.marginVnd)}
          unit="₫"
          icon="savings"
          iconClassName="text-amber-400"
          footer={<p className="text-[10px] text-slate-500">{t("summary.marginNote")}</p>}
        />
        <KpiCard
          label={t("summary.count")}
          value={formatThousands(props.totals.count)}
          unit={t("summary.countUnit")}
          icon="receipt_long"
          iconClassName="text-indigo-400"
        />
      </div>

      {/* 원본 통화별 매출 병기 — 환전 전 실제 수령 통화(KRW·VND·USD) */}
      <div className="mt-3">
        <p className="mb-1.5 text-[11px] font-medium text-slate-500">{t("summary.byCurrency")}</p>
        {/* 모바일은 1열(VND 10자리+ 잘림 방지), sm부터 3열 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            label={t("summary.saleKrw")}
            value={props.totals.saleKrw > 0 ? formatThousands(props.totals.saleKrw) : "—"}
            unit={props.totals.saleKrw > 0 ? "원" : undefined}
            accent="krw"
            icon="payments"
            iconClassName="text-admin-krw"
          />
          <KpiCard
            label={t("summary.saleVnd")}
            value={formatThousands(props.totals.saleVnd)}
            unit="₫"
            accent="vnd"
            icon="payments"
            iconClassName="text-admin-vnd"
          />
          <KpiCard
            label={t("summary.saleUsd")}
            value={props.totals.saleUsd > 0 ? formatThousands(props.totals.saleUsd) : "—"}
            unit={props.totals.saleUsd > 0 ? "$" : undefined}
            icon="payments"
            iconClassName="text-emerald-400"
            footer={
              props.totals.saleUsd > 0 ? undefined : (
                <p className="text-[10px] text-slate-500">{t("summary.usdSoon")}</p>
              )
            }
          />
        </div>
      </div>

      {/* 유형별 VND 매출 구성 바 */}
      {typeBreakdown.total > 0n && (
        <div className="mt-3 bg-admin-card rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-white">{t("summary.breakdownTitle")}</h3>
            <span className="text-[10px] text-slate-500">{t("summary.breakdownNote")}</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
            {TYPE_KEYS.map((k) => {
              const v = typeBreakdown.byType[k];
              if (v <= 0n) return null;
              const pct = Number((v * 10000n) / typeBreakdown.total) / 100;
              return (
                <div
                  key={k}
                  className={TYPE_BAR_COLOR[k]}
                  style={{ width: `${pct}%` }}
                  title={`${typeLabel(k)} ${formatThousands(v)}₫`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {TYPE_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-1.5 text-xs">
                <span className={`w-2.5 h-2.5 rounded-sm ${TYPE_BAR_COLOR[k]}`} />
                <span className="text-slate-300">{typeLabel(k)}</span>
                <span className="text-slate-400 tabular-nums">
                  {formatThousands(typeBreakdown.byType[k])}₫
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 거래 테이블 — 데스크톱(≥md). 행 클릭 시 해당 예약 상세로 이동 */}
      <div className="mt-4 hidden md:block overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900/60 text-admin-muted text-xs">
              <th className="px-3 py-2.5 text-left font-medium">
                <SortHeader k="date" label={t("cols.date")} align="left" />
              </th>
              <th className="px-3 py-2.5 text-left font-medium">{t("cols.type")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("cols.villa")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("cols.channelPartner")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("cols.label")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("cols.saleKrw")}</th>
              <th className="px-3 py-2.5 text-right font-medium">
                <SortHeader k="saleVnd" label={t("cols.saleVnd")} />
              </th>
              <th className="px-3 py-2.5 text-right font-medium">{t("cols.costVnd")}</th>
              <th className="px-3 py-2.5 text-right font-medium">
                <SortHeader k="marginVnd" label={t("cols.marginVnd")} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-admin-muted">
                  {t("empty")}
                </td>
              </tr>
            )}
            {paged.map((x) => (
              <tr
                key={x.id}
                onClick={() => router.push(`/bookings/${x.bookingId}`)}
                className="cursor-pointer hover:bg-slate-900/40 text-slate-200"
              >
                <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-400">{x.date}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                    <span className="material-symbols-outlined text-sm text-admin-muted">{TYPE_ICON[x.type]}</span>
                    {typeLabel(x.type)}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{x.villaName}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-400">
                  {x.channel ? t(`channels.${x.channel}`) : "—"}
                  {x.partnerName && <span className="text-slate-500"> · {x.partnerName}</span>}
                </td>
                <td className="px-3 py-2.5">{x.label}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {x.saleKrw !== null ? `₩${formatThousands(x.saleKrw)}` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {x.saleVnd !== null ? `${formatThousands(x.saleVnd)}₫` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-slate-400">
                  {x.costVnd !== null ? `${formatThousands(x.costVnd)}₫` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {x.marginVnd !== null ? (
                    <span className={BigInt(x.marginVnd) < 0n ? "text-red-400" : "text-emerald-400"}>
                      {formatThousands(x.marginVnd)}₫
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {/* 합계 푸터 — 검색 적용된 현재 표시 행 기준. 원본 통화 분리(KRW·VND) + 통합 환산(≈₫) 별도 행. */}
          <tfoot>
            <tr className="bg-slate-900/80 font-bold text-white border-t-2 border-slate-700">
              <td className="px-3 py-3" colSpan={5}>
                {t("totals.label", { count: visibleTotals.count })}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {visibleTotals.saleKrw > 0 ? `₩${formatThousands(visibleTotals.saleKrw)}` : "—"}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{`${formatThousands(visibleTotals.saleVnd)}₫`}</td>
              <td className="px-3 py-3" />
              <td className="px-3 py-3 text-right tabular-nums text-emerald-400">
                {visibleTotals.marginVnd !== null ? `${formatThousands(visibleTotals.marginVnd)}₫` : "—"}
              </td>
            </tr>
            <tr className="bg-slate-900/60 text-admin-vnd border-t border-slate-800">
              <td className="px-3 py-2.5 text-xs text-slate-400" colSpan={5}>
                {t("totals.integratedLabel")}
                {visibleTotals.fxMissingCount > 0 && (
                  <span className="text-slate-500">
                    {" · "}
                    {t("summary.fxMissing", { count: visibleTotals.fxMissingCount })}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-bold" colSpan={4}>
                {`≈ ${formatThousands(visibleTotals.integratedRevenueVnd)}₫`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 거래 카드 — 모바일(<md). 가로 스크롤 없이 카드, 탭하면 예약 상세로 이동 */}
      <div className="mt-4 space-y-2 md:hidden">
        {rows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-admin-card px-3 py-10 text-center text-admin-muted">
            {t("empty")}
          </div>
        )}
        {paged.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => router.push(`/bookings/${x.bookingId}`)}
            className="block w-full rounded-xl border border-slate-800 bg-admin-card p-3 text-left transition-colors active:bg-slate-900/60"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                <span className="material-symbols-outlined text-sm text-admin-muted">
                  {TYPE_ICON[x.type]}
                </span>
                {typeLabel(x.type)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">{x.date}</span>
            </div>
            <p className="mt-1 truncate font-bold text-white">{x.villaName}</p>
            <p className="truncate text-xs text-slate-400">
              {x.channel ? t(`channels.${x.channel}`) : "—"}
              {x.partnerName && ` · ${x.partnerName}`}
              {x.label && ` · ${x.label}`}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-sm tabular-nums">
              <span className="text-slate-200">
                {x.saleKrw !== null
                  ? `₩${formatThousands(x.saleKrw)}`
                  : x.saleVnd !== null
                    ? `${formatThousands(x.saleVnd)}₫`
                    : "—"}
              </span>
              {x.marginVnd !== null && (
                <span className={BigInt(x.marginVnd) < 0n ? "text-red-400" : "text-emerald-400"}>
                  {formatThousands(x.marginVnd)}₫
                </span>
              )}
            </div>
          </button>
        ))}
        {/* 모바일 합계 카드 — 표 tfoot 대체(전체 표시행 기준) */}
        {rows.length > 0 && (
          <div className="rounded-xl border-2 border-slate-700 bg-slate-900/80 p-3 text-sm">
            <p className="font-bold text-white">{t("totals.label", { count: visibleTotals.count })}</p>
            <div className="mt-1 flex items-center justify-between gap-2 tabular-nums">
              <span className="text-slate-200">
                {visibleTotals.saleKrw > 0 ? `₩${formatThousands(visibleTotals.saleKrw)} · ` : ""}
                {`${formatThousands(visibleTotals.saleVnd)}₫`}
              </span>
              <span className="text-emerald-400">
                {visibleTotals.marginVnd !== null ? `${formatThousands(visibleTotals.marginVnd)}₫` : "—"}
              </span>
            </div>
            <p className="mt-1 text-xs text-admin-vnd">
              {t("totals.integratedLabel")}: ≈ {formatThousands(visibleTotals.integratedRevenueVnd)}₫
            </p>
          </div>
        )}
      </div>

      {/* 페이지네이션 — 전체 검색결과(rows) 기준 페이지 분할 */}
      <PaginationBar
        total={rows.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />

      <p className="mt-3 text-xs text-admin-muted">{t("note")}</p>
    </div>
  );
}
