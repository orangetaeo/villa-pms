// 기간별 요금 캘린더 — 일괄 작업 순수 함수 층 (rate-calendar-ux)
//
// FE(캘린더 컴포넌트)·서버 라우트·단위 테스트가 공유하는 순수 로직만 둔다(Prisma·I/O 없음):
//   - segmentByWinner : range의 각 밤을 "현재 승자 행"(resolveRatePeriod)으로 판정해 연속 동일
//     승자끼리 구간화(half-open) → 일괄 조정(ADJUST)이 구간별 조정 레이어를 만드는 정본.
//   - adjustVnd/adjustKrw : 퍼센트 조정 + 화폐 단위 반올림(VND 1,000동·KRW 100원).
//   - shiftDateYears : 연도 복사(COPY_YEAR)의 같은 월·일 시프트(2/29→2/28 보정).
//   - generateBatchId : 일괄 작업 그룹 키(그룹 단위 취소용).
//
// 금액은 VND=BigInt·KRW=Int, float 연산 금지. 퍼센트만 Number로 받되(±소수2자리) 즉시
//   정수 스케일(만분율)로 환산해 BigInt/정수 산술로 적용한다(정밀도 주석 각 함수 참조).
import { randomBytes } from "node:crypto";
import { resolveRatePeriod, type RatePeriodLike } from "./pricing";

const MS_PER_DAY = 86_400_000;

/** 반개구간 [start, end) — @db.Date UTC 자정. */
export interface DateRange {
  start: Date;
  end: Date;
}

/** 한 구간(연속 동일 승자) — half-open. row는 그 구간 밤들의 승자 원본 행(추가 컬럼 보존). */
export interface WinnerSegment<T extends RatePeriodLike = RatePeriodLike> {
  start: Date;
  end: Date;
  row: T;
}

/**
 * range의 각 밤을 승자 행으로 판정(resolveRatePeriod)해 연속 동일 승자끼리 구간화.
 * 승자가 없으면(어떤 웃돈 기간도 안 덮음) base가 승자 → base 구간도 생성된다(원본 보존·조정 레이어 생성용).
 * 목업 정본 segmentsOver(interaction-spec.html)와 동일 알고리즘. base=null이면 resolveRatePeriod가 throw.
 * @param periods 그 range와 교차하는 non-base 행(추가 컬럼 포함 가능 — 제네릭 T로 보존).
 */
export function segmentByWinner<T extends RatePeriodLike>(
  range: DateRange,
  periods: T[],
  base: T | null
): WinnerSegment<T>[] {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const segs: WinnerSegment<T>[] = [];
  let cur: WinnerSegment<T> | null = null;
  for (let t = startMs; t < endMs; t += MS_PER_DAY) {
    const date = new Date(t);
    const row = resolveRatePeriod(date, periods, base);
    const nextDay = new Date(t + MS_PER_DAY);
    // 참조 동일성으로 같은 승자 판정 — resolveRatePeriod는 입력 행(또는 base) 참조를 그대로 반환.
    if (cur && cur.row === row) {
      cur.end = nextDay;
    } else {
      cur = { start: date, end: nextDay, row };
      segs.push(cur);
    }
  }
  return segs;
}

/**
 * 퍼센트(±소수2자리)를 만분율 팩터로: 1 + pct/100 = (10000 + round(pct*100)) / 10000.
 * pct는 사용자 입력(예 +10, -15, 12.5)이라 Number로 받되 즉시 정수화(소수3자리 이하 버림 반올림)해
 *   이후 산술은 BigInt/정수만 — float 누적 오차를 값에 반영하지 않는다.
 */
function pctFactorScaledE4(pct: number): bigint {
  if (!Number.isFinite(pct)) throw new RangeError(`잘못된 조정률: ${pct}`);
  const scaled = Math.round(pct * 100); // pct% → 만분율 델타(소수2자리까지 보존)
  const factor = 10_000 + scaled;
  if (factor < 0) throw new RangeError(`조정 후 음수 가격이 됩니다: ${pct}%`);
  return BigInt(factor);
}

/** BigInt를 unit 단위 최근접 반올림(half-up, 양수 전제 — 가격). */
function roundBigIntTo(v: bigint, unit: bigint): bigint {
  if (v < 0n) throw new RangeError("가격은 음수일 수 없습니다");
  const r = v % unit;
  const floor = v - r;
  return r * 2n >= unit ? floor + unit : floor;
}

/**
 * VND(BigInt)에 pct 적용 후 1,000동 단위 반올림. (v * (10000+Δ)) / 10000 → half-up → 1,000동 반올림.
 * 만분율 곱은 BigInt라 float 오차 없음. 목업 pushAdjustLayers의 `round(v*(1+pct/100)/1000)*1000`의 정밀판.
 */
export function adjustVnd(v: bigint, pct: number): bigint {
  const factor = pctFactorScaledE4(pct);
  const scaled = (v * factor + 5_000n) / 10_000n; // half-up ÷1e4
  return roundBigIntTo(scaled, 1_000n);
}

/**
 * KRW(Int)에 pct 적용 후 100원 단위 반올림. VND과 동형이나 KRW는 number(정수) — 만분율까지 BigInt로
 * 곱해 정수 반올림 후 100원 반올림. 결과는 안전정수 범위(수백만 원)라 Number 복원 안전.
 */
export function adjustKrw(v: number, pct: number): number {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`잘못된 KRW 금액: ${v}`);
  const factor = pctFactorScaledE4(pct);
  const scaled = (BigInt(v) * factor + 5_000n) / 10_000n; // half-up ÷1e4
  const rounded = roundBigIntTo(scaled, 100n);
  return Number(rounded);
}

/**
 * 같은 월·일로 연도 시프트 (COPY_YEAR). 2/29 → 대상 연도 비윤년이면 2/28 보정(목업 shiftDate와 동일).
 * @db.Date UTC 자정 유지. deltaYears는 dstYear-srcYear.
 */
export function shiftDateYears(date: Date, deltaYears: number): Date {
  const y = date.getUTCFullYear() + deltaYears;
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  let shifted = new Date(Date.UTC(y, m, d));
  if (shifted.getUTCMonth() !== m) {
    // 2/29 → 2/28 (해당 월 말일로 클램프)
    shifted = new Date(Date.UTC(y, m + 1, 0));
  }
  return shifted;
}

/**
 * 반개구간 [start, end)의 exclusive endDate 연도 시프트 (COPY_YEAR 윤년 경계 보존).
 * exclusive end를 shiftDateYears로 직접 시프트하면 2/29→2/28 클램프로 마지막 밤이 유실된다
 * (예: [2024-01-01, 2024-02-29) +1년 → end 2024-02-29를 직접 시프트 시 2025-02-28 = 58박, 1박 손실).
 * 대신 마지막 밤(end−1일)을 시프트한 뒤 +1일로 exclusive end를 복원 → 밤 수·마지막 밤 보존.
 * @db.Date UTC 자정 기준(UTC라 DST 없음 — MS_PER_DAY 가감이 안전).
 */
export function shiftEndDateYears(endExclusive: Date, deltaYears: number): Date {
  const lastNight = new Date(endExclusive.getTime() - MS_PER_DAY);
  const shiftedLast = shiftDateYears(lastNight, deltaYears);
  return new Date(shiftedLast.getTime() + MS_PER_DAY);
}

/** 일괄 작업 그룹 키 — 그룹 단위 취소·묶음 표시용. 스키마 default cuid()와 별개(외부 의존 없이 난수 생성). */
export function generateBatchId(): string {
  return `batch_${randomBytes(18).toString("base64url")}`;
}
