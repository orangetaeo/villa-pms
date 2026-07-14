"use client";

// 월 그리드 — 시즌색 셀 + 밤별 승자가 + 프리미엄 ●/공휴일 ★ + 주 하단 겹침 밴드 (rate-calendar-ux)
// interaction-spec.html renderCalendar 이식. 승자·가격·lane-packing은 calendar-lib 순수 함수 재사용.
import { useTranslations } from "next-intl";
import type { Axis, Season, WorkLayer } from "./types";
import { SEASON_VAR } from "./types";
import { addDays, axisPrice, holidayLabelMap, iso, packWeekBands, premiumReason, winnerForDate } from "./calendar-lib";

/** 셀 가격 축약 표기 — "7M" / "10.5M". 표시 전용(승자 판정과 무관). */
function abbr(v: bigint | null): string {
  if (v == null) return "—";
  const m = Number(v) / 1_000_000;
  return `${m.toFixed(1).replace(/\.0$/, "")}M`;
}

const rangeContains = (start: string | null, end: string | null, ds: string): boolean => {
  if (!start) return false;
  if (start && !end) return ds === start;
  return start <= ds && ds < end!;
};

export default function CalendarGrid({
  year,
  month, // 0-based
  layers,
  base,
  axis,
  premiumDays,
  holidaySet,
  holidays,
  selected,
  pickedDays,
  pickRangeStart,
  pickRangeEnd,
  hlLayerId,
  onPrev,
  onNext,
  onCellTap,
  onBandEnter,
  onBandLeave,
  onBandClick,
}: {
  year: number;
  month: number;
  layers: WorkLayer[];
  base: WorkLayer | null;
  axis: Axis;
  premiumDays: number[];
  holidaySet: Set<number>;
  holidays: { date: string; label: string }[];
  selected: string | null;
  pickedDays: Set<string>;
  pickRangeStart: string | null;
  pickRangeEnd: string | null;
  hlLayerId: string | null;
  onPrev: () => void;
  onNext: () => void;
  onCellTap: (ds: string) => void;
  onBandEnter: (layerId: string) => void;
  onBandLeave: () => void;
  onBandClick: (layerId: string) => void;
}) {
  const t = useTranslations("rateCalendar");
  const holLabels = holidayLabelMap(holidays);

  const dows = [t("dow.sun"), t("dow.mon"), t("dow.tue"), t("dow.wed"), t("dow.thu"), t("dow.fri"), t("dow.sat")];

  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const gridStart = addDays(first, -first.getUTCDay());
  const weekCount = Math.ceil((first.getUTCDay() + daysInMonth) / 7);

  return (
    <section className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-card)] p-4 pb-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          <NavBtn label={t("prevMonth")} onClick={onPrev}>
            ‹
          </NavBtn>
          <NavBtn label={t("nextMonth")} onClick={onNext}>
            ›
          </NavBtn>
        </div>
        <div className="text-base font-bold tracking-tight tabular-nums text-[var(--rc-text)]">
          {t("month", { year, month: month + 1 })}
        </div>
      </div>

      <div className="mb-1.5 grid grid-cols-7">
        {dows.map((d, i) => (
          <div
            key={i}
            className={`py-1 text-center text-[11px] tracking-wider ${
              i === 0 ? "text-red-300" : i === 6 ? "text-blue-300" : "text-[var(--rc-faint)]"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {Array.from({ length: weekCount }, (_, w) => {
        const weekStart = addDays(gridStart, w * 7);
        const bands = packWeekBands(layers, weekStart);
        const laneCount = bands.reduce((m, b) => Math.max(m, b.lane + 1), 0);
        return (
          <div key={w} className="mb-1">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(weekStart, i);
                const ds = iso(d);
                const out = d.getUTCMonth() !== month;
                const win = winnerForDate(d, layers, base);
                const season: Season = win?.season ?? "LOW";
                const tint = SEASON_VAR[season];
                const { value, premium } = win
                  ? axisPrice(win, axis, d, premiumDays, holidaySet)
                  : { value: null, premium: false };
                const isBaseWin = !win || win.isBase;
                const hol = holLabels.has(ds);
                const isSel = ds === selected;
                const isPicked = pickedDays.has(ds);
                const inRange = rangeContains(pickRangeStart, pickRangeEnd, ds);
                const isHl = !!hlLayerId && win != null && layerCovers(layers, hlLayerId, d);
                const reason = win && !win.isBase ? premiumReason(d, premiumDays, holidaySet) : null;
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => onCellTap(ds)}
                    className={[
                      "relative flex min-h-[62px] flex-col justify-between rounded-lg border px-2 pb-1 pt-1.5 text-left transition-colors",
                      "hover:border-[var(--rc-accent)]",
                      out ? "pointer-events-none opacity-30" : "",
                      isSel ? "border-[var(--rc-accent)] ring-2 ring-[var(--rc-accent)]" : "border-transparent",
                      isPicked || inRange ? "ring-2 ring-[var(--rc-accent)] ring-inset" : "",
                      isHl ? "ring-2 ring-[var(--rc-text)] ring-inset" : "",
                    ].join(" ")}
                    style={{
                      background: `color-mix(in srgb, ${tint} ${isBaseWin ? 7 : 16}%, var(--rc-surface2))`,
                    }}
                    aria-label={ds}
                  >
                    <span className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${isSel ? "font-bold text-white" : "text-[var(--rc-muted)]"}`}>
                        {d.getUTCDate()}
                      </span>
                      {hol ? (
                        <span className="text-[10px] leading-none text-amber-300" aria-hidden>
                          ★
                        </span>
                      ) : premium && reason === "WEEKDAY" ? (
                        <span className="text-[10px] leading-none text-[var(--rc-shoulder)]" aria-hidden>
                          ●
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="whitespace-nowrap text-[12.5px] font-bold tracking-tight tabular-nums"
                      style={{ color: isBaseWin ? "var(--rc-text)" : tint }}
                    >
                      {out ? "" : abbr(value)}
                    </span>
                  </button>
                );
              })}
            </div>
            {laneCount > 0 && (
              <div
                className="mt-1 grid grid-cols-7 gap-x-1 gap-y-[3px]"
                style={{ gridTemplateRows: `repeat(${laneCount}, 17px)` }}
              >
                {bands.map((b) => (
                  <button
                    type="button"
                    key={b.layerId}
                    onMouseEnter={() => onBandEnter(b.layerId)}
                    onMouseLeave={onBandLeave}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBandClick(b.layerId);
                    }}
                    title={b.label ?? ""}
                    className={[
                      "h-[17px] overflow-hidden text-ellipsis whitespace-nowrap px-2 text-left text-[10px] font-bold leading-[17px]",
                      "rounded",
                      b.contL ? "rounded-l-none" : "",
                      b.contR ? "rounded-r-none" : "",
                      hlLayerId === b.layerId ? "outline outline-2 outline-[var(--rc-text)]" : "",
                    ].join(" ")}
                    style={{
                      gridColumn: `${b.colStart + 1} / ${b.colEnd + 1}`,
                      gridRow: b.lane + 1,
                      background: SEASON_VAR[b.season],
                      color: "#10151F",
                    }}
                  >
                    {b.contL ? "" : b.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="mt-4 border-t border-[var(--rc-border)] pt-3 text-[11.5px] leading-relaxed text-[var(--rc-faint)]">
        {t("foot")}
      </p>
    </section>
  );
}

/** hlLayerId 레이어가 이 날짜를 덮는가(하이라이트용). */
function layerCovers(layers: WorkLayer[], layerId: string, d: Date): boolean {
  const w = layers.find((p) => p.id === layerId);
  if (!w || !w.start || !w.end) return false;
  const t = d.getTime();
  return w.start.getTime() <= t && t < w.end.getTime();
}

function NavBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-[30px] w-[30px] rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] text-sm leading-none text-[var(--rc-text)] hover:border-[var(--rc-accent)]"
    >
      {children}
    </button>
  );
}
