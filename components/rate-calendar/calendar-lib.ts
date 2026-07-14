// 기간별 요금 캘린더 — 순수 로직 층 (rate-calendar-ux)
//
// 승자 판정은 서버와 동일하게 lib/pricing.ts resolveRatePeriod를 그대로 재사용한다(단일 원천).
// segmentByWinner는 lib/rate-layers.ts의 구간화와 **동일 알고리즘**(같은 resolveRatePeriod 루프)이나,
//   rate-layers.ts는 generateBatchId가 node:crypto를 import하므로 클라 번들에 넣을 수 없어 여기서
//   동형 미러를 둔다(가격은 안 읽는 8줄 루프 — 판정 코어는 공유되므로 서버와 결과 동일).
import { resolveRatePeriod, type RatePeriodLike } from "@/lib/pricing";
import type { Axis, HolidayDTO, RateLayerDTO, Season, WorkLayer } from "./types";

const MS_PER_DAY = 86_400_000;

/* ───────── 날짜 유틸 (UTC, half-open [start,end)) ───────── */
export const toUtc = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * MS_PER_DAY);
export const nightsBetween = (start: Date, end: Date): number =>
  Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

/* ───────── DTO ↔ 작업 모델 ───────── */
export function toWorkLayer(dto: RateLayerDTO): WorkLayer {
  const big = (v: string | null): bigint | null => (v == null ? null : BigInt(v));
  return {
    id: dto.id,
    isBase: dto.isBase,
    season: dto.season,
    start: dto.startDate ? toUtc(dto.startDate) : null,
    end: dto.endDate ? toUtc(dto.endDate) : null,
    label: dto.label,
    batchId: dto.batchId,
    cost: BigInt(dto.costVnd),
    net: big(dto.netVnd),
    netKrw: dto.netKrw,
    consumer: big(dto.consumerVnd),
    consumerKrw: dto.consumerKrw,
    pCost: big(dto.premiumCostVnd),
    pNet: big(dto.premiumNetVnd),
    pNetKrw: dto.premiumNetKrw,
    pConsumer: big(dto.premiumConsumerVnd),
    pConsumerKrw: dto.premiumConsumerKrw,
    marginType: dto.marginType,
    marginValue: dto.marginValue,
    consumerMarginType: dto.consumerMarginType,
    consumerMarginValue: dto.consumerMarginValue,
  };
}

/** 승자 판정용 어댑터 — resolveRatePeriod는 season/isBase/날짜/id만 읽음(가격은 무의미). */
function toLike(w: WorkLayer): RatePeriodLike {
  return {
    id: w.id,
    season: w.season,
    isBase: w.isBase,
    startDate: w.start,
    endDate: w.end,
    supplierCostVnd: w.cost,
    salePriceVnd: w.net ?? w.cost,
    salePriceKrw: w.netKrw ?? 0,
  };
}

/** 그 날짜(밤)의 승자 + 가려진 행들(스택). 첫 원소가 승자, 나머지는 가려짐 순(짧은 기간·높은 시즌 우선). */
export function stackForDate(date: Date, periods: WorkLayer[], base: WorkLayer | null): WorkLayer[] {
  const cov = periods.filter(
    (p) => !p.isBase && p.start && p.end && p.start.getTime() <= date.getTime() && date.getTime() < p.end.getTime()
  );
  // pricing.ts periodBeats와 동일한 정렬(① 짧은 기간 ② 높은 시즌 ③ 늦은 시작 ④ 큰 id)
  const rank: Record<Season, number> = { LOW: 0, SHOULDER: 1, HIGH: 2, PEAK: 3 };
  cov.sort((a, b) => {
    const la = a.end!.getTime() - a.start!.getTime();
    const lb = b.end!.getTime() - b.start!.getTime();
    if (la !== lb) return la - lb;
    if (rank[a.season] !== rank[b.season]) return rank[b.season] - rank[a.season];
    const sa = a.start!.getTime();
    const sb = b.start!.getTime();
    if (sa !== sb) return sb - sa;
    return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
  });
  return base ? [...cov, base] : cov;
}

/** 그 날짜의 승자 1행 — resolveRatePeriod(서버 판정) 재사용. base 없으면 null. */
export function winnerForDate(date: Date, periods: WorkLayer[], base: WorkLayer | null): WorkLayer | null {
  if (!base && periods.every((p) => p.isBase)) return null;
  const likes = periods.filter((p) => !p.isBase).map(toLike);
  const baseLike = base ? toLike(base) : null;
  if (!baseLike && likes.length === 0) return null;
  // base가 없고 커버 기간도 없으면 resolveRatePeriod가 throw → 안전 폴백 null.
  let chosenId: string;
  try {
    chosenId = resolveRatePeriod(date, likes, baseLike).id ?? "";
  } catch {
    return null;
  }
  if (base && chosenId === base.id) return base;
  return periods.find((p) => p.id === chosenId) ?? base ?? null;
}

/* ───────── 프리미엄 판정 (ADR-0042 — pricing.ts와 동일 규칙) ───────── */
export function premiumReason(date: Date, premiumDays: number[], holidaySet: Set<number>): "HOLIDAY" | "WEEKDAY" | null {
  if (holidaySet.has(date.getTime())) return "HOLIDAY";
  if (premiumDays.includes(date.getUTCDay())) return "WEEKDAY";
  return null;
}

/** 그 행에 프리미엄 값이 하나라도 있는가 (없으면 프리미엄 요일이어도 평일과 동일). */
function hasAnyPremium(w: WorkLayer): boolean {
  return w.pCost != null || w.pNet != null || w.pNetKrw != null || w.pConsumer != null || w.pConsumerKrw != null;
}

/**
 * 축·날짜의 승자 표시가격 (프리미엄 컬럼 폴백 premiumX ?? X, ADR-0042). null이면 미설정(supplier에서 net/consumer).
 * @returns { value, premium } — premium=실제 웃돈 적용 여부(뱃지·● 표시용).
 */
export function axisPrice(
  w: WorkLayer,
  axis: Axis,
  date: Date,
  premiumDays: number[],
  holidaySet: Set<number>
): { value: bigint | null; premium: boolean } {
  const reason = premiumReason(date, premiumDays, holidaySet);
  const applyPremium = reason != null && !w.isBase && hasAnyPremium(w);
  if (axis === "cost") {
    const v = applyPremium ? w.pCost ?? w.cost : w.cost;
    return { value: v, premium: applyPremium && w.pCost != null };
  }
  if (axis === "net") {
    if (w.net == null) return { value: null, premium: false };
    const v = applyPremium ? w.pNet ?? w.net : w.net;
    return { value: v, premium: applyPremium && w.pNet != null };
  }
  // consumer = consumer ?? net (ADR-0031 폴백)
  if (w.net == null && w.consumer == null) return { value: null, premium: false };
  const baseC = w.consumer ?? w.net;
  const pC = w.pConsumer ?? w.pNet;
  const v = applyPremium ? pC ?? baseC : baseC;
  return { value: v, premium: applyPremium && pC != null };
}

/* ───────── 주(週) 밴드 lane-packing (interaction-spec.html 이식) ───────── */
export interface WeekBand {
  layerId: string;
  season: Season;
  label: string | null;
  /** 그리드 컬럼 시작(0~6) — 포함 */
  colStart: number;
  /** 그리드 컬럼 끝(1~7) — 제외 */
  colEnd: number;
  lane: number;
  contL: boolean; // 왼쪽으로 이어짐(이전 주에서 계속)
  contR: boolean; // 오른쪽으로 이어짐(다음 주로 계속)
}

/**
 * 한 주(weekStart부터 7일)에 걸친 웃돈 기간을 lane에 배치한다.
 * 정렬: 시작일 asc, 같으면 긴 기간 먼저 → greedy lane 할당(끝난 lane 재사용).
 * interaction-spec.html renderCalendar의 segs/lanes 알고리즘과 동일.
 */
export function packWeekBands(periods: WorkLayer[], weekStart: Date): WeekBand[] {
  const wStartMs = weekStart.getTime();
  const wEndMs = addDays(weekStart, 7).getTime();
  const segs = periods
    .filter((p) => !p.isBase && p.start && p.end && p.start.getTime() < wEndMs && p.end.getTime() > wStartMs)
    .sort((a, b) => {
      const sa = a.start!.getTime();
      const sb = b.start!.getTime();
      if (sa !== sb) return sa - sb;
      // 같은 시작 → 긴 기간 먼저
      return b.end!.getTime() - b.start!.getTime() - (a.end!.getTime() - a.start!.getTime());
    })
    .map((p) => {
      const fromMs = Math.max(p.start!.getTime(), wStartMs);
      const toMs = Math.min(p.end!.getTime(), wEndMs);
      return {
        p,
        colStart: Math.round((fromMs - wStartMs) / MS_PER_DAY),
        colEnd: Math.round((toMs - wStartMs) / MS_PER_DAY),
        contL: p.start!.getTime() < wStartMs,
        contR: p.end!.getTime() > wEndMs,
      };
    });

  const laneEnds: number[] = []; // 각 lane의 마지막 colEnd
  const bands: WeekBand[] = [];
  for (const s of segs) {
    let lane = laneEnds.findIndex((end) => end <= s.colStart);
    if (lane === -1) {
      laneEnds.push(s.colEnd);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = s.colEnd;
    }
    bands.push({
      layerId: s.p.id,
      season: s.p.season,
      label: s.p.label,
      colStart: s.colStart,
      colEnd: s.colEnd,
      lane,
      contL: s.contL,
      contR: s.contR,
    });
  }
  return bands;
}

/* ───────── 레이어 패널 정렬 + 연도 그룹 ───────── */
/** 패널 목록 정렬 — 짧은 기간·높은 시즌·늦은 시작 우선(승자 규칙과 동일 방향, 표시용). base 제외. */
export function sortLayersForPanel(periods: WorkLayer[]): WorkLayer[] {
  const rank: Record<Season, number> = { LOW: 0, SHOULDER: 1, HIGH: 2, PEAK: 3 };
  return [...periods]
    .filter((p) => !p.isBase && p.start && p.end)
    .sort((a, b) => {
      const la = a.end!.getTime() - a.start!.getTime();
      const lb = b.end!.getTime() - b.start!.getTime();
      if (la !== lb) return la - lb;
      if (rank[a.season] !== rank[b.season]) return rank[b.season] - rank[a.season];
      return b.start!.getTime() - a.start!.getTime();
    });
}

/** 레이어가 걸친 연도들(시작~종료-1박). half-open이라 종료 전날까지. */
export function layerYears(w: WorkLayer): number[] {
  if (!w.start || !w.end) return [];
  const startY = w.start.getUTCFullYear();
  const lastNight = addDays(w.end, -1);
  const endY = lastNight.getUTCFullYear();
  const ys: number[] = [];
  for (let y = startY; y <= endY; y++) ys.push(y);
  return ys;
}

/**
 * 클라 미리보기용 구간 수 — 일괄 조정/선택%가 만들 조정 레이어 개수(서버 segmentByWinner와 동형).
 * lib/rate-layers.ts segmentByWinner와 같은 resolveRatePeriod 루프(가격 미사용).
 */
export function segmentCount(range: { start: Date; end: Date }, periods: WorkLayer[], base: WorkLayer | null): number {
  let count = 0;
  let curId: string | null = null;
  for (let t = range.start.getTime(); t < range.end.getTime(); t += MS_PER_DAY) {
    const w = winnerForDate(new Date(t), periods, base);
    const id = w?.id ?? "__none__";
    if (id !== curId) {
      count++;
      curId = id;
    }
  }
  return count;
}

/** 공휴일 배열 → getTime() Set (프리미엄 판정용). */
export function holidayTimeSet(holidays: HolidayDTO[]): Set<number> {
  return new Set(holidays.map((h) => toUtc(h.date).getTime()));
}

/** 공휴일 라벨 맵(YYYY-MM-DD → label). */
export function holidayLabelMap(holidays: HolidayDTO[]): Map<string, string> {
  return new Map(holidays.map((h) => [h.date, h.label]));
}
