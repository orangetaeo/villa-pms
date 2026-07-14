"use client";

// 우측 패널 — 요금 레이어 목록(batch 그룹·연도 필터) + 선택 날짜 승자 스택 (rate-calendar-ux)
import { useTranslations } from "next-intl";
import { formatThousands } from "@/lib/format";
import type { Axis, Season, WorkLayer } from "./types";
import { SEASON_VAR } from "./types";
import { axisPrice, iso, layerYears, nightsBetween, premiumReason, sortLayersForPanel, stackForDate, toUtc } from "./calendar-lib";

const fmtFull = (v: bigint | null): string => (v == null ? "—" : `${formatThousands(v)} ₫`);
const fmtDate = (d: Date): string => iso(d).replace(/-/g, ".");

/** 레이어 카드용 축 기준가(날짜 무관) + 프리미엄 기준가. */
function layerAxisValue(w: WorkLayer, axis: Axis): { base: bigint | null; premium: bigint | null } {
  if (axis === "cost") return { base: w.cost, premium: w.pCost };
  if (axis === "net") return { base: w.net, premium: w.pNet };
  return { base: w.consumer ?? w.net, premium: w.pConsumer ?? w.pNet };
}

export default function LayerPanel({
  axis,
  layers,
  base,
  premiumDays,
  holidaySet,
  holidays,
  selected,
  yearFilter,
  yearOptions,
  onYearFilter,
  onEditLayer,
  onDeleteLayer,
  onDeleteBatch,
  onLayerClick,
  onLayerEnter,
  onLayerLeave,
}: {
  axis: Axis;
  layers: WorkLayer[];
  base: WorkLayer | null;
  premiumDays: number[];
  holidaySet: Set<number>;
  holidays: { date: string; label: string }[];
  selected: string | null;
  yearFilter: number | "all";
  yearOptions: number[];
  onYearFilter: (y: number | "all") => void;
  onEditLayer: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onDeleteBatch: (batchId: string) => void;
  onLayerClick: (id: string) => void;
  onLayerEnter: (id: string) => void;
  onLayerLeave: () => void;
}) {
  const t = useTranslations("rateCalendar");
  const tr = useTranslations("adminVillas.detail.rates");

  const sorted = sortLayersForPanel(layers).filter(
    (w) => yearFilter === "all" || layerYears(w).includes(yearFilter)
  );

  // batchId 그룹핑 — 정렬 순서 유지하며 같은 batchId를 인접 묶음으로.
  type Block = { kind: "single"; layer: WorkLayer } | { kind: "batch"; batchId: string; layers: WorkLayer[] };
  const blocks: Block[] = [];
  const seenBatch = new Set<string>();
  for (const w of sorted) {
    if (w.batchId) {
      if (seenBatch.has(w.batchId)) continue;
      seenBatch.add(w.batchId);
      blocks.push({ kind: "batch", batchId: w.batchId, layers: sorted.filter((x) => x.batchId === w.batchId) });
    } else {
      blocks.push({ kind: "single", layer: w });
    }
  }

  return (
    <aside className="flex flex-col gap-4">
      {/* 요금 레이어 */}
      <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-card)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--rc-muted)]">{t("layers")}</h2>
          {yearOptions.length > 1 && (
            <select
              value={yearFilter === "all" ? "all" : String(yearFilter)}
              onChange={(e) => onYearFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              aria-label={t("yearFilter")}
              className="h-7 rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2 text-[11px] text-[var(--rc-text)]"
            >
              <option value="all">{t("allYears")}</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>

        {blocks.length === 0 && <p className="text-xs text-[var(--rc-faint)]">{t("noLayers")}</p>}

        {blocks.map((blk) =>
          blk.kind === "batch" ? (
            <div
              key={blk.batchId}
              className="mb-2 rounded-xl border border-dashed border-[var(--rc-border2)] bg-[var(--rc-surface2)]/40 p-2"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--rc-muted)]">
                  {t("batchGroup", { count: blk.layers.length })}
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteBatch(blk.batchId)}
                  className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-red-400 hover:bg-red-500/10"
                >
                  {t("cancelBatch")}
                </button>
              </div>
              {blk.layers.map((w) => (
                <LayerRow
                  key={w.id}
                  w={w}
                  axis={axis}
                  tr={tr}
                  t={t}
                  onEdit={onEditLayer}
                  onDelete={onDeleteLayer}
                  onClick={onLayerClick}
                  onEnter={onLayerEnter}
                  onLeave={onLayerLeave}
                />
              ))}
            </div>
          ) : (
            <LayerRow
              key={blk.layer.id}
              w={blk.layer}
              axis={axis}
              tr={tr}
              t={t}
              onEdit={onEditLayer}
              onDelete={onDeleteLayer}
              onClick={onLayerClick}
              onEnter={onLayerEnter}
              onLeave={onLayerLeave}
            />
          )
        )}

        {/* 기본요금 (연중) */}
        {base && (
          <div className="mt-1 flex items-start gap-2.5 rounded-xl border border-dashed border-[var(--rc-border2)] bg-[var(--rc-surface2)] p-2.5 opacity-90">
            <span className="w-1 self-stretch rounded" style={{ background: SEASON_VAR.LOW }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-[var(--rc-text)]">{t("baseLayer")}</div>
              <div className="mt-0.5 text-[11.5px] text-[var(--rc-muted)]">{t("baseWhy")}</div>
              <div className="mt-1 text-[13px] font-bold tabular-nums text-[var(--rc-text)]">
                {fmtFull(layerAxisValue(base, axis).base)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 선택한 날짜 승자 스택 */}
      <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-card)] p-4">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[var(--rc-muted)]">{t("stack")}</h2>
        {selected ? (
          <WinnerStack
            selected={selected}
            axis={axis}
            layers={layers}
            base={base}
            premiumDays={premiumDays}
            holidaySet={holidaySet}
            holidays={holidays}
            tr={tr}
            t={t}
          />
        ) : (
          <p className="text-xs text-[var(--rc-faint)]">{t("stackEmpty")}</p>
        )}
      </div>
    </aside>
  );
}

function LayerRow({
  w,
  axis,
  tr,
  t,
  onEdit,
  onDelete,
  onClick,
  onEnter,
  onLeave,
}: {
  w: WorkLayer;
  axis: Axis;
  tr: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
  onEnter: (id: string) => void;
  onLeave: () => void;
}) {
  const { base: baseV, premium: pmV } = layerAxisValue(w, axis);
  const nights = w.start && w.end ? nightsBetween(w.start, w.end) : 0;
  return (
    <div
      className="mb-2 flex items-start gap-2.5 rounded-xl border border-[var(--rc-border2)] bg-[var(--rc-surface2)] p-2.5 transition-colors hover:border-[var(--rc-accent)]"
      onMouseEnter={() => onEnter(w.id)}
      onMouseLeave={onLeave}
    >
      <span className="w-1 self-stretch rounded" style={{ background: SEASON_VAR[w.season] }} />
      <button type="button" onClick={() => onClick(w.id)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2 text-[13.5px] font-bold text-[var(--rc-text)]">
          <span className="truncate">{w.label || t("untitled")}</span>
          <SeasonBadge season={w.season} tr={tr} />
        </div>
        <div className="mt-0.5 text-[11.5px] tabular-nums text-[var(--rc-muted)]">
          {w.start && w.end ? `${fmtDate(w.start)} → ${fmtDate(w.end)} · ${t("nights", { n: nights })}` : ""}
        </div>
        <div className="mt-1 text-[13px] font-bold tabular-nums text-[var(--rc-text)]">
          {fmtFull(baseV)}
          {pmV != null && <span className="ml-1.5 text-[11px] font-semibold text-[var(--rc-shoulder)]">● {fmtFull(pmV)}</span>}
        </div>
      </button>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(w.id)}
          aria-label={t("editLayer")}
          className="rounded p-1 text-[var(--rc-faint)] hover:bg-[var(--rc-card)] hover:text-[var(--rc-text)]"
        >
          <span className="material-symbols-outlined text-[15px]">edit</span>
        </button>
        <button
          type="button"
          onClick={() => onDelete(w.id)}
          aria-label={t("deleteLayer")}
          className="rounded p-1 text-[var(--rc-faint)] hover:bg-[var(--rc-card)] hover:text-red-400"
        >
          <span className="material-symbols-outlined text-[15px]">close</span>
        </button>
      </div>
    </div>
  );
}

function WinnerStack({
  selected,
  axis,
  layers,
  base,
  premiumDays,
  holidaySet,
  holidays,
  tr,
  t,
}: {
  selected: string;
  axis: Axis;
  layers: WorkLayer[];
  base: WorkLayer | null;
  premiumDays: number[];
  holidaySet: Set<number>;
  holidays: { date: string; label: string }[];
  tr: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
}) {
  const date = toUtc(selected);
  const stack = stackForDate(date, layers, base);
  const winner = stack[0] ?? null;
  const holLabel = holidays.find((h) => h.date === selected)?.label ?? null;

  return (
    <div>
      <div className="mb-2.5 text-sm font-bold tabular-nums text-[var(--rc-text)]">
        {selected.replace(/-/g, ".")}
        {holLabel && <span className="ml-2 text-[13px] font-semibold text-amber-300">★ {holLabel}</span>}
      </div>
      {stack.length === 0 && <p className="text-xs text-[var(--rc-faint)]">{t("stackEmpty")}</p>}
      {stack.map((row, i) => {
        const isWin = i === 0;
        const { value, premium } = axisPrice(row, axis, date, premiumDays, holidaySet);
        const nights = row.start && row.end ? nightsBetween(row.start, row.end) : 0;
        const reason = !row.isBase ? premiumReason(date, premiumDays, holidaySet) : null;
        return (
          <div
            key={row.id}
            className={[
              "mb-1.5 flex items-center gap-2.5 rounded-xl border bg-[var(--rc-surface2)] p-2.5",
              isWin ? "border-[var(--rc-accent)] ring-1 ring-[var(--rc-accent)]/40" : "border-[var(--rc-border2)] opacity-50",
            ].join(" ")}
          >
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SEASON_VAR[row.season] }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-[var(--rc-text)]">
                {row.isBase ? t("baseLayer") : row.label || t("untitled")}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--rc-muted)]">
                {isWin
                  ? row.isBase
                    ? t("baseWhy")
                    : `${t("nights", { n: nights })} · ${tr(`seasons.${row.season}`)}`
                  : t("hiddenBy", { winner: winner?.isBase ? t("baseLayer") : winner?.label || t("untitled") })}
              </div>
              {isWin && premium && reason && (
                <div className="mt-1 text-[11px] font-semibold text-[var(--rc-shoulder)]">● {t("premiumApplied")}</div>
              )}
            </div>
            <span
              className={`whitespace-nowrap text-[13px] font-bold tabular-nums text-[var(--rc-text)] ${!isWin ? "line-through" : ""}`}
            >
              {fmtFull(value)}
            </span>
            {isWin && (
              <span className="whitespace-nowrap rounded bg-[var(--rc-accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {t("applied")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeasonBadge({ season, tr }: { season: Season; tr: ReturnType<typeof useTranslations> }) {
  return (
    <span
      className="whitespace-nowrap rounded px-1.5 py-0.5 text-[9.5px] font-black tracking-wide"
      style={{ background: SEASON_VAR[season], color: "#10151F" }}
    >
      {tr(`seasons.${season}`)}
    </span>
  );
}
