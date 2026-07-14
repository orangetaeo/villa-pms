"use client";

// 도구 4종 카드 — 기간 추가 / 날짜 선택 바구니 / 일괄 조정 / 연도 복사 (rate-calendar-ux)
// 상태는 부모(rate-calendar.tsx)가 소유(캘린더 탭↔DateField 동기화 때문). 이 파일은 UI + 콜백.
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import type { Axis, CalendarMode, Season, WorkLayer } from "./types";
import { SEASON_LIST, SEASON_VAR } from "./types";
import type { PriceFormState } from "./price-suggest";
import PriceFields from "./price-fields";
import { layerYears, nightsBetween, segmentCount, toUtc } from "./calendar-lib";

/* ───────── 부모가 소유하는 도구 상태 타입 ───────── */
export interface AddState {
  start: string;
  end: string;
  form: PriceFormState;
  err: boolean;
}
export interface Targets {
  net: boolean;
  consumer: boolean;
  cost: boolean;
}
export interface SelectState {
  days: Set<string>;
  tab: "set" | "pct";
  form: PriceFormState;
  pct: string;
  targets: Targets;
  rs: string;
  re: string;
  err: boolean;
}
export interface BulkState {
  start: string;
  end: string;
  pct: string;
  targets: Targets;
  err: boolean;
}
export interface CopyState {
  src: number;
  dst: string;
  pct: string;
  include: Set<string>;
  err: boolean;
}

const dateFieldCls =
  "bg-[var(--rc-surface2)] border border-[var(--rc-border2)] rounded-lg px-2.5 h-9 text-xs text-[var(--rc-text)] tabular-nums focus-within:ring-1 focus-within:ring-[var(--rc-accent)]";

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-card)] p-4">
    <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[var(--rc-muted)]">{title}</h2>
    {children}
  </div>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2.5 text-[11.5px] leading-relaxed text-[var(--rc-muted)]">{children}</p>
);

const Preview = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2.5 rounded-lg border border-dashed border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs tabular-nums text-[var(--rc-muted)]">
    {children}
  </div>
);

const ErrMsg = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-2 text-[11.5px] text-red-400">{children}</p>
);

function Actions({
  onApply,
  onCancel,
  applyLabel,
  cancelLabel,
  extra,
  pending,
}: {
  onApply: () => void;
  onCancel: () => void;
  applyLabel: string;
  cancelLabel: string;
  extra?: React.ReactNode;
  pending?: boolean;
}) {
  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        onClick={onApply}
        disabled={pending}
        className="rounded-lg bg-[var(--rc-accent)] px-3.5 py-1.5 text-xs font-bold text-white shadow-[0_3px_12px_rgba(59,130,246,.32)] disabled:opacity-50"
      >
        {applyLabel}
      </button>
      {extra}
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-3.5 py-1.5 text-xs font-medium text-[var(--rc-text)]"
      >
        {cancelLabel}
      </button>
    </div>
  );
}

function SeasonPills({ value, onChange, label }: { value: Season; onChange: (s: Season) => void; label: string }) {
  const tr = useTranslations("adminVillas.detail.rates");
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] text-[var(--rc-muted)]">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {SEASON_LIST.map((s) => {
          const on = value === s;
          return (
            <button
              type="button"
              key={s}
              onClick={() => onChange(s)}
              className="rounded-full border px-2.5 py-1 text-xs font-medium"
              style={
                on
                  ? { background: SEASON_VAR[s], borderColor: SEASON_VAR[s], color: "#10151F", fontWeight: 700 }
                  : { borderColor: "var(--rc-border2)", background: "var(--rc-surface2)", color: "var(--rc-text)" }
              }
            >
              {tr(`seasons.${s}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TargetChecks({ mode, targets, onChange }: { mode: CalendarMode; targets: Targets; onChange: (t: Targets) => void }) {
  const t = useTranslations("rateCalendar");
  if (mode === "supplier") return null;
  const axes: { key: Axis; label: string }[] = [
    { key: "net", label: t("axis.net") },
    { key: "consumer", label: t("axis.consumer") },
    { key: "cost", label: t("axis.cost") },
  ];
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] text-[var(--rc-muted)]">{t("adjustTargets")}</label>
      <div className="flex flex-wrap gap-3">
        {axes.map((a) => (
          <label key={a.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--rc-text)]">
            <input
              type="checkbox"
              checked={targets[a.key]}
              onChange={(e) => onChange({ ...targets, [a.key]: e.target.checked })}
              className="accent-[var(--rc-accent)]"
            />
            {a.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/* ───────── 연속 run 그룹 (선택 바구니) ───────── */
export interface Run {
  start: string;
  end: string;
  n: number;
}
export function selRuns(days: Set<string>): Run[] {
  const nextDay = (ds: string) => new Date(toUtc(ds).getTime() + 86_400_000).toISOString().slice(0, 10);
  const runs: Run[] = [];
  for (const ds of [...days].sort()) {
    const last = runs[runs.length - 1];
    // last.end(반개구간 종료=마지막 밤+1일)가 현재 날짜와 같으면 연속 → 확장.
    if (last && last.end === ds) {
      last.end = nextDay(ds);
      last.n++;
    } else {
      runs.push({ start: ds, end: nextDay(ds), n: 1 });
    }
  }
  return runs;
}

/* ═══════════════ 기간 추가 ═══════════════ */
export function AddTool({
  mode,
  state,
  fxVndPerKrw,
  pending,
  onChange,
  onApply,
  onCancel,
}: {
  mode: CalendarMode;
  state: AddState;
  fxVndPerKrw: number | null;
  pending: boolean;
  onChange: (s: AddState) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("rateCalendar");
  const valid = !!state.start && !!state.end && state.start < state.end;
  const nights = valid ? nightsBetween(toUtc(state.start), toUtc(state.end)) : 0;
  return (
    <Card title={t("add.title")}>
      <Hint>{t("add.hint")}</Hint>
      <div className="mb-2.5 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("startDate")}</label>
          <DateField
            value={state.start}
            onChange={(e) => onChange({ ...state, start: e.target.value, err: false })}
            aria-label={t("startDate")}
            className={dateFieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("endDate")}</label>
          <DateField
            value={state.end}
            onChange={(e) => onChange({ ...state, end: e.target.value, err: false })}
            aria-label={t("endDate")}
            className={dateFieldCls}
          />
        </div>
      </div>
      {valid && <Preview>{t("nights", { n: nights })}</Preview>}
      <div className="mb-2.5">
        <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("labelField")}</label>
        <input
          value={state.form.label}
          onChange={(e) => onChange({ ...state, form: { ...state.form, label: e.target.value } })}
          maxLength={60}
          placeholder={t("labelPlaceholder")}
          aria-label={t("labelField")}
          className="w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs text-[var(--rc-text)]"
        />
      </div>
      <div className="mb-2.5">
        <SeasonPills
          value={state.form.season as Season}
          onChange={(s) => onChange({ ...state, form: { ...state.form, season: s } })}
          label={t("seasonField")}
        />
      </div>
      <PriceFields mode={mode} fields={state.form} fxVndPerKrw={fxVndPerKrw} onChange={(f) => onChange({ ...state, form: f })} />
      <Actions onApply={onApply} onCancel={onCancel} applyLabel={t("add.save")} cancelLabel={t("cancel")} pending={pending} />
      {state.err && <ErrMsg>{t("invalid")}</ErrMsg>}
    </Card>
  );
}

/* ═══════════════ 날짜 선택 바구니 ═══════════════ */
export function SelectTool({
  mode,
  state,
  fxVndPerKrw,
  pending,
  onChange,
  onAddRange,
  onRemoveRun,
  onClear,
  onApply,
  onCancel,
}: {
  mode: CalendarMode;
  state: SelectState;
  fxVndPerKrw: number | null;
  pending: boolean;
  onChange: (s: SelectState) => void;
  onAddRange: () => void;
  onRemoveRun: (run: Run) => void;
  onClear: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("rateCalendar");
  const runs = selRuns(state.days);
  const total = state.days.size;
  return (
    <Card title={t("select.title")}>
      <Hint>{t("select.hint")}</Hint>
      <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("select.rangeAdd")}</label>
      <div className="mb-2.5 grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
        <DateField
          value={state.rs}
          onChange={(e) => onChange({ ...state, rs: e.target.value })}
          aria-label={t("startDate")}
          className={dateFieldCls}
        />
        <DateField
          value={state.re}
          onChange={(e) => onChange({ ...state, re: e.target.value })}
          aria-label={t("endDate")}
          className={dateFieldCls}
        />
        <button
          type="button"
          onClick={onAddRange}
          className="h-9 rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-3 text-xs font-medium text-[var(--rc-text)]"
        >
          {t("select.addBtn")}
        </button>
      </div>
      {total > 0 ? (
        <>
          <Preview>{t("select.count", { n: total, r: runs.length })}</Preview>
          {runs.map((r) => (
            <div
              key={r.start}
              className="mb-1.5 flex items-center gap-2 rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-1.5 text-xs tabular-nums"
            >
              <span className="h-2 w-2 rounded-[3px]" style={{ background: "var(--rc-accent)" }} />
              {r.start.replace(/-/g, ".")} → {r.end.replace(/-/g, ".")} · {t("nights", { n: r.n })}
              <button
                type="button"
                onClick={() => onRemoveRun(r)}
                aria-label={t("deleteLayer")}
                className="ml-auto text-[var(--rc-faint)] hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </>
      ) : (
        <Hint>{t("select.empty")}</Hint>
      )}

      <div className="mb-2.5 mt-1 inline-flex rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] p-0.5">
        {(["set", "pct"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => onChange({ ...state, tab, err: false })}
            className={`rounded-md px-2.5 py-1 text-xs ${
              state.tab === tab ? "bg-[var(--rc-accent)] font-semibold text-white" : "text-[var(--rc-muted)]"
            }`}
          >
            {tab === "set" ? t("select.modeSet") : t("select.modePct")}
          </button>
        ))}
      </div>

      {state.tab === "set" ? (
        <>
          <div className="mb-2.5">
            <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("labelField")}</label>
            <input
              value={state.form.label}
              onChange={(e) => onChange({ ...state, form: { ...state.form, label: e.target.value } })}
              maxLength={60}
              placeholder={t("labelPlaceholder")}
              aria-label={t("labelField")}
              className="w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs text-[var(--rc-text)]"
            />
          </div>
          <div className="mb-2.5">
            <SeasonPills
              value={state.form.season as Season}
              onChange={(s) => onChange({ ...state, form: { ...state.form, season: s } })}
              label={t("seasonField")}
            />
          </div>
          <PriceFields mode={mode} fields={state.form} fxVndPerKrw={fxVndPerKrw} onChange={(f) => onChange({ ...state, form: f })} />
        </>
      ) : (
        <>
          <div className="mb-2.5">
            <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("pctLabel")}</label>
            <input
              value={state.pct}
              onChange={(e) => onChange({ ...state, pct: e.target.value, err: false })}
              inputMode="text"
              placeholder="+10"
              aria-label={t("pctLabel")}
              className="w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs tabular-nums text-[var(--rc-text)]"
            />
          </div>
          <TargetChecks mode={mode} targets={state.targets} onChange={(tg) => onChange({ ...state, targets: tg })} />
        </>
      )}
      <Actions
        onApply={onApply}
        onCancel={onCancel}
        applyLabel={t("apply")}
        cancelLabel={t("cancel")}
        pending={pending}
        extra={
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-3.5 py-1.5 text-xs font-medium text-[var(--rc-text)]"
          >
            {t("select.clear")}
          </button>
        }
      />
      {state.err && <ErrMsg>{t("invalid")}</ErrMsg>}
    </Card>
  );
}

/* ═══════════════ 일괄 조정 ═══════════════ */
export function BulkTool({
  mode,
  state,
  layers,
  base,
  pending,
  onChange,
  onApply,
  onCancel,
}: {
  mode: CalendarMode;
  state: BulkState;
  layers: WorkLayer[];
  base: WorkLayer | null;
  pending: boolean;
  onChange: (s: BulkState) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("rateCalendar");
  const valid = !!state.start && !!state.end && state.start < state.end;
  const nights = valid ? nightsBetween(toUtc(state.start), toUtc(state.end)) : 0;
  const segs = valid ? segmentCount({ start: toUtc(state.start), end: toUtc(state.end) }, layers, base) : 0;
  return (
    <Card title={t("bulk.title")}>
      <Hint>{t("bulk.hint")}</Hint>
      <div className="mb-2.5 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("startDate")}</label>
          <DateField
            value={state.start}
            onChange={(e) => onChange({ ...state, start: e.target.value, err: false })}
            aria-label={t("startDate")}
            className={dateFieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("endDate")}</label>
          <DateField
            value={state.end}
            onChange={(e) => onChange({ ...state, end: e.target.value, err: false })}
            aria-label={t("endDate")}
            className={dateFieldCls}
          />
        </div>
      </div>
      <div className="mb-2.5">
        <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("pctLabel")}</label>
        <input
          value={state.pct}
          onChange={(e) => onChange({ ...state, pct: e.target.value, err: false })}
          placeholder="+10"
          aria-label={t("pctLabel")}
          className="w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs tabular-nums text-[var(--rc-text)]"
        />
      </div>
      <div className="mb-2.5">
        <TargetChecks mode={mode} targets={state.targets} onChange={(tg) => onChange({ ...state, targets: tg })} />
      </div>
      {valid && <Preview>{t("bulk.preview", { n: nights, s: segs })}</Preview>}
      <Actions onApply={onApply} onCancel={onCancel} applyLabel={t("apply")} cancelLabel={t("cancel")} pending={pending} />
      {state.err && <ErrMsg>{t("invalid")}</ErrMsg>}
    </Card>
  );
}

/* ═══════════════ 연도 복사 ═══════════════ */
export function CopyTool({
  state,
  layers,
  pending,
  onChange,
  onApply,
  onCancel,
}: {
  state: CopyState;
  layers: WorkLayer[];
  pending: boolean;
  onChange: (s: CopyState) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("rateCalendar");
  const years = [...new Set(layers.filter((l) => !l.isBase).flatMap((l) => layerYears(l)))].sort((a, b) => a - b);
  const srcLayers = layers.filter((l) => !l.isBase && layerYears(l).includes(state.src));
  const incCount = srcLayers.filter((l) => state.include.has(l.id)).length;
  return (
    <Card title={t("copy.title")}>
      <Hint>{t("copy.hint")}</Hint>
      <div className="mb-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--rc-text)]">
        {t("copy.warn")}
      </div>
      <div className="mb-2.5 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("copy.srcYear")}</label>
          <select
            value={state.src}
            onChange={(e) => {
              const src = Number(e.target.value);
              const inc = new Set(layers.filter((l) => !l.isBase && layerYears(l).includes(src)).map((l) => l.id));
              onChange({ ...state, src, dst: String(src + 1), include: inc, err: false });
            }}
            aria-label={t("copy.srcYear")}
            className="h-9 w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2 text-xs text-[var(--rc-text)]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("copy.dstYear")}</label>
          <input
            value={state.dst}
            onChange={(e) => onChange({ ...state, dst: e.target.value.replace(/\D/g, ""), err: false })}
            inputMode="numeric"
            aria-label={t("copy.dstYear")}
            className="h-9 w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 text-xs tabular-nums text-[var(--rc-text)]"
          />
        </div>
      </div>
      <div className="mb-2.5">
        <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("copy.pctLabel")}</label>
        <input
          value={state.pct}
          onChange={(e) => onChange({ ...state, pct: e.target.value })}
          placeholder="+5"
          aria-label={t("copy.pctLabel")}
          className="w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs tabular-nums text-[var(--rc-text)]"
        />
      </div>
      <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("copy.pick")}</label>
      {srcLayers.length ? (
        srcLayers.map((l) => (
          <label
            key={l.id}
            className="mb-1.5 flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-1.5 text-xs"
          >
            <input
              type="checkbox"
              checked={state.include.has(l.id)}
              onChange={(e) => {
                const inc = new Set(state.include);
                if (e.target.checked) inc.add(l.id);
                else inc.delete(l.id);
                onChange({ ...state, include: inc });
              }}
              className="accent-[var(--rc-accent)]"
            />
            <span className="h-2 w-2 rounded-[3px]" style={{ background: SEASON_VAR[l.season] }} />
            <span className="truncate">{l.label || t("untitled")}</span>
            <span className="ml-auto tabular-nums text-[var(--rc-muted)]">
              {l.start?.toISOString().slice(5, 10)}~{l.end?.toISOString().slice(5, 10)}
            </span>
          </label>
        ))
      ) : (
        <Hint>{t("copy.emptyYear")}</Hint>
      )}
      {incCount > 0 && <Preview>{t("copy.preview", { n: incCount, y: state.dst })}</Preview>}
      <Actions onApply={onApply} onCancel={onCancel} applyLabel={t("copy.apply")} cancelLabel={t("cancel")} pending={pending} />
      {state.err && <ErrMsg>{t("invalid")}</ErrMsg>}
    </Card>
  );
}
