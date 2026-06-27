"use client";

// 빌라 성과 — 상위 10 막대(정렬 토글) + 랭킹 테이블(정렬 가능, <768 카드) (T-admin-statistics §5 탭3)
// ★ 누수 차단: 금액 컬럼(KRW매출·VND매출·환산마진)은 row에 해당 키가 있을 때만 렌더.
//   page.tsx가 includeFinance=false면 row에 금액 키 자체가 없음(undefined) → 컬럼·정렬옵션·바 토글 모두 생략.
//   (조건부 렌더가 아니라 데이터 부재로 처리 — STAFF 페이로드에 금액 문자열 없음.)

import { useEffect, useMemo, useState } from "react";
import type { VillaPerformanceRow } from "@/lib/statistics";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface VillaRankLabels {
  gateNote: string;
  topTitle: string;
  byRate: string;
  byBookings: string;
  byRevenue: string;
  tableTitle: string;
  hint: string;
  name: string;
  complex: string;
  bookings: string;
  nights: string;
  rate: string;
  krwRevenue: string;
  vndRevenue: string;
  margin: string;
  marginRef: string;
  noComplex: string;
  noData: string;
}

type SortKey = "rate" | "bookings" | "nights" | "krwRevenue" | "vndRevenue" | "marginVnd";

export default function VillaRankTable({
  rows,
  hasFinance,
  labels,
}: {
  rows: VillaPerformanceRow[];
  /** 금액 컬럼 노출 여부 — 서버에서 row에 금액 키가 담겼을 때만 true (누수 가드 보조) */
  hasFinance: boolean;
  labels: VillaRankLabels;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rate");
  const [asc, setAsc] = useState(false);
  // 상위 막대 정렬 기준 (금액 없으면 매출 토글 미노출)
  const [barSort, setBarSort] = useState<"rate" | "bookings" | "revenue">("rate");

  const sorted = useMemo(() => {
    const val = (r: VillaPerformanceRow, k: SortKey): number => {
      switch (k) {
        case "rate":
          return r.ratePct;
        case "bookings":
          return r.bookingCount;
        case "nights":
          return r.occupiedNights;
        case "krwRevenue":
          return r.krwRevenue ?? 0;
        case "vndRevenue":
          return r.vndRevenue ?? 0;
        case "marginVnd":
          return r.marginVnd ?? 0;
      }
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const d = val(a, sortKey) - val(b, sortKey);
      return asc ? d : -d;
    });
    return copy;
  }, [rows, sortKey, asc]);

  // 랭킹 테이블 페이지네이션 — 빌라 수가 많아도 한 페이지만 렌더. 정렬·기간 변경 시 1페이지로.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [sortKey, asc, rows]);
  const paged = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  const top10 = useMemo(() => {
    const key: SortKey = barSort === "revenue" ? "vndRevenue" : barSort;
    const copy = [...rows];
    copy.sort((a, b) => {
      const v = (r: VillaPerformanceRow) =>
        key === "rate" ? r.ratePct : key === "bookings" ? r.bookingCount : (r.vndRevenue ?? 0);
      return v(b) - v(a);
    });
    return copy.slice(0, 10);
  }, [rows, barSort]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(false);
    }
  };

  // 상위 막대 — 막대 폭은 현재 기준의 최대값 대비 비율
  const barMax = useMemo(() => {
    const v = (r: VillaPerformanceRow) =>
      barSort === "rate" ? r.ratePct : barSort === "bookings" ? r.bookingCount : (r.vndRevenue ?? 0);
    return Math.max(1, ...top10.map(v));
  }, [top10, barSort]);

  const barValue = (r: VillaPerformanceRow) =>
    barSort === "rate" ? r.ratePct : barSort === "bookings" ? r.bookingCount : (r.vndRevenue ?? 0);
  const barLabel = (r: VillaPerformanceRow) =>
    barSort === "rate"
      ? `${r.ratePct}%`
      : barSort === "bookings"
        ? `${r.bookingCount}`
        : (r.vndRevenueText ?? "-");

  const SortHeader = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th
      className={`p-3 cursor-pointer hover:text-slate-300 ${align === "right" ? "text-right" : "text-left"} ${sortKey === k ? "text-white" : ""}`}
      onClick={() => onSort(k)}
    >
      {label}
      {sortKey === k && (
        <span className="material-symbols-outlined text-[14px] align-middle">
          {asc ? "arrow_upward" : "arrow_downward"}
        </span>
      )}
    </th>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {hasFinance && (
          <div className="flex items-center gap-2 text-[11px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
            <span className="material-symbols-outlined text-sm">lock</span>
            {labels.gateNote}
          </div>
        )}
        <div className="bg-admin-card rounded-xl border border-slate-800 p-10 text-center text-sm text-admin-muted">
          {labels.noData}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 금액 게이트 안내 — 금액 컬럼이 있을 때만 */}
      {hasFinance && (
        <div className="flex items-center gap-2 text-[11px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-sm">lock</span>
          {labels.gateNote}
        </div>
      )}

      {/* 상위 10 막대 (정렬 토글) */}
      <div className="bg-admin-card rounded-xl border border-slate-700/50 p-5">
        <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
          <h3 className="font-bold text-white">{labels.topTitle}</h3>
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setBarSort("rate")}
              className={
                barSort === "rate"
                  ? "px-2.5 py-1 rounded bg-admin-primary text-white font-bold"
                  : "px-2.5 py-1 rounded text-slate-400 hover:text-white font-medium"
              }
            >
              {labels.byRate}
            </button>
            <button
              type="button"
              onClick={() => setBarSort("bookings")}
              className={
                barSort === "bookings"
                  ? "px-2.5 py-1 rounded bg-admin-primary text-white font-bold"
                  : "px-2.5 py-1 rounded text-slate-400 hover:text-white font-medium"
              }
            >
              {labels.byBookings}
            </button>
            {hasFinance && (
              <button
                type="button"
                onClick={() => setBarSort("revenue")}
                className={
                  barSort === "revenue"
                    ? "px-2.5 py-1 rounded bg-admin-primary text-white font-bold"
                    : "px-2.5 py-1 rounded text-slate-400 hover:text-white font-medium"
                }
              >
                {labels.byRevenue}
              </button>
            )}
          </div>
        </div>
        <div className="space-y-2.5">
          {top10.map((r) => (
            <div key={r.villaId} className="flex items-center gap-3">
              <span className="w-28 sm:w-36 shrink-0 text-xs text-slate-300 truncate">{r.name}</span>
              <div className="flex-1 h-5 bg-slate-700/30 rounded">
                <div
                  className="h-full rounded bg-gradient-to-r from-admin-primary to-blue-400"
                  style={{ width: `${Math.round((barValue(r) / barMax) * 100)}%` }}
                />
              </div>
              <span className="w-20 text-right text-xs text-slate-400 tabular-nums truncate">
                {barLabel(r)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 랭킹 테이블 (정렬 가능) — 데스크톱 */}
      <div className="bg-admin-card rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="p-4 border-b border-slate-700/50 flex justify-between items-center gap-3 flex-wrap">
          <h3 className="font-bold text-white">{labels.tableTitle}</h3>
          <span className="text-[11px] text-slate-500">{labels.hint}</span>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900/50 text-[11px] text-slate-500 uppercase tracking-wider">
                <th className="p-3 text-left">{labels.name}</th>
                <th className="p-3 text-left">{labels.complex}</th>
                <SortHeader k="bookings" label={labels.bookings} />
                <SortHeader k="nights" label={labels.nights} />
                <SortHeader k="rate" label={labels.rate} />
                {hasFinance && (
                  <>
                    <SortHeader k="krwRevenue" label={labels.krwRevenue} />
                    <SortHeader k="vndRevenue" label={labels.vndRevenue} />
                    <th
                      className={`p-3 text-right cursor-pointer hover:text-slate-300 ${sortKey === "marginVnd" ? "text-white" : ""}`}
                      onClick={() => onSort("marginVnd")}
                    >
                      {labels.margin}{" "}
                      <span className="text-amber-500 normal-case">{labels.marginRef}</span>
                      {sortKey === "marginVnd" && (
                        <span className="material-symbols-outlined text-[14px] align-middle">
                          {asc ? "arrow_upward" : "arrow_downward"}
                        </span>
                      )}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {paged.map((r) => (
                <tr key={r.villaId} className="hover:bg-slate-800/30">
                  <td className="p-3 font-medium text-slate-200">{r.name}</td>
                  <td className="p-3 text-slate-400">{r.complex ?? labels.noComplex}</td>
                  <td className="p-3 text-right tabular-nums text-slate-300">{r.bookingCount}</td>
                  <td className="p-3 text-right tabular-nums text-slate-300">{r.occupiedNights}</td>
                  <td className="p-3 text-right tabular-nums text-white font-bold">{r.ratePct}%</td>
                  {hasFinance && (
                    <>
                      <td className="p-3 text-right tabular-nums text-slate-300">{r.krwRevenueText}</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{r.vndRevenueText}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-400">{r.marginVndText}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 모바일 카드(<768) */}
        <div className="md:hidden flex flex-col gap-3 p-4">
          {paged.map((r) => (
            <div key={r.villaId} className="bg-slate-900/40 rounded-lg border border-slate-800 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-slate-200 truncate">{r.name}</span>
                <span className="text-white font-bold tabular-nums shrink-0">{r.ratePct}%</span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">{r.complex ?? labels.noComplex}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">{labels.bookings}</span>
                <span className="text-right tabular-nums text-slate-300">{r.bookingCount}</span>
                <span className="text-slate-500">{labels.nights}</span>
                <span className="text-right tabular-nums text-slate-300">{r.occupiedNights}</span>
                {hasFinance && (
                  <>
                    <span className="text-slate-500">{labels.krwRevenue}</span>
                    <span className="text-right tabular-nums text-slate-300">{r.krwRevenueText}</span>
                    <span className="text-slate-500">{labels.vndRevenue}</span>
                    <span className="text-right tabular-nums text-slate-300">{r.vndRevenueText}</span>
                    <span className="text-slate-500">{labels.margin}</span>
                    <span className="text-right tabular-nums text-emerald-400">{r.marginVndText}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 페이지네이션 (다크) — 정렬·검색 적용 후 전체 행 기준 */}
        <div className="border-t border-slate-700/50 px-4 py-3">
          <PaginationBar
            total={sorted.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </div>
      </div>
    </div>
  );
}
