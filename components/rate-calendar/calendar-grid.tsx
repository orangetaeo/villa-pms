"use client";

// 월 그리드 — 시즌색 셀 + 밤별 승자가 + 프리미엄 ●/공휴일 ★ + 주 하단 겹침 밴드 (rate-calendar-ux)
// interaction-spec.html renderCalendar 이식. 승자·가격·lane-packing은 calendar-lib 순수 함수 재사용.
import { memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { PremiumReason } from "@/lib/pricing";
import type { Axis, Season, WorkLayer } from "./types";
import { SEASON_VAR } from "./types";
import { addDays, axisPrice, holidayLabelMap, iso, packWeekBands, premiumReason, winnerForDate, type WeekBand } from "./calendar-lib";

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

/** 메모이즈된 셀 데이터 — 승자·표시가격·프리미엄 마커까지(상호작용 상태 제외). hover·선택에도 재계산 없음. */
interface CellData {
  d: Date;
  ds: string;
  timeMs: number;
  dateNum: number;
  out: boolean;
  winId: string | null;
  season: Season;
  value: bigint | null;
  premium: boolean;
  isBaseWin: boolean;
  hol: boolean;
  reason: PremiumReason | null;
}
interface WeekData {
  bands: WeekBand[];
  laneCount: number;
  cells: CellData[];
}

function CalendarGrid({
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

  const dows = [t("dow.sun"), t("dow.mon"), t("dow.tue"), t("dow.wed"), t("dow.thu"), t("dow.fri"), t("dow.sat")];

  // 셀 승자·주 밴드·공휴일 라벨을 한 번에 계산(월/요율/프리미엄/공휴일/축 의존). 선택·hover 상태는 미포함 →
  // hlLayerId·selected 변경 시 이 무거운 루프(winnerForDate·packWeekBands)를 재실행하지 않는다(성능 P3).
  const weeks = useMemo<WeekData[]>(() => {
    const holLabels = holidayLabelMap(holidays);
    const first = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const gridStart = addDays(first, -first.getUTCDay());
    const weekCount = Math.ceil((first.getUTCDay() + daysInMonth) / 7);
    const out: WeekData[] = [];
    for (let w = 0; w < weekCount; w++) {
      const weekStart = addDays(gridStart, w * 7);
      const bands = packWeekBands(layers, weekStart);
      const laneCount = bands.reduce((m, b) => Math.max(m, b.lane + 1), 0);
      const cells: CellData[] = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const ds = iso(d);
        const win = winnerForDate(d, layers, base);
        const season: Season = win?.season ?? "LOW";
        const { value, premium } = win
          ? axisPrice(win, axis, d, premiumDays, holidaySet)
          : { value: null, premium: false };
        return {
          d,
          ds,
          timeMs: d.getTime(),
          dateNum: d.getUTCDate(),
          out: d.getUTCMonth() !== month,
          winId: win?.id ?? null,
          season,
          value,
          premium,
          isBaseWin: !win || win.isBase,
          hol: holLabels.has(ds),
          reason: win && !win.isBase ? premiumReason(d, premiumDays, holidaySet) : null,
        };
      });
      out.push({ bands, laneCount, cells });
    }
    return out;
  }, [layers, base, axis, premiumDays, holidaySet, holidays, year, month]);

  // hover 하이라이트: 강조 레이어의 구간만 미리 뽑아 셀별 범위 비교(클래스만) — 승자 재계산 없음.
  const hlLayer = hlLayerId ? layers.find((l) => l.id === hlLayerId) ?? null : null;
  const hlStart = hlLayer?.start?.getTime() ?? null;
  const hlEnd = hlLayer?.end?.getTime() ?? null;

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

      {weeks.map((week, w) => {
        const { bands, laneCount } = week;
        return (
          <div key={w} className="mb-1">
            <div className="grid grid-cols-7 gap-1">
              {week.cells.map((cell, i) => {
                const { ds, out, season, value, premium, isBaseWin, hol, reason } = cell;
                const tint = SEASON_VAR[season];
                const isSel = ds === selected;
                const isPicked = pickedDays.has(ds);
                const inRange = rangeContains(pickRangeStart, pickRangeEnd, ds);
                const isHl =
                  cell.winId != null &&
                  hlStart != null &&
                  hlEnd != null &&
                  hlStart <= cell.timeMs &&
                  cell.timeMs < hlEnd;
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
                        {cell.dateNum}
                      </span>
                      {hol ? (
                        <span className="text-[10px] leading-none text-amber-300" aria-hidden>
                          ★
                        </span>
                      ) : premium && reason === "WEEKDAY_RULE" ? (
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

// React.memo — 부모(RateCalendar) 재렌더 시 props 동일하면 스킵. 내부 useMemo와 함께 hover/선택 시 무거운
// 승자·밴드 계산을 피한다(성능 P3, 동작 불변).
export default memo(CalendarGrid);

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
