"use client";

// 공급자 원가 캘린더 (rate-calendar-ux · A10) — 라이트 · vi · 모바일 390px.
//   화면 = 안심배너 + 월 캘린더(시즌색 + 밤당 Giá gốc + 겹침 밴드) + 프리미엄 요일 + 레이어 목록.
//   도구 2개: [Thêm giai đoạn](teal) · [Chọn ngày](outline). 저장 1개(sticky). → 화면당 버튼 3개 이하.
//   ★ 마진 비공개: 원가·자기판매가만. 승자 판정은 서버(resolveRatePeriod)와 동일 엔진(calendar-lib) 재사용.
//   저장 = cost 라우트 전체교체 PATCH(base+periods, 겹침 허용) + 프리미엄 요일 변경 시 /info PATCH.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addDays,
  axisPrice,
  holidayLabelMap,
  holidayTimeSet,
  iso,
  nightsBetween,
  packWeekBands,
  premiumReason,
  toUtc,
  winnerForDate,
} from "@/components/rate-calendar/calendar-lib";
import type { HolidayDTO, Season } from "@/components/rate-calendar/types";
import SupplierLayerSheet, { type SheetMode } from "./supplier-layer-sheet";
import {
  abbrevTr,
  buildSaveBody,
  emptyLayer,
  fmtFull,
  fromDTO,
  localKey,
  SEASON_COLOR,
  selectRuns,
  toWorkLayers,
  type Run,
  type SupplierLayer,
  type SupplierLayerDTO,
} from "./supplier-calendar-lib";

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;

type Sheet =
  | null
  | { mode: SheetMode; editingKey?: string; runs?: Run[] };

export default function SupplierRateCalendar({
  villaId,
  initialBase,
  initialPeriods,
  initialPremiumDays,
  holidays,
}: {
  villaId: string;
  initialBase: SupplierLayerDTO;
  initialPeriods: SupplierLayerDTO[];
  initialPremiumDays: number[];
  holidays: HolidayDTO[];
}) {
  const t = useTranslations("supplierRatePeriods");
  const router = useRouter();

  const [base, setBase] = useState<SupplierLayer>(() => fromDTO(initialBase));
  const [periods, setPeriods] = useState<SupplierLayer[]>(() => initialPeriods.map(fromDTO));
  const [days, setDays] = useState<Set<number>>(() => new Set(initialPremiumDays));
  const initialDaysKey = [...initialPremiumDays].sort((a, b) => a - b).join(",");

  const [view, setView] = useState(() => {
    const first = initialPeriods.find((p) => p.startDate)?.startDate;
    const d = first ? toUtc(first) : new Date();
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [tool, setTool] = useState<"none" | "select">("none");
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draft, setDraft] = useState<SupplierLayer>(() => emptyLayer("HIGH"));
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const holidaySet = useMemo(() => holidayTimeSet(holidays), [holidays]);
  const holLabels = useMemo(() => holidayLabelMap(holidays), [holidays]);
  const premiumDays = useMemo(() => [...days], [days]);

  // 승자 엔진용 WorkLayer[] (원가 있는 행만) — calendar-lib 재사용(서버 resolveRatePeriod와 동일 판정).
  const { works, baseWork } = useMemo(() => toWorkLayers(base, periods), [base, periods]);

  const layerCount = periods.length;

  function markDirty() {
    setDirty(true);
    setMsg(null);
  }

  /* ───────── 캘린더 셀 탭 ───────── */
  function onCellTap(ds: string, out: boolean) {
    if (out) return;
    if (tool === "select") {
      setSelectedDays((prev) => {
        const next = new Set(prev);
        if (next.has(ds)) next.delete(ds);
        else next.add(ds);
        return next;
      });
    }
  }

  /* ───────── 도구 ───────── */
  function openAdd() {
    setTool("none");
    setSelectedDays(new Set());
    setDraft(emptyLayer("HIGH"));
    setSheetError(null);
    setSheet({ mode: "add" });
  }
  function startSelect() {
    setSheet(null);
    setSelectedDays(new Set());
    setTool("select");
  }
  function cancelSelect() {
    setTool("none");
    setSelectedDays(new Set());
  }
  function proceedSelect() {
    const runs = selectRuns(selectedDays);
    if (!runs.length) return;
    setDraft(emptyLayer("HIGH"));
    setSheetError(null);
    setSheet({ mode: "basket", runs });
    setTool("none");
  }

  /* ───────── 레이어 편집 ───────── */
  function openEditPeriod(key: string) {
    const p = periods.find((x) => x.localKey === key);
    if (!p) return;
    setDraft({ ...p });
    setSheetError(null);
    setSheet({ mode: "edit", editingKey: key });
  }
  function openEditBase() {
    setDraft({ ...base });
    setSheetError(null);
    setSheet({ mode: "edit", editingKey: "__base__" });
  }

  /* ───────── 시트 확정 ───────── */
  function confirmSheet() {
    if (!sheet) return;
    if (!draft.supplierCostVnd) {
      setSheetError(t("cal.errCost"));
      return;
    }
    if (sheet.mode === "add") {
      if (!draft.start || !draft.end || draft.start >= draft.end) {
        setSheetError(t("cal.errDate"));
        return;
      }
      setPeriods((prev) => [...prev, { ...draft, id: "", localKey: localKey() }]);
    } else if (sheet.mode === "basket") {
      const runs = sheet.runs ?? [];
      if (!runs.length) return;
      setPeriods((prev) => [
        ...prev,
        ...runs.map((r) => ({ ...draft, id: "", localKey: localKey(), start: r.start, end: r.end })),
      ]);
      setSelectedDays(new Set());
    } else {
      // edit
      if (sheet.editingKey === "__base__") {
        setBase({ ...draft });
      } else {
        if (!draft.start || !draft.end || draft.start >= draft.end) {
          setSheetError(t("cal.errDate"));
          return;
        }
        setPeriods((prev) => prev.map((p) => (p.localKey === sheet.editingKey ? { ...draft } : p)));
      }
    }
    markDirty();
    setSheet(null);
  }
  function deleteSheet() {
    if (!sheet || sheet.mode !== "edit" || !sheet.editingKey || sheet.editingKey === "__base__") return;
    setPeriods((prev) => prev.filter((p) => p.localKey !== sheet.editingKey));
    markDirty();
    setSheet(null);
  }

  /* ───────── 프리미엄 요일 ───────── */
  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
    markDirty();
  }

  /* ───────── 저장 ───────── */
  async function save() {
    setSaving(true);
    setMsg(null);
    if (!base.supplierCostVnd) {
      setMsg({ ok: false, text: t("baseCostRequired") });
      setSaving(false);
      return;
    }
    for (const p of periods) {
      if (!p.start || !p.end || !p.supplierCostVnd) {
        setMsg({ ok: false, text: t("periodIncomplete") });
        setSaving(false);
        return;
      }
    }
    try {
      const res = await fetch(`/api/villas/${villaId}/rate-periods/cost`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSaveBody(base, periods)),
      });
      if (!res.ok) {
        setMsg({ ok: false, text: res.status === 400 ? t("invalid") : t("saveError") });
        setSaving(false);
        return;
      }
      const currentDaysKey = [...days].sort((a, b) => a - b).join(",");
      if (currentDaysKey !== initialDaysKey) {
        const dayRes = await fetch(`/api/villas/${villaId}/info`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ premiumDays: [...days] }),
        });
        if (!dayRes.ok) {
          setMsg({ ok: false, text: t("saveError") });
          setSaving(false);
          return;
        }
      }
      setDirty(false);
      setMsg({ ok: true, text: t("cal.saved") });
      setSaving(false);
      router.refresh();
    } catch {
      setMsg({ ok: false, text: t("saveError") });
      setSaving(false);
    }
  }

  /* ───────── 월 그리드 ───────── */
  const dows = DAY_INDEXES.map((d) => t(`weekdays.${d}` as "weekdays.0"));
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const gridStart = addDays(first, -first.getUTCDay());
  const weekCount = Math.ceil((first.getUTCDay() + daysInMonth) / 7);

  const sortedPeriods = useMemo(
    () =>
      [...periods].sort((a, b) => {
        const la = a.start && a.end ? nightsBetween(toUtc(a.start), toUtc(a.end)) : 1e9;
        const lb = b.start && b.end ? nightsBetween(toUtc(b.start), toUtc(b.end)) : 1e9;
        return la - lb;
      }),
    [periods]
  );

  return (
    <div className="px-4 pb-40 pt-4">
      {/* 안심 배너 */}
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-[12.5px] font-medium leading-snug text-teal-700">
        <span aria-hidden>🔒</span>
        <span>{t("cal.reassure")}</span>
      </div>

      {/* 캘린더 카드 */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-3 pb-4 shadow-sm">
        <div className="mb-3 flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label={t("cal.prevMonth")}
            onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 active:bg-neutral-50"
          >
            ‹
          </button>
          <div className="min-w-[128px] text-center text-base font-bold tabular-nums text-neutral-800">
            {t("cal.monthTitle", { month: view.m + 1, year: view.y })}
          </div>
          <button
            type="button"
            aria-label={t("cal.nextMonth")}
            onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 active:bg-neutral-50"
          >
            ›
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7">
          {dows.map((d, i) => (
            <div
              key={i}
              className={`py-0.5 text-center text-[10.5px] font-semibold ${i === 0 || i === 6 ? "text-orange-500" : "text-neutral-400"}`}
            >
              {d}
            </div>
          ))}
        </div>

        {Array.from({ length: weekCount }, (_, w) => {
          const weekStart = addDays(gridStart, w * 7);
          const bands = packWeekBands(works, weekStart);
          const laneCount = bands.reduce((m, b) => Math.max(m, b.lane + 1), 0);
          return (
            <div key={w} className="mb-1">
              <div className="grid grid-cols-7 gap-[3px]">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(weekStart, i);
                  const ds = iso(d);
                  const out = d.getUTCMonth() !== view.m;
                  const win = winnerForDate(d, works, baseWork);
                  const season: Season = win?.season ?? "LOW";
                  const color = SEASON_COLOR[season];
                  const { value, premium } = win
                    ? axisPrice(win, "cost", d, premiumDays, holidaySet)
                    : { value: null, premium: false };
                  const isBaseWin = !win || win.isBase;
                  const hol = holLabels.has(ds);
                  const picked = selectedDays.has(ds);
                  const reason = win && !win.isBase ? premiumReason(d, premiumDays, holidaySet) : null;
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => onCellTap(ds, out)}
                      aria-label={ds}
                      className="relative flex min-h-[56px] flex-col items-center justify-between rounded-[10px] px-1 pb-1 pt-1.5"
                      style={{
                        background: out
                          ? "transparent"
                          : `color-mix(in srgb, ${color} ${isBaseWin ? 6 : 14}%, #fff)`,
                        opacity: out ? 0.32 : 1,
                        outline: picked ? "2.5px solid #0D9488" : "none",
                        outlineOffset: "-1px",
                      }}
                    >
                      {hol ? (
                        <span className="absolute right-1 top-0.5 text-[9px] leading-none text-amber-500" aria-hidden>
                          ★
                        </span>
                      ) : premium && reason === "WEEKDAY_RULE" ? (
                        <span className="absolute right-1 top-0.5 text-[9px] leading-none text-[#D97706]" aria-hidden>
                          ●
                        </span>
                      ) : null}
                      <span className="text-[12px] font-semibold text-neutral-500">{d.getUTCDate()}</span>
                      <span
                        className="text-[12px] font-extrabold tabular-nums tracking-tight"
                        style={{ color: isBaseWin ? "#64748b" : color }}
                      >
                        {out ? "" : abbrevTr(value)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {laneCount > 0 && (
                <div
                  className="mt-[3px] grid grid-cols-7 gap-x-[3px] gap-y-[2px]"
                  style={{ gridTemplateRows: `repeat(${laneCount}, 14px)` }}
                >
                  {bands.map((b) => (
                    <div
                      key={b.layerId}
                      title={b.label ?? ""}
                      className="overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 text-[9px] font-bold leading-[14px] text-white"
                      style={{
                        gridColumn: `${b.colStart + 1} / ${b.colEnd + 1}`,
                        gridRow: b.lane + 1,
                        background: SEASON_COLOR[b.season],
                        borderTopLeftRadius: b.contL ? 0 : undefined,
                        borderBottomLeftRadius: b.contL ? 0 : undefined,
                        borderTopRightRadius: b.contR ? 0 : undefined,
                        borderBottomRightRadius: b.contR ? 0 : undefined,
                      }}
                    >
                      {b.contL ? "" : b.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* 범례 */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-neutral-100 px-1 pt-3 text-[11px] text-neutral-500">
          {(["LOW", "SHOULDER", "HIGH", "PEAK"] as Season[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: SEASON_COLOR[s] }} />
              {t(`seasons.${s}`)}
            </span>
          ))}
          <span className="text-[#D97706]">● {t("cal.legendPremium")}</span>
          <span className="text-amber-500">★ {t("cal.legendHoliday")}</span>
        </div>
      </div>

      {/* 프리미엄 요일 (villa 단위 — 어느 요일 밤이 웃돈인가) */}
      <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-500">weekend</span>
          <span className="text-sm font-bold text-neutral-800">{t("premiumDaysTitle")}</span>
        </div>
        <p className="mb-3 text-[11.5px] leading-snug text-neutral-500">{t("premiumDaysHint")}</p>
        <div className="grid max-w-xs grid-cols-7 gap-1.5">
          {DAY_INDEXES.map((d) => {
            const on = days.has(d);
            const weekend = d === 0 || d === 6;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`flex aspect-square w-full max-w-12 items-center justify-center rounded-xl text-sm font-bold transition-all active:scale-95 ${
                  on
                    ? "bg-amber-400 text-white shadow-sm shadow-amber-400/30"
                    : `border-2 border-neutral-200 bg-white ${weekend ? "text-neutral-600" : "text-neutral-400"}`
                }`}
              >
                {t(`weekdays.${d}` as "weekdays.0")}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-neutral-400">{t("holidayNote")}</p>
      </div>

      {/* 도구 2개 */}
      {tool === "none" && (
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={openAdd}
            className="flex h-[54px] flex-1 items-center justify-center gap-1.5 rounded-2xl bg-teal-600 text-[15px] font-bold text-white shadow-lg shadow-teal-600/25 active:scale-[.99]"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t("addPeriod")}
          </button>
          <button
            type="button"
            onClick={startSelect}
            className="flex h-[54px] flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-neutral-200 bg-white text-[15px] font-bold text-neutral-700 active:bg-neutral-50"
          >
            <span className="material-symbols-outlined text-[20px]">check_box</span>
            {t("cal.toolSelect")}
          </button>
        </div>
      )}

      {/* 레이어 목록 */}
      <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-bold text-neutral-800">{t("cal.layersTitle")}</h2>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500">
            {t("cal.layersCount", { n: layerCount })}
          </span>
        </div>
        <p className="mb-3 text-[11.5px] text-neutral-400">{t("cal.tapToEdit")}</p>

        {sortedPeriods.length === 0 && <p className="py-2 text-xs text-neutral-400">{t("cal.noLayers")}</p>}

        {sortedPeriods.map((p) => {
          const nights = p.start && p.end ? nightsBetween(toUtc(p.start), toUtc(p.end)) : 0;
          return (
            <button
              key={p.localKey}
              type="button"
              onClick={() => openEditPeriod(p.localKey)}
              className="mb-2 flex w-full items-center gap-3 rounded-xl border border-neutral-100 bg-white p-3 text-left active:bg-neutral-50"
            >
              <span className="w-1.5 self-stretch rounded-full" style={{ background: SEASON_COLOR[p.season] }} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-neutral-800">{p.label || t("cal.untitled")}</span>
                  <span
                    className="whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                    style={{ background: SEASON_COLOR[p.season] }}
                  >
                    {t(`seasons.${p.season}`)}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11.5px] tabular-nums text-neutral-500">
                  {p.start && p.end
                    ? `${p.start.replace(/-/g, "/")} → ${p.end.replace(/-/g, "/")} · ${t("cal.nights", { n: nights })}`
                    : ""}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-extrabold tabular-nums text-neutral-800">{fmtFull(p.supplierCostVnd)}</span>
                {p.premiumOpen && p.premiumCostVnd && (
                  <span className="mt-0.5 block text-[10.5px] font-bold tabular-nums text-[#D97706]">
                    ● {fmtFull(p.premiumCostVnd)}
                  </span>
                )}
              </span>
              <span className="material-symbols-outlined text-neutral-300">chevron_right</span>
            </button>
          );
        })}

        {/* 기본요금 (연중) */}
        <button
          type="button"
          onClick={openEditBase}
          className="mt-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 p-3 text-left active:bg-neutral-50"
        >
          <span className="w-1.5 self-stretch rounded-full" style={{ background: SEASON_COLOR.LOW }} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-neutral-800">{t("cal.baseRow")}</span>
            <span className="mt-0.5 block text-[11.5px] text-neutral-500">{t("cal.baseRowWhy")}</span>
          </span>
          <span className="text-right">
            <span className="block text-sm font-extrabold tabular-nums text-neutral-800">
              {base.supplierCostVnd ? fmtFull(base.supplierCostVnd) : t("cal.baseUnset")}
            </span>
            {base.ownSaleVnd && (
              <span className="mt-0.5 block text-[10.5px] font-bold tabular-nums text-teal-600">
                {t("cal.ownSale")} {fmtFull(base.ownSaleVnd)}
              </span>
            )}
          </span>
          <span className="material-symbols-outlined text-neutral-300">chevron_right</span>
        </button>
      </div>

      {/* 선택 바구니 sticky 바 (calendar 위에 겹치지 않음 — 하단 고정) */}
      {tool === "select" && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[420px] border-t border-neutral-200 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,.08)]">
          <p className="mb-2 text-center text-[12px] font-medium text-neutral-500">{t("cal.selectTapHint")}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelSelect}
              className="flex h-[52px] flex-1 items-center justify-center rounded-2xl border-2 border-neutral-200 bg-white text-sm font-bold text-neutral-600 active:bg-neutral-50"
            >
              {t("cal.cancel")}
            </button>
            <button
              type="button"
              onClick={proceedSelect}
              disabled={selectedDays.size === 0}
              className="flex h-[52px] flex-[1.4] items-center justify-center rounded-2xl bg-teal-600 text-sm font-bold text-white shadow-lg shadow-teal-600/25 active:scale-[.99] disabled:opacity-40"
            >
              {t("cal.selectedCount", { n: selectedDays.size })} · {t("cal.next")}
            </button>
          </div>
        </div>
      )}

      {/* 저장 sticky 바 */}
      {tool === "none" && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[420px] border-t border-neutral-200 bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          {msg && (
            <p
              role="status"
              className={`mb-2 text-center text-xs font-semibold ${msg.ok ? "text-teal-600" : "text-rose-600"}`}
            >
              {msg.text}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-base font-bold text-white shadow-lg shadow-teal-600/25 active:scale-[.99] disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            {saving ? t("saving") : t("save")}
            {dirty && !saving && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-white/80" aria-hidden />}
          </button>
        </div>
      )}

      {sheet && (
        <SupplierLayerSheet
          mode={sheet.mode}
          layer={draft}
          nightsSelected={sheet.runs?.reduce((n, r) => n + r.nights, 0)}
          error={sheetError}
          onChange={(l) => {
            setDraft(l);
            setSheetError(null);
          }}
          onConfirm={confirmSheet}
          onDelete={sheet.mode === "edit" && sheet.editingKey !== "__base__" ? deleteSheet : undefined}
          onCancel={() => {
            setSheet(null);
            setSheetError(null);
          }}
        />
      )}
    </div>
  );
}
