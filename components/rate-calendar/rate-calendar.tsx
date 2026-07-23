"use client";

// 기간별 요금 캘린더 — 공용 오케스트레이터 (rate-calendar-ux)
//
// mode='admin'(다크 ko, 3축) — 이번 배선 대상. mode='supplier'(라이트 vi, 원가축)는 prop 인터페이스만 준비
//   (UX-VN이 부모에서 cost 축만 주입하면 그대로 동작 — 이 컴포넌트는 스스로 fetch하지 않음).
// 데이터: 부모(RSC)가 layers(DTO)·premiumDays·holidays를 주입. 변경은 layer/batch API 호출 후 router.refresh().
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";
import type { Axis, CalendarMode, HolidayDTO, RateLayerDTO, WorkLayer } from "./types";
import { SEASON_LIST, SEASON_VAR } from "./types";
import { addDays, holidayTimeSet, iso, layerYears, parsePct, toUtc, toWorkLayer } from "./calendar-lib";
import { emptyPriceForm, toPricePayload, type PriceFormState } from "./price-suggest";
import CalendarGrid from "./calendar-grid";
import LayerPanel from "./layer-panel";
import LayerEditSheet, { type EditState } from "./layer-edit-sheet";
import {
  AddTool,
  BulkTool,
  CopyTool,
  SelectTool,
  selRuns,
  type AddState,
  type BulkState,
  type CopyState,
  type Run,
  type SelectState,
  type Targets,
} from "./tool-cards";

type Tool =
  | { kind: "none" }
  | { kind: "add"; s: AddState }
  | { kind: "select"; s: SelectState }
  | { kind: "bulk"; s: BulkState }
  | { kind: "copy"; s: CopyState };

const DEFAULT_TARGETS: Targets = { net: true, consumer: true, cost: false };

/** WorkLayer → 편집 폼 초기값. */
function formFromLayer(w: WorkLayer): PriceFormState {
  return {
    season: w.season,
    supplierCostVnd: w.cost.toString(),
    marginType: w.marginType,
    marginValue: w.marginValue,
    salePriceVnd: w.net != null ? w.net.toString() : "",
    salePriceKrw: w.netKrw ?? 0,
    consumerMarginType: w.consumerMarginType,
    consumerMarginValue: w.consumerMarginValue,
    consumerSalePriceVnd: w.consumer != null ? w.consumer.toString() : "",
    consumerSalePriceKrw: w.consumerKrw ?? 0,
    premiumEnabled: w.pCost != null || w.pNet != null || w.pNetKrw != null || w.pConsumer != null || w.pConsumerKrw != null,
    premiumSupplierCostVnd: w.pCost != null ? w.pCost.toString() : "",
    premiumSalePriceVnd: w.pNet != null ? w.pNet.toString() : "",
    premiumSalePriceKrw: w.pNetKrw ?? 0,
    premiumConsumerSalePriceVnd: w.pConsumer != null ? w.pConsumer.toString() : "",
    premiumConsumerSalePriceKrw: w.pConsumerKrw ?? 0,
    label: w.label ?? "",
  };
}

export default function RateCalendar({
  villaId,
  mode = "admin",
  fxVndPerKrw,
  layers: layerDTOs,
  premiumDays,
  holidays,
}: {
  villaId: string;
  mode?: CalendarMode;
  fxVndPerKrw: number | null;
  layers: RateLayerDTO[];
  premiumDays: number[];
  holidays: HolidayDTO[];
}) {
  const t = useTranslations("rateCalendar");
  const tr = useTranslations("adminVillas.detail.rates");
  const router = useRouter();

  const layers = useMemo(() => layerDTOs.map(toWorkLayer), [layerDTOs]);
  const base = useMemo(() => layers.find((l) => l.isBase) ?? null, [layers]);
  const holidaySet = useMemo(() => holidayTimeSet(holidays), [holidays]);
  const yearOptions = useMemo(
    () => [...new Set(layers.filter((l) => !l.isBase).flatMap((l) => layerYears(l)))].sort((a, b) => a - b),
    [layers]
  );

  const currentYear = new Date().getUTCFullYear();
  const defaultYear = useMemo<number | "all">(() => {
    if (yearOptions.length === 0) return "all";
    const future = yearOptions.find((y) => y >= currentYear);
    return future ?? yearOptions[yearOptions.length - 1];
  }, [yearOptions, currentYear]);

  const [view, setView] = useState(() => ({ y: currentYear, m: new Date().getUTCMonth() }));
  const [axis, setAxis] = useState<Axis>(mode === "supplier" ? "cost" : "net");
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>({ kind: "none" });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [hlLayerId, setHlLayerId] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<number | "all">(defaultYear);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 프리미엄 요일 편집 (admin 전용 — ADR-0042 통합). 범례 "● 프리미엄일"을 눌러 인라인 칩 행으로 펼침.
  // 로컬 상태로 즉시 반영(캘린더 ● 마커·판정과 동시 갱신) 후 PATCH /info로 영속화.
  const [premiumDaysState, setPremiumDaysState] = useState<Set<number>>(() => new Set(premiumDays));
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [premiumSaving, setPremiumSaving] = useState(false);
  const [premiumMsg, setPremiumMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 캘린더·패널에 흘려보내는 프리미엄 요일: admin은 편집 중 로컬 상태(즉시 일관), supplier는 주입 prop 그대로.
  const livePremiumDays = useMemo(
    () => (mode === "admin" ? [...premiumDaysState].sort((a, b) => a - b) : premiumDays),
    [mode, premiumDaysState, premiumDays]
  );

  function togglePremiumDay(d: number) {
    setPremiumDaysState((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
    setPremiumMsg(null);
  }
  async function savePremiumDays() {
    setPremiumSaving(true);
    setPremiumMsg(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // 빈 배열 허용(공휴일만 프리미엄) — 정렬·중복제거는 서버 담당
        body: JSON.stringify({ premiumDays: [...premiumDaysState] }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setPremiumMsg({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setPremiumMsg({ ok: false, text: t("saveError") });
    } finally {
      setPremiumSaving(false);
    }
  }

  const axes: Axis[] = mode === "supplier" ? ["cost"] : ["net", "consumer", "cost"];

  const closeAll = () => {
    setTool({ kind: "none" });
    setEdit(null);
  };

  /* ───────── API 헬퍼 ───────── */
  const BASE = `/api/villas/${villaId}/rate-periods`;
  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        setMessage({ ok: false, text: res.status === 400 ? t("invalid") : t("saveError") });
        return false;
      }
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
      return true;
    } catch {
      setMessage({ ok: false, text: t("saveError") });
      return false;
    } finally {
      setPending(false);
    }
  }

  /* ───────── 캘린더 셀 탭 (도구별 분기) ───────── */
  function onCellTap(ds: string) {
    if (tool.kind === "select") {
      const days = new Set(tool.s.days);
      if (days.has(ds)) days.delete(ds);
      else days.add(ds);
      setTool({ kind: "select", s: { ...tool.s, days, err: false } });
      return;
    }
    if (tool.kind === "add" || tool.kind === "bulk") {
      const s = tool.s;
      let start = s.start;
      let end = s.end;
      if (!start || (start && end)) {
        start = ds;
        end = "";
      } else {
        let a = start;
        let b = ds;
        if (b < a) {
          b = start;
          a = ds;
        }
        start = a;
        end = iso(addDays(toUtc(b), 1));
      }
      if (tool.kind === "add") setTool({ kind: "add", s: { ...s, start, end, err: false } as AddState });
      else setTool({ kind: "bulk", s: { ...s, start, end, err: false } as BulkState });
      return;
    }
    setSelected(ds);
  }

  /* ───────── 캘린더 드래그 범위 지정 (a≤b 포함 구간) ─────────
     add/bulk: 시작~종료(체크아웃=b+1) 채움 · select: 구간 전체를 바구니에 추가 ·
     도구 없음: [기간 추가]를 드래그 구간으로 미리 채워서 열기 · copy: 무시 */
  function onRangeDrag(a: string, b: string) {
    const endEx = iso(addDays(toUtc(b), 1));
    if (tool.kind === "select") {
      const days = new Set(tool.s.days);
      for (let d = toUtc(a); iso(d) < endEx; d = addDays(d, 1)) days.add(iso(d));
      setTool({ kind: "select", s: { ...tool.s, days, err: false } });
      return;
    }
    if (tool.kind === "add") {
      setTool({ kind: "add", s: { ...tool.s, start: a, end: endEx, err: false } });
      return;
    }
    if (tool.kind === "bulk") {
      setTool({ kind: "bulk", s: { ...tool.s, start: a, end: endEx, err: false } });
      return;
    }
    if (tool.kind === "copy") return;
    setSelected(null);
    setEdit(null);
    setTool({ kind: "add", s: { start: a, end: endEx, form: emptyPriceForm("HIGH"), err: false } });
  }

  /* ───────── 도구 열기 ───────── */
  const openAdd = () => {
    setSelected(null);
    setEdit(null);
    setTool({ kind: "add", s: { start: "", end: "", form: emptyPriceForm("HIGH"), err: false } });
  };
  const openSelect = () => {
    setSelected(null);
    setEdit(null);
    setTool({
      kind: "select",
      s: { days: new Set(), tab: "set", form: emptyPriceForm("HIGH"), pct: "", targets: { ...DEFAULT_TARGETS }, rs: "", re: "", err: false },
    });
  };
  const openBulk = () => {
    setSelected(null);
    setEdit(null);
    setTool({ kind: "bulk", s: { start: "", end: "", pct: "", targets: { ...DEFAULT_TARGETS }, err: false } });
  };
  const openCopy = () => {
    setSelected(null);
    setEdit(null);
    const src = yearOptions.find((y) => y >= currentYear) ?? yearOptions[yearOptions.length - 1] ?? currentYear;
    const include = new Set(layers.filter((l) => !l.isBase && layerYears(l).includes(src)).map((l) => l.id));
    setTool({ kind: "copy", s: { src, dst: String(src + 1), pct: "", include, err: false } });
  };

  /* ───────── 적용 핸들러 ───────── */
  async function applyAdd() {
    if (tool.kind !== "add") return;
    const s = tool.s;
    if (!s.start || !s.end || s.start >= s.end) {
      setTool({ kind: "add", s: { ...s, err: true } });
      return;
    }
    const price = toPricePayload(s.form);
    const ok = await call(`${BASE}/layers`, "POST", {
      season: s.form.season,
      startDate: s.start,
      endDate: s.end,
      label: s.form.label.trim() || null,
      ...price,
    });
    if (ok) {
      setSelected(s.start);
      closeAll();
    }
  }

  async function applySelect() {
    if (tool.kind !== "select") return;
    const s = tool.s;
    const runs = selRuns(s.days);
    if (!runs.length) {
      setTool({ kind: "select", s: { ...s, err: true } });
      return;
    }
    const ranges = runs.map((r) => ({ start: r.start, end: r.end }));
    let ok = false;
    if (s.tab === "set") {
      ok = await call(`${BASE}/batch`, "POST", {
        action: "SET",
        ranges,
        season: s.form.season,
        label: s.form.label.trim() || null,
        prices: toPricePayload(s.form),
      });
    } else {
      const pct = parsePct(s.pct);
      const targets: Targets = mode === "supplier" ? { net: false, consumer: false, cost: true } : s.targets;
      if (pct == null || !(targets.net || targets.consumer || targets.cost)) {
        setTool({ kind: "select", s: { ...s, err: true } });
        return;
      }
      ok = await call(`${BASE}/batch`, "POST", { action: "ADJUST", ranges, pct, targets });
    }
    if (ok) {
      setSelected(runs[0].start);
      closeAll();
    }
  }

  async function applyBulk() {
    if (tool.kind !== "bulk") return;
    const s = tool.s;
    const pct = parsePct(s.pct);
    const targets: Targets = mode === "supplier" ? { net: false, consumer: false, cost: true } : s.targets;
    if (!s.start || !s.end || s.start >= s.end || pct == null || !(targets.net || targets.consumer || targets.cost)) {
      setTool({ kind: "bulk", s: { ...s, err: true } });
      return;
    }
    const ok = await call(`${BASE}/batch`, "POST", {
      action: "ADJUST",
      ranges: [{ start: s.start, end: s.end }],
      pct,
      targets,
    });
    if (ok) {
      setSelected(s.start);
      closeAll();
    }
  }

  async function applyCopy() {
    if (tool.kind !== "copy") return;
    const s = tool.s;
    const dst = Number(s.dst);
    const layerIds = [...s.include];
    if (!layerIds.length || !Number.isInteger(dst) || dst < 2020 || dst > 2100 || dst === s.src) {
      setTool({ kind: "copy", s: { ...s, err: true } });
      return;
    }
    const pct = parsePct(s.pct) ?? undefined;
    const ok = await call(`${BASE}/batch`, "POST", {
      action: "COPY_YEAR",
      srcYear: s.src,
      dstYear: dst,
      layerIds,
      ...(pct != null ? { pct } : {}),
    });
    if (ok) {
      setView({ y: dst, m: view.m });
      setYearFilter(dst);
      closeAll();
    }
  }

  /* ───────── 선택 바구니 보조 ───────── */
  function addSelectRange() {
    if (tool.kind !== "select") return;
    const s = tool.s;
    if (s.rs && s.re && s.rs < s.re) {
      const days = new Set(s.days);
      for (let d = toUtc(s.rs); iso(d) < s.re; d = addDays(d, 1)) days.add(iso(d));
      setTool({ kind: "select", s: { ...s, days, err: false } });
    }
  }
  function removeSelectRun(run: Run) {
    if (tool.kind !== "select") return;
    const s = tool.s;
    const days = new Set(s.days);
    for (let d = toUtc(run.start); iso(d) < run.end; d = addDays(d, 1)) days.delete(iso(d));
    setTool({ kind: "select", s: { ...s, days } });
  }

  /* ───────── 레이어 편집·삭제·batch 취소 ───────── */
  function openEdit(id: string) {
    const w = layers.find((l) => l.id === id);
    if (!w) return;
    setTool({ kind: "none" });
    setEdit({
      layerId: w.id,
      isBase: w.isBase,
      start: w.start ? iso(w.start) : "",
      end: w.end ? iso(w.end) : "",
      form: formFromLayer(w),
      err: false,
    });
  }
  async function saveEdit() {
    if (!edit) return;
    const price = toPricePayload(edit.form);
    const body: Record<string, unknown> = {
      season: edit.form.season,
      label: edit.form.label.trim() || null,
      ...price,
    };
    if (!edit.isBase) {
      if (!edit.start || !edit.end || edit.start >= edit.end) {
        setEdit({ ...edit, err: true });
        return;
      }
      body.startDate = edit.start;
      body.endDate = edit.end;
    }
    const ok = await call(`${BASE}/layers/${edit.layerId}`, "PATCH", body);
    if (ok) setEdit(null);
  }
  async function deleteLayer(id: string) {
    await call(`${BASE}/layers/${id}`, "DELETE");
  }
  async function deleteBatch(batchId: string) {
    await call(`${BASE}/batch/${batchId}`, "DELETE");
  }

  function onLayerClick(id: string) {
    const w = layers.find((l) => l.id === id);
    if (!w || !w.start) return;
    setView({ y: w.start.getUTCFullYear(), m: w.start.getUTCMonth() });
    setSelected(iso(w.start));
  }

  /* ───────── 렌더 ───────── */
  const toolBtn = (label: string, onClick: () => void, active: boolean, primary = false) => (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg border px-3 py-1.5 text-xs font-medium",
        primary
          ? "border-[var(--rc-accent)] bg-[var(--rc-accent)] text-white shadow-[0_3px_12px_rgba(59,130,246,.32)]"
          : active
            ? "border-[var(--rc-accent)] bg-[var(--rc-surface2)] text-[var(--rc-text)]"
            : "border-[var(--rc-border2)] bg-[var(--rc-surface2)] text-[var(--rc-text)] hover:border-[var(--rc-accent)]",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <CollapsibleCard title={t("title")} icon="calendar_month">
      <div className="rate-calendar">
        {/* 규칙 바 */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-card)] px-4 py-2.5 text-[12.5px] text-[var(--rc-muted)]">
          <span>{t("rule")}</span>
          <span className="flex-1" />
          {SEASON_LIST.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: SEASON_VAR[s] }} />
              {tr(`seasons.${s}`)}
            </span>
          ))}
          {mode === "admin" ? (
            <button
              type="button"
              onClick={() => setPremiumOpen((o) => !o)}
              aria-expanded={premiumOpen}
              title={t("premium.editLabel")}
              className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--rc-shoulder)] hover:opacity-80"
            >
              {t("legendPremium")}
              <span className="material-symbols-outlined text-[15px] leading-none">
                {premiumOpen ? "expand_less" : "edit"}
              </span>
            </button>
          ) : (
            <span className="whitespace-nowrap text-[var(--rc-shoulder)]">{t("legendPremium")}</span>
          )}
          <span className="whitespace-nowrap text-amber-300">{t("legendHoliday")}</span>
        </div>

        {/* 프리미엄 요일 인라인 편집 (admin) — 범례 클릭 시 펼침. 어느 요일 밤이 프리미엄인가의 요일 축(비밀 아님).
            실제 프리미엄 금액은 레이어 편집의 "프리미엄 요금"에서 입력, 공휴일은 설정 → 공휴일 관리. */}
        {mode === "admin" && premiumOpen && (
          <div className="mb-4 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-card)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="grid grid-cols-7 gap-1.5">
                {DAY_INDEXES.map((d) => {
                  const on = premiumDaysState.has(d);
                  const weekend = d === 0 || d === 6;
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePremiumDay(d)}
                      className={`flex aspect-square w-9 items-center justify-center rounded-lg text-sm font-bold transition-all ${
                        on
                          ? "border border-[var(--rc-shoulder)] bg-[color-mix(in_srgb,var(--rc-shoulder)_16%,transparent)] text-[var(--rc-shoulder)]"
                          : `border border-[var(--rc-border2)] bg-[var(--rc-surface2)] hover:border-[var(--rc-accent)] ${weekend ? "text-[var(--rc-text)]" : "text-[var(--rc-muted)]"}`
                      }`}
                    >
                      {t(`premium.weekdays.${d}` as "premium.weekdays.0")}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={savePremiumDays}
                disabled={premiumSaving}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--rc-accent)] bg-[var(--rc-accent)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">save</span>
                {premiumSaving ? t("premium.saving") : t("premium.save")}
              </button>
              {premiumMsg && (
                <span
                  role="status"
                  className={`text-xs font-medium ${premiumMsg.ok ? "text-emerald-400" : "text-red-400"}`}
                >
                  {premiumMsg.text}
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--rc-muted)]">{t("premium.hint")}</p>
          </div>
        )}

        {/* 축 토글 + 도구 + 상태 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {axes.length > 1 && (
            <div className="inline-flex rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] p-0.5">
              {axes.map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setAxis(a)}
                  className={`rounded-md px-3 py-1.5 text-xs ${
                    axis === a ? "bg-[var(--rc-accent)] font-semibold text-white" : "text-[var(--rc-muted)]"
                  }`}
                >
                  {t(`axis.${a}`)}
                </button>
              ))}
            </div>
          )}
          <span className="flex-1" />
          {toolBtn(t("tools.add"), openAdd, tool.kind === "add", true)}
          {toolBtn(t("tools.select"), openSelect, tool.kind === "select")}
          {toolBtn(t("tools.bulk"), openBulk, tool.kind === "bulk")}
          {toolBtn(t("tools.copy"), openCopy, tool.kind === "copy")}
          {message && (
            <span
              role="status"
              className={`ml-1 text-xs font-medium ${message.ok ? "text-emerald-400" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_344px]">
          <CalendarGrid
            year={view.y}
            month={view.m}
            layers={layers}
            base={base}
            axis={axis}
            premiumDays={livePremiumDays}
            holidaySet={holidaySet}
            holidays={holidays}
            selected={selected}
            pickedDays={tool.kind === "select" ? tool.s.days : EMPTY_SET}
            pickRangeStart={tool.kind === "add" || tool.kind === "bulk" ? tool.s.start || null : null}
            pickRangeEnd={tool.kind === "add" || tool.kind === "bulk" ? tool.s.end || null : null}
            hlLayerId={hlLayerId}
            onPrev={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
            onNext={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
            onCellTap={onCellTap}
            onRangeDrag={onRangeDrag}
            onBandEnter={setHlLayerId}
            onBandLeave={() => setHlLayerId(null)}
            onBandClick={onLayerClick}
          />

          <div className="flex flex-col gap-4">
            {tool.kind === "add" && (
              <AddTool
                mode={mode}
                state={tool.s}
                fxVndPerKrw={fxVndPerKrw}
                pending={pending}
                onChange={(s) => setTool({ kind: "add", s })}
                onApply={applyAdd}
                onCancel={closeAll}
              />
            )}
            {tool.kind === "select" && (
              <SelectTool
                mode={mode}
                state={tool.s}
                fxVndPerKrw={fxVndPerKrw}
                pending={pending}
                onChange={(s) => setTool({ kind: "select", s })}
                onAddRange={addSelectRange}
                onRemoveRun={removeSelectRun}
                onClear={() => setTool({ kind: "select", s: { ...tool.s, days: new Set() } })}
                onApply={applySelect}
                onCancel={closeAll}
              />
            )}
            {tool.kind === "bulk" && (
              <BulkTool
                mode={mode}
                state={tool.s}
                layers={layers}
                base={base}
                pending={pending}
                onChange={(s) => setTool({ kind: "bulk", s })}
                onApply={applyBulk}
                onCancel={closeAll}
              />
            )}
            {tool.kind === "copy" && (
              <CopyTool
                state={tool.s}
                layers={layers}
                pending={pending}
                onChange={(s) => setTool({ kind: "copy", s })}
                onApply={applyCopy}
                onCancel={closeAll}
              />
            )}

            <LayerPanel
              axis={axis}
              layers={layers}
              base={base}
              premiumDays={livePremiumDays}
              holidaySet={holidaySet}
              holidays={holidays}
              selected={selected}
              yearFilter={yearFilter}
              yearOptions={yearOptions}
              onYearFilter={setYearFilter}
              onEditLayer={openEdit}
              onDeleteLayer={deleteLayer}
              onDeleteBatch={deleteBatch}
              onLayerClick={onLayerClick}
              onLayerEnter={setHlLayerId}
              onLayerLeave={() => setHlLayerId(null)}
            />
          </div>
        </div>

        {edit && (
          <LayerEditSheet
            mode={mode}
            state={edit}
            fxVndPerKrw={fxVndPerKrw}
            pending={pending}
            onChange={setEdit}
            onSave={saveEdit}
            onCancel={() => setEdit(null)}
          />
        )}
      </div>
    </CollapsibleCard>
  );
}

const EMPTY_SET: Set<string> = new Set();

// getUTCDay 인덱스 0=일 … 6=토 (숙박일 @db.Date UTC 자정 기준 — lib/pricing과 동일 축)
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;
