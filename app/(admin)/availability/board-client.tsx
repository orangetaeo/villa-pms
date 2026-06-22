"use client";

// 빌라별 공실 보드 격자 (b11-availability-board 변환, 운영자 다크 ko)
// 빌라(행)×날짜(열) 채널매니저 타임라인. 빌라명 열 sticky + 날짜 가로 스크롤, 월/일 2단 헤더.
// 셀 3상태(AVAILABLE/MANUAL/ICAL) 색+패턴+아이콘 (색약 대응). 셀 탭 → 잠금/해제 팝오버.
// 잠금/해제: 기존 /api/calendar-blocks (ADMIN 허용으로 보강됨). 낙관적 업데이트 + router.refresh().
// i18n: (admin)/layout.tsx 화이트리스트 수정 금지 → 모든 문구를 서버에서 props(strings)로 받음.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardCell } from "@/lib/availability";

export interface BoardColumn {
  iso: string; // YYYY-MM-DD
  day: number;
  dow: number; // 0=일 … 6=토
  isWeekend: boolean;
  isToday: boolean;
  isMonthStart?: boolean;
}

export interface BoardMonthGroup {
  ym: string; // YYYY-MM
  label: string;
  span: number; // colspan
  startIndex: number; // columns 내 시작 인덱스
}

export interface BoardRow {
  id: string;
  name: string;
  complex: string | null;
  checkedLabel: string | null; // "M/D" or null
  needCheck: boolean;
  days: BoardCell[];
}

export interface BoardStrings {
  villaCount: string;
  search: string;
  area: string;
  allAreas: string;
  needCheckOnly: string;
  today: string;
  prevPeriod: string;
  nextPeriod: string;
  legendAvailable: string;
  legendManual: string;
  legendIcal: string;
  legendChecked: string;
  legendNeedCheck: string;
  badgeChecked: string; // contains {date}
  badgeNeedCheck: string; // contains {date}
  badgeNever: string;
  confirmCheck: string;
  empty: string;
  cellAvailable: string;
  cellManual: string;
  cellIcal: string;
  weekdays: string[]; // [일,월,…,토]
  popStateLabel: string;
  popStateAvailable: string;
  popStateManual: string;
  popLock: string;
  popUnlock: string;
  popProcessing: string;
  popHint: string;
  popConflict: string;
  popError: string;
  popClose: string;
  icalTitle: string;
  icalDesc: string;
  icalInfo: string;
}

interface Props {
  columns: BoardColumn[];
  monthGroups: BoardMonthGroup[];
  rows: BoardRow[];
  areaOptions: string[];
  startMonth: string;
  prevMonth: string;
  nextMonth: string;
  thisMonth: string;
  periodLabel: string;
  area: string;
  search: string;
  needCheckOnly: boolean;
  strings: BoardStrings;
}

// b11 NOTES 셀 토큰 (globals.css 수정 금지 → 컴포넌트 스코프 <style> 주입)
const BOARD_CSS = `
.nowrap-cell { white-space: nowrap; }
.ab-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.ab-scroll::-webkit-scrollbar-track { background: #0F172A; }
.ab-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 5px; }
.ab-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
.ab-cell-available { background-color: transparent; }
.ab-cell-available:hover { background-color: rgba(59,130,246,0.10); }
.ab-cell-manual {
  background-color: #475569;
  background-image: repeating-linear-gradient(45deg, rgba(15,23,42,0.55) 0, rgba(15,23,42,0.55) 2px, transparent 2px, transparent 7px);
}
.ab-cell-manual:hover { background-color: #64748B; }
.ab-cell-ical {
  background-color: rgba(245,158,11,0.22);
  background-image: repeating-linear-gradient(-45deg, rgba(245,158,11,0.55) 0, rgba(245,158,11,0.55) 2px, transparent 2px, transparent 7px);
  cursor: not-allowed;
}
.ab-col-today { box-shadow: inset 1px 0 0 #3B82F6, inset -1px 0 0 #3B82F6; }
.ab-col-weekend { background-color: rgba(2,6,23,0.35); }
.ab-month-edge { box-shadow: inset 2px 0 0 #334155; }
.ab-sticky-col { position: sticky; left: 0; z-index: 20; background-color: #1E293B; }
.ab-grid-cell { width: 36px; min-width: 36px; height: 44px; border-right: 1px solid rgba(30,41,59,0.6); border-bottom: 1px solid rgba(30,41,59,0.6); cursor: pointer; transition: background-color .12s; padding: 0; }
`;

const ROW_H = 34; // 월 헤더 행 높이 (일 행 sticky top 계산용)

type PopState =
  | { kind: "block"; villaId: string; villaName: string; col: BoardColumn; status: "AVAILABLE" | "MANUAL"; blockId: string | null; x: number; y: number }
  | { kind: "ical"; col: BoardColumn; x: number; y: number };

/** YYYY-MM-DD → "YYYY.MM.DD (요일)" */
function fmtDateDow(iso: string, weekdays: string[]): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${weekdays[dow]})`;
}

export default function AvailabilityBoardClient({
  columns,
  monthGroups,
  rows,
  areaOptions,
  startMonth,
  prevMonth,
  nextMonth,
  thisMonth,
  periodLabel,
  area,
  search,
  needCheckOnly,
  strings: s,
}: Props) {
  const router = useRouter();

  // 낙관적 셀 상태 오버레이: "villaId|iso" → BoardCell. 서버 refresh 시 비움.
  const [optimistic, setOptimistic] = useState<Record<string, BoardCell>>({});
  // 낙관적 확인일 오버레이: villaId → "M/D"
  const [checkedOverlay, setCheckedOverlay] = useState<Record<string, string>>({});
  const [pop, setPop] = useState<PopState | null>(null);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<"conflict" | "error" | null>(null);

  // 화면 밖 클릭 → 팝오버 닫기
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pop) return;
    function onDoc(e: MouseEvent) {
      if (pending) return; // 처리 중에는 외부 클릭으로 닫지 않음
      const target = e.target as HTMLElement;
      if (popRef.current?.contains(target)) return;
      if (target.closest("[data-ab-cell]")) return;
      setPop(null);
      setErrorKey(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pop, pending]);

  function closePop() {
    if (pending) return;
    setPop(null);
    setErrorKey(null);
  }

  // 필터/기간 → searchParams 갱신
  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams();
    const cur: Record<string, string> = {
      startMonth,
      area,
      search,
      needCheck: needCheckOnly ? "1" : "",
    };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) {
      if (v) next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `/availability?${qs}` : "/availability");
  }

  function cellOf(villaId: string, idx: number): BoardCell {
    const iso = columns[idx].iso;
    return optimistic[`${villaId}|${iso}`] ?? rows.find((r) => r.id === villaId)!.days[idx];
  }

  function onCellTap(e: React.MouseEvent, row: BoardRow, col: BoardColumn, cell: BoardCell) {
    setErrorKey(null);
    const x = Math.min(e.clientX, window.innerWidth - 280);
    const y = Math.min(e.clientY + 8, window.innerHeight - 220);
    if (cell.status === "ICAL") {
      setPop({ kind: "ical", col, x, y });
      return;
    }
    setPop({
      kind: "block",
      villaId: row.id,
      villaName: row.name,
      col,
      status: cell.status,
      blockId: cell.blockId,
      x,
      y,
    });
  }

  // 잠금/해제 실행 — 낙관적 업데이트 후 API, 실패 시 롤백
  async function submit(action: "lock" | "unlock") {
    if (!pop || pop.kind !== "block" || pending) return;
    const key = `${pop.villaId}|${pop.col.iso}`;
    const prev = optimistic[key];
    setPending(true);
    setErrorKey(null);
    // 낙관적 반영
    setOptimistic((o) => ({
      ...o,
      [key]: action === "lock" ? { status: "MANUAL", blockId: null } : { status: "AVAILABLE", blockId: null },
    }));
    try {
      const res =
        action === "lock"
          ? await fetch("/api/calendar-blocks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ villaId: pop.villaId, date: pop.col.iso }),
            })
          : await fetch(`/api/calendar-blocks/${pop.blockId}`, { method: "DELETE" });
      if (res.ok) {
        setPop(null);
        router.refresh(); // 서버 재조회 → 정확한 blockId 동기화 후 오버레이 폐기
        // refresh 후에도 오버레이가 잠깐 남아 깜빡임 방지: 성공 셀은 유지(서버 값과 동일)
      } else {
        // 롤백
        setOptimistic((o) => {
          const n = { ...o };
          if (prev === undefined) delete n[key];
          else n[key] = prev;
          return n;
        });
        setErrorKey(res.status === 409 ? "conflict" : "error");
      }
    } catch {
      setOptimistic((o) => {
        const n = { ...o };
        if (prev === undefined) delete n[key];
        else n[key] = prev;
        return n;
      });
      setErrorKey("error");
    } finally {
      setPending(false);
    }
  }

  // "확인했음" — POST 후 응답으로 뱃지 즉시 갱신
  const [checkingId, setCheckingId] = useState<string | null>(null);
  async function confirmChecked(villaId: string) {
    if (checkingId) return;
    setCheckingId(villaId);
    try {
      const res = await fetch(`/api/villas/${villaId}/availability-checked`, { method: "POST" });
      if (res.ok) {
        const data: { availabilityCheckedAt?: string } = await res.json();
        if (data.availabilityCheckedAt) {
          const [, m, d] = data.availabilityCheckedAt.slice(0, 10).split("-");
          setCheckedOverlay((c) => ({ ...c, [villaId]: `${Number(m)}/${Number(d)}` }));
        }
        router.refresh();
      }
    } catch {
      /* 무시 — 다음 새로고침 시 정확 반영 */
    } finally {
      setCheckingId(null);
    }
  }

  const popDateBlock = pop?.kind === "block" ? fmtDateDow(pop.col.iso, s.weekdays) : "";
  const popDateIcal = pop?.kind === "ical" ? fmtDateDow(pop.col.iso, s.weekdays) : "";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BOARD_CSS }} />

      {/* ===== 필터 / 기간 바 ===== */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800/50 bg-admin-card p-3 shadow-sm">
        {/* 검색 */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
            search
          </span>
          <input
            className="w-56 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-4 text-sm text-slate-300 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary"
            placeholder={s.search}
            type="text"
            defaultValue={search}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate({ search: e.currentTarget.value.trim() });
            }}
          />
        </div>
        {/* 지역 */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 whitespace-nowrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {s.area}
          </span>
          <select
            aria-label={s.area}
            className="cursor-pointer border-none bg-transparent p-0 pr-6 text-sm text-slate-300 focus:ring-0"
            value={area}
            onChange={(e) => navigate({ area: e.target.value })}
          >
            <option value="" className="bg-slate-900">
              {s.allAreas}
            </option>
            {areaOptions.map((opt) => (
              <option key={opt} value={opt} className="bg-slate-900">
                {opt}
              </option>
            ))}
          </select>
        </div>
        {/* 확인 필요만 */}
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 whitespace-nowrap">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-admin-primary focus:ring-admin-primary"
            checked={needCheckOnly}
            onChange={(e) => navigate({ needCheck: e.target.checked ? "1" : null })}
          />
          <span className="text-sm font-medium text-slate-300">{s.needCheckOnly}</span>
        </label>

        <div className="flex-1" />

        {/* 기간 네비 */}
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 whitespace-nowrap"
          onClick={() => navigate({ startMonth: thisMonth })}
        >
          {s.today}
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-1 py-1 whitespace-nowrap">
          <button
            type="button"
            aria-label={s.prevPeriod}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => navigate({ startMonth: prevMonth })}
          >
            <span className="material-symbols-outlined text-sm">chevron_left</span>
          </button>
          <span className="px-2 text-sm font-bold tabular-nums text-white">{periodLabel}</span>
          <button
            type="button"
            aria-label={s.nextPeriod}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => navigate({ startMonth: nextMonth })}
          >
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </button>
        </div>
      </div>

      {/* ===== 범례 ===== */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-available inline-block h-5 w-5 rounded border border-slate-600" />
          <span className="text-sm font-medium text-slate-300">{s.legendAvailable}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-manual inline-block h-5 w-5 rounded border border-slate-600" />
          <span className="text-sm font-medium text-slate-300">{s.legendManual}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-ical relative inline-block h-5 w-5 rounded border border-amber-500/40">
            <span
              className="material-symbols-outlined absolute inset-0 flex items-center justify-center text-amber-400"
              style={{ fontSize: 12 }}
            >
              sync
            </span>
          </span>
          <span className="text-sm font-medium text-slate-300">{s.legendIcal}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
          <span className="material-symbols-outlined text-[18px] text-green-500">check_circle</span>
          <span className="text-sm font-medium text-slate-300">{s.legendChecked}</span>
          <span className="material-symbols-outlined ml-3 text-[18px] text-amber-400">warning</span>
          <span className="text-sm font-medium text-slate-300">{s.legendNeedCheck}</span>
        </div>
      </div>

      {/* ===== 타임라인 격자 ===== */}
      <div className="ab-scroll relative overflow-auto rounded-xl border border-slate-800/50 bg-admin-card shadow-lg">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            {s.empty}
          </div>
        ) : (
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead>
              {/* 월 라벨 행 */}
              <tr>
                <th
                  className="ab-sticky-col px-4 py-2 text-left align-bottom"
                  style={{
                    zIndex: 30,
                    top: 0,
                    minWidth: 240,
                    width: 240,
                    background: "#0F172A",
                    borderBottom: "1px solid #1E293B",
                    borderRight: "1px solid #1E293B",
                  }}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {s.villaCount}
                  </span>
                </th>
                {monthGroups.map((g) => (
                  <th
                    key={g.ym}
                    colSpan={g.span}
                    className="ab-month-edge sticky top-0 whitespace-nowrap px-3 py-2 text-left text-sm font-black text-white"
                    style={{
                      background: "#0F172A",
                      borderBottom: "1px solid #1E293B",
                      zIndex: 25,
                    }}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* 일/요일 행 */}
              <tr>
                <th
                  className="ab-sticky-col px-4 py-2 text-left"
                  style={{
                    zIndex: 30,
                    top: ROW_H,
                    minWidth: 240,
                    width: 240,
                    background: "#1E293B",
                    borderBottom: "1px solid #1E293B",
                    borderRight: "1px solid #1E293B",
                  }}
                />
                {columns.map((c) => (
                  <th
                    key={c.iso}
                    className={
                      "sticky px-0 py-1 text-center align-middle nowrap-cell" +
                      (c.isMonthStart ? " ab-month-edge" : "") +
                      (c.isToday ? " ab-col-today" : "") +
                      (c.isWeekend ? " ab-col-weekend" : "")
                    }
                    style={{
                      top: ROW_H,
                      minWidth: 36,
                      width: 36,
                      background: "#1E293B",
                      borderBottom: "1px solid #1E293B",
                      zIndex: 24,
                    }}
                  >
                    <div
                      className={
                        "text-[10px] font-bold leading-none tabular-nums " +
                        (c.isToday
                          ? "text-[#3B82F6]"
                          : c.isWeekend
                            ? "text-rose-400"
                            : "text-slate-400")
                      }
                    >
                      {c.day}
                    </div>
                    <div
                      className={
                        "mt-0.5 text-[9px] leading-none " +
                        (c.isToday ? "text-[#3B82F6]" : "text-slate-600")
                      }
                    >
                      {s.weekdays[c.dow]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const checkedLabel = checkedOverlay[row.id] ?? row.checkedLabel;
                const needCheck = checkedOverlay[row.id] ? false : row.needCheck;
                return (
                  <tr key={row.id} className="group">
                    {/* sticky 빌라명 + 확인 뱃지 + 확인했음 */}
                    <td
                      className="ab-sticky-col px-4 py-1.5 align-middle"
                      style={{
                        minWidth: 240,
                        width: 240,
                        borderRight: "1px solid #1E293B",
                        borderBottom: "1px solid rgba(30,41,59,0.6)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-100 nowrap-cell">
                            {row.name}
                          </p>
                          {row.complex && (
                            <p className="truncate text-[10px] text-slate-500 nowrap-cell">
                              {row.complex}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {needCheck ? (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                                warning
                              </span>
                              {checkedLabel
                                ? s.badgeNeedCheck.replace("{date}", checkedLabel)
                                : s.badgeNever}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-400">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                                check_circle
                              </span>
                              {s.badgeChecked.replace("{date}", checkedLabel ?? "")}
                            </span>
                          )}
                          <button
                            type="button"
                            title={s.confirmCheck}
                            aria-label={s.confirmCheck}
                            disabled={checkingId === row.id}
                            onClick={() => confirmChecked(row.id)}
                            className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                              {checkingId === row.id ? "hourglass_empty" : "task_alt"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </td>
                    {/* 날짜 셀 */}
                    {columns.map((c, idx) => {
                      const cell = cellOf(row.id, idx);
                      let cls = "ab-grid-cell relative";
                      if (c.isMonthStart) cls += " ab-month-edge";
                      if (c.isToday) cls += " ab-col-today";
                      if (cell.status === "AVAILABLE") {
                        cls += " ab-cell-available" + (c.isWeekend ? " ab-col-weekend" : "");
                      } else if (cell.status === "MANUAL") {
                        cls += " ab-cell-manual";
                      } else {
                        cls += " ab-cell-ical";
                      }
                      const title =
                        cell.status === "AVAILABLE"
                          ? s.cellAvailable
                          : cell.status === "MANUAL"
                            ? s.cellManual
                            : s.cellIcal;
                      return (
                        <td
                          key={c.iso}
                          data-ab-cell
                          className={cls}
                          title={title}
                          onClick={(e) => onCellTap(e, row, c, cell)}
                        >
                          {cell.status === "ICAL" && (
                            <span
                              className="material-symbols-outlined pointer-events-none absolute inset-0 flex items-center justify-center text-amber-300/90"
                              style={{ fontSize: 13 }}
                            >
                              sync
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== 잠금/해제 팝오버 ===== */}
      {pop?.kind === "block" && (
        <div
          ref={popRef}
          className="fixed z-[60] w-64 rounded-xl border border-slate-700 bg-admin-card p-4 shadow-2xl"
          style={{ left: pop.x, top: pop.y }}
        >
          <div className="mb-1 flex items-center justify-between">
            <p className="truncate text-xs font-medium text-slate-400">{pop.villaName}</p>
            <button
              type="button"
              onClick={closePop}
              className="text-slate-500 hover:text-white"
              aria-label={s.popClose}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
          <p className="mb-1 text-base font-black tabular-nums text-white">{popDateBlock}</p>
          <p className="mb-3 text-xs text-slate-400">
            {s.popStateLabel}:{" "}
            <span className="font-bold text-slate-200">
              {pop.status === "MANUAL" ? s.popStateManual : s.popStateAvailable}
            </span>
          </p>
          {errorKey && (
            <p className="mb-3 rounded-lg bg-red-500/10 p-2.5 text-xs font-medium text-red-400">
              {errorKey === "conflict" ? s.popConflict : s.popError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || pop.status === "MANUAL"}
              onClick={() => submit("lock")}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-600 py-2.5 text-sm font-bold text-white transition hover:bg-slate-500 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">lock</span>
              {pending && pop.status === "AVAILABLE" ? s.popProcessing : s.popLock}
            </button>
            <button
              type="button"
              disabled={pending || pop.status === "AVAILABLE" || !pop.blockId}
              onClick={() => submit("unlock")}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">lock_open</span>
              {pending && pop.status === "MANUAL" ? s.popProcessing : s.popUnlock}
            </button>
          </div>
          <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">{s.popHint}</p>
        </div>
      )}

      {/* ===== iCal 읽기전용 팝오버 ===== */}
      {pop?.kind === "ical" && (
        <div
          ref={popRef}
          className="fixed z-[60] w-64 rounded-xl border border-amber-500/40 bg-admin-card p-4 shadow-2xl"
          style={{ left: pop.x, top: pop.y }}
        >
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-amber-400">
              <span className="material-symbols-outlined text-sm">sync</span>
              {s.icalTitle}
            </p>
            <button
              type="button"
              onClick={closePop}
              className="text-slate-500 hover:text-white"
              aria-label={s.popClose}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
          <p className="mb-2 text-base font-black tabular-nums text-white">{popDateIcal}</p>
          <p className="mb-3 text-xs text-slate-400">{s.icalDesc}</p>
          <div className="flex items-start gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            <span className="material-symbols-outlined shrink-0 text-sm text-slate-500">info</span>
            {s.icalInfo}
          </div>
        </div>
      )}
    </>
  );
}
