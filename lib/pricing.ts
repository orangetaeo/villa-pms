import { BookingChannel, Currency, MarginType, SeasonType } from "@prisma/client";
import { assertValidStayRange, type DbClient, type StayRange } from "./availability";

/**
 * 가격 계산 단일 소스 (SPEC F3, ADR-0003)
 *
 * - 총액 = 박별 합산: 각 숙박일이 속한 시즌(SeasonPeriod)의 판매 통화 요율을 1박씩 더한다
 *   — 시즌 경계에 걸친 예약은 박마다 다른 요율 적용
 * - SeasonPeriod 미등록 날짜는 LOW(비수기) 요율
 * - 가격 산정 기준통화 = VND. KRW는 Int(number), VND는 BigInt — float 연산 절대 금지
 * - 제안·HOLD는 이 모듈의 산출값을 스냅샷으로 저장 (이후 요율·환율 변경 무영향)
 * - 판매 통화는 KRW·VND만 지원 — USD 등은 명시 거부 (Currency enum에 있어도 판매 통화 아님)
 * 화면·API에서 중복 구현 금지. HOLD 스냅샷(T2.3)은 $transaction 클라이언트를 주입해 호출.
 *
 * ⚠️ 원가 누수 주의 (사업 원칙 2 — 마진 비공개): StayQuote는 supplierCostVnd·
 * nightly[].costVnd(공급자 원가)를 항상 포함한다. ADMIN 외 응답(/p/[token],
 * SUPPLIER API)에 StayQuote를 그대로 직렬화하지 말 것 — 판매가 필드만 추려 매핑.
 */

const MS_PER_DAY = 86_400_000;

/** 시즌 겹침 시 우선순위 — 극성수기 > 성수기 > 준성수기 > 비수기 */
const SEASON_PRECEDENCE: Record<SeasonType, number> = {
  [SeasonType.PEAK]: 3,
  [SeasonType.HIGH]: 2,
  [SeasonType.SHOULDER]: 1,
  [SeasonType.LOW]: 0,
};

/**
 * 요율 미설정으로 견적 불가 (구 VillaRate 시즌 기반). ADR-0014 Phase B에서 견적 경로가
 * VillaRatePeriod 단일 경로가 된 뒤로는 MissingBaseRateError(하위 클래스)가 실제로 throw되지만,
 * 기존 소비처(lib/proposal.ts·proposals/candidates)가 이 타입으로 catch하므로 베이스 타입으로 유지.
 */
export class MissingRateError extends Error {
  constructor(public readonly season: SeasonType) {
    super(`시즌 ${season}의 요율이 설정되지 않았습니다`);
    this.name = "MissingRateError";
  }
}

/**
 * 판매 통화 게이트 — SPEC F3: 판매 통화는 KRW(직접 소비자)·VND(여행사·랜드사).
 * Phase 2: USD(외국인 직접·달러 결제) 추가 — 요율표 단가가 없어 자동견적은 불가하지만
 * 통화 자체는 허용(ADMIN이 제안 생성 시 빌라별 USD 총액을 수동 입력).
 */
function assertSupportedSaleCurrency(saleCurrency: Currency): void {
  if (
    saleCurrency !== Currency.KRW &&
    saleCurrency !== Currency.VND &&
    saleCurrency !== Currency.USD
  ) {
    throw new RangeError(`지원하지 않는 판매 통화: ${saleCurrency} (KRW·VND·USD만 가능)`);
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/**
 * 프리미엄 박 사유 (ADR-0042) — 왜 이 박이 프리미엄인지. 박별 뱃지·검증용.
 * WEEKDAY_RULE = getUTCDay(박) ∈ Villa.premiumDays / HOLIDAY = 박 ∈ HolidayDate.
 * 둘 다 해당하면 HOLIDAY로 결정(공휴일 우선 — 결정적).
 */
export type PremiumReason = "WEEKDAY_RULE" | "HOLIDAY";

export interface NightQuote {
  /** 숙박일 (그 날 밤) — UTC 자정 */
  date: Date;
  season: SeasonType;
  /** saleCurrency=KRW일 때만 채움 */
  saleKrw?: number;
  /** saleCurrency=VND일 때만 채움 */
  saleVnd?: bigint;
  costVnd: bigint;
  /** ADR-0042 — 프리미엄 박이면 사유. 평일 박이면 미포함(undefined) */
  premium?: PremiumReason;
}

export interface StayQuote {
  nights: number;
  saleCurrency: Currency;
  nightly: NightQuote[];
  /** saleCurrency=KRW일 때만 — Int(원) */
  totalSaleKrw?: number;
  /** saleCurrency=VND일 때만 — BigInt(동) */
  totalSaleVnd?: bigint;
  /** 공급자 원가 박별 합산 — 통화 무관 항상 VND */
  totalSupplierCostVnd: bigint;
}

// ===================== 기간별 요금 (ADR-0014) — 순수 함수 층 =====================

/** 빌라 생성/수정 입력의 시즌별 원가 (LOW/HIGH/PEAK 필수, SHOULDER 선택, 동 단위 BigInt). */
export interface SeasonCostsVnd {
  LOW: bigint;
  HIGH: bigint;
  PEAK: bigint;
  /** 준성수기 — 선택(구 payload 하위호환). 미포함 시 전역 SHOULDER 기간이 있어도 그 기간 스킵. */
  SHOULDER?: bigint;
}

/** VillaRatePeriod 생성용 행 (Prisma create 입력 호환 — villaId는 호출자가 부여) */
export interface RatePeriodCreateRow {
  season: SeasonType;
  isBase: boolean;
  startDate: Date | null;
  endDate: Date | null;
  label: string | null;
  supplierCostVnd: bigint;
  marginType: MarginType;
  marginValue: bigint;
  salePriceVnd: bigint;
  salePriceKrw: number;
}

/** 전역 SeasonPeriod(또는 그 비-LOW 부분집합) — 생성 시 HIGH/PEAK 기간 날짜 템플릿 */
export interface SeasonWindow {
  season: SeasonType;
  startDate: Date;
  endDate: Date;
  label: string | null;
}

/**
 * 빌라 생성/수정 입력의 시즌별 원가(LOW/HIGH/PEAK)를 VillaRatePeriod 행으로 변환 (ADR-0014 Phase B).
 *
 * 구 모델은 빌라가 LOW/HIGH/PEAK 원가(날짜 없음)를 갖고 전역 SeasonPeriod가 날짜를 제공했다.
 * 신규 모델은 기본요금(base, LOW 배경) 1행 + 날짜 있는 웃돈 기간 N행. 이 함수가 그 사상을 담당:
 * - base = LOW 원가 (isBase, 날짜 null·배경). 마진·판매가는 placeholder(운영자 승인 화면서 책정) —
 *   구 `villaRate.createMany` 생성 시맨틱(margin PERCENT 0, sale=cost, krw 0) 그대로 보존.
 * - 기간 = 전역 SeasonPeriod의 비-LOW(HIGH/PEAK) 각각을, 그 시즌의 입력 원가로 스냅샷.
 *   전역 LOW(예: 6개월 배경)는 base가 담당하므로 복제하지 않음 — 겹침 회피 + 구 resolveSeason(precedence)과
 *   결과 동일. (scripts/migrate-rate-periods.ts의 전역폴백 변환 규칙과 동일.)
 *
 * 전역 비-LOW 시즌이 없으면 base만 생성(HIGH/PEAK 원가는 날짜 출처가 없어 미반영 — 운영자가 편집기로 기간 추가).
 */
export function buildRatePeriodRowsFromSeasonCosts(
  costs: SeasonCostsVnd,
  globalSeasons: SeasonWindow[]
): { base: RatePeriodCreateRow; periods: RatePeriodCreateRow[] } {
  const row = (
    season: SeasonType,
    cost: bigint,
    isBase: boolean,
    startDate: Date | null,
    endDate: Date | null,
    label: string | null
  ): RatePeriodCreateRow => ({
    season,
    isBase,
    startDate,
    endDate,
    label,
    supplierCostVnd: cost,
    marginType: MarginType.PERCENT,
    marginValue: 0n,
    salePriceVnd: cost,
    salePriceKrw: 0,
  });
  const base = row(SeasonType.LOW, costs.LOW, true, null, null, null);
  const periods = globalSeasons
    .filter((s) => s.season !== SeasonType.LOW)
    // 해당 시즌 원가가 입력에 없으면(예: SHOULDER 미전송인 구 payload) 그 전역 기간은 스킵 — 방어.
    .flatMap((s) => {
      const cost = costs[s.season as keyof SeasonCostsVnd];
      if (cost == null) return [];
      return [row(s.season, cost, false, s.startDate, s.endDate, s.label)];
    });
  return { base, periods };
}

/**
 * 시즌별 "대표" 요금 행 추출 (ADR-0014 Phase B) — 구 VillaRate(시즌 키) 표시/원가경보를 신규 경로로 대체.
 * 한 빌라의 VillaRatePeriod 행들에서 시즌별 대표값을 만든다:
 *   - LOW  = base(기본요금) 행.
 *   - HIGH/PEAK = 그 시즌의 (비-base) 첫 기간. **해당 시즌 기간이 없으면 키 자체를 비운다(미포함).**
 * ⚠️ 디버깅 수정(2026-06-24): 과거엔 HIGH/PEAK 기간이 없으면 base(LOW)로 폴백했는데,
 *    그 결과 화면이 비수기 원가를 "성수기" 라벨로 오표시하고 cost-alerts가 HIGH/PEAK 원가변경
 *    마진을 base(LOW) 판매가로 오산했다. 이제 실제 그 시즌 기간이 있을 때만 반환 → 소비처는
 *    없는 시즌을 그냥 표시 생략(정확). 여러 기간이 같은 시즌이면 첫 기간만 대표(표시·경보용 단순화).
 * 표시·경보용(견적 아님 — 견적은 quoteStayForVilla). T는 호출자 select 필드(누수 책임은 호출자).
 */
export function representativeRatesBySeason<
  T extends { season: SeasonType; isBase: boolean }
>(ratePeriods: T[]): Partial<Record<SeasonType, T>> {
  const base = ratePeriods.find((r) => r.isBase) ?? null;
  const out: Partial<Record<SeasonType, T>> = {};
  if (base) out.LOW = base;
  for (const season of [SeasonType.SHOULDER, SeasonType.HIGH, SeasonType.PEAK]) {
    const period = ratePeriods.find((r) => !r.isBase && r.season === season);
    if (period) out[season] = period; // base 폴백 제거 — 없으면 미포함
  }
  return out;
}

/**
 * 가격 계층 (ADR-0031) — 채널별로 다른 판매가 컬럼을 고른다.
 * - NET: 여행사·랜드사 도매가 (salePrice*)
 * - CONSUMER: 직접 소비자가 (consumerSalePrice* ?? salePrice* 폴백)
 */
export type PriceTier = "NET" | "CONSUMER";

/** 채널 → 가격 계층 (ADR-0031). DIRECT=소비자, 그 외=Net */
export function priceTierForChannel(channel: BookingChannel): PriceTier {
  return channel === BookingChannel.DIRECT ? "CONSUMER" : "NET";
}

/** 기간별 요금 행 (ADR-0014) — 날짜 범위 + 가격을 한 행에. base는 startDate/endDate null. */
export interface RatePeriodLike {
  /**
   * 행 id (cuid). 겹침 승자 4단계 tie-break의 최종 기준(④ 큰 id = 최신 행 근사).
   * 미포함이면 tie-break ④는 스킵(빈 문자열 비교) — 완전 동일 범위·시즌 중복행에서만 의미.
   */
  id?: string;
  season: SeasonType;
  isBase: boolean;
  /** isBase=false일 때만 채움. 포함 — @db.Date UTC 자정 */
  startDate: Date | null;
  /** isBase=false일 때만. 제외 — [start,end) half-open */
  endDate: Date | null;
  supplierCostVnd: bigint;
  salePriceVnd: bigint;
  salePriceKrw: number;
  // ADR-0031 소비자 직판가 — null/미포함이면 Net(salePrice*) 폴백. CONSUMER 계층에서만 참조.
  consumerSalePriceVnd?: bigint | null;
  consumerSalePriceKrw?: number | null;
  // ADR-0042 프리미엄일 컬럼 — 프리미엄 박에서만 참조. 각 컬럼 null/미포함이면 같은 행의 평일 컬럼으로
  //   컬럼 단위 폴백(resolvePremiumRow). 그 유효 행 위에서 기존 계층 로직(ADR-0031)을 그대로 적용한다.
  premiumSupplierCostVnd?: bigint | null;
  premiumSalePriceVnd?: bigint | null;
  premiumSalePriceKrw?: number | null;
  premiumConsumerSalePriceVnd?: bigint | null;
  premiumConsumerSalePriceKrw?: number | null;
}

/**
 * 프리미엄 박 판정 (ADR-0042) — 요일(premiumDays) ∨ 공휴일(holidaySet). 둘 다면 HOLIDAY 우선(결정적).
 * 평일이면 null. 요일은 반드시 getUTCDay(숙박일 @db.Date UTC 자정 — 로컬 타임존 오염 금지).
 */
function premiumReasonFor(
  date: Date,
  premiumDaySet: ReadonlySet<number> | null,
  holidaySet: ReadonlySet<number> | null
): PremiumReason | null {
  if (holidaySet && holidaySet.has(date.getTime())) return "HOLIDAY";
  if (premiumDaySet && premiumDaySet.has(date.getUTCDay())) return "WEEKDAY_RULE";
  return null;
}

/**
 * 프리미엄 박의 "유효 행" (ADR-0042) — 각 가격 컬럼을 `premiumX ?? X`로 컬럼 단위 해소한 RatePeriodLike.
 * 이 유효 행 위에서 기존 계층 로직(nightSaleVnd/Krw: CONSUMER=consumer??Net)을 그대로 적용하므로
 * 프리미엄(컬럼 오버라이드)과 계층(기존 규칙)의 축 우선순위를 새로 발명하지 않는다.
 */
function resolvePremiumRow(rate: RatePeriodLike): RatePeriodLike {
  return {
    ...rate,
    supplierCostVnd: rate.premiumSupplierCostVnd ?? rate.supplierCostVnd,
    salePriceVnd: rate.premiumSalePriceVnd ?? rate.salePriceVnd,
    salePriceKrw: rate.premiumSalePriceKrw ?? rate.salePriceKrw,
    consumerSalePriceVnd: rate.premiumConsumerSalePriceVnd ?? rate.consumerSalePriceVnd,
    consumerSalePriceKrw: rate.premiumConsumerSalePriceKrw ?? rate.consumerSalePriceKrw,
  };
}

/**
 * 이 요금 행에 프리미엄 값이 하나라도 설정돼 있는가 (ADR-0042, QA P2).
 * 전부 null이면 프리미엄 요일/공휴일이어도 실제 적용될 웃돈이 없다 → 평일과 완전 동일(금액·뱃지).
 * premiumDays default '{5,6}'로 백필된 미설정 빌라가 주말 뱃지를 소급 노출하는 것을 차단
 * (계약 기준 2 "기존 빌라 견적 결과 완전 불변"을 표시층까지 보장). 원가 컬럼 포함.
 */
function hasAnyPremiumValue(rate: RatePeriodLike): boolean {
  return (
    rate.premiumSupplierCostVnd != null ||
    rate.premiumSalePriceVnd != null ||
    rate.premiumSalePriceKrw != null ||
    rate.premiumConsumerSalePriceVnd != null ||
    rate.premiumConsumerSalePriceKrw != null
  );
}

/** 한 요금 행에서 계층에 맞는 박당 VND 판매가 (ADR-0031). CONSUMER는 null이면 Net 폴백. */
function nightSaleVnd(rate: RatePeriodLike, tier: PriceTier): bigint {
  return tier === "CONSUMER"
    ? (rate.consumerSalePriceVnd ?? rate.salePriceVnd)
    : rate.salePriceVnd;
}

/** 한 요금 행에서 계층에 맞는 박당 KRW 판매가 (ADR-0031). CONSUMER는 null이면 Net 폴백. */
function nightSaleKrw(rate: RatePeriodLike, tier: PriceTier): number {
  return tier === "CONSUMER"
    ? (rate.consumerSalePriceKrw ?? rate.salePriceKrw)
    : rate.salePriceKrw;
}

/**
 * 기본요금(base) 부재로 견적 불가 — 기간별 경로 빌라는 base가 필수.
 * MissingRateError를 상속한다(ADR-0014 Phase B): 기존 소비처(lib/proposal.ts·
 * proposals/candidates)가 `instanceof MissingRateError`로 "요율 미설정 빌라 제외"를
 * 처리하므로, 단일 경로 전환 후에도 그 catch가 그대로 동작하도록 호환 유지.
 */
export class MissingBaseRateError extends MissingRateError {
  constructor() {
    super(SeasonType.LOW);
    this.message = "기간별 요금 빌라에 기본요금(isBase) 행이 없습니다";
    this.name = "MissingBaseRateError";
  }
}

/** 기간 길이(ms) — @db.Date 자정이라 박 수와 단조 동치(더 짧은 기간 판정용). base(날짜 null)엔 미사용. */
function periodLengthMs(p: RatePeriodLike): number {
  return (p.endDate?.getTime() ?? 0) - (p.startDate?.getTime() ?? 0);
}

/**
 * 겹침 승자 규칙 (rate-calendar-ux) — 후보 p가 현재 best를 이기는가.
 * ① 짧은 기간(박 수 asc) → ② SEASON_PRECEDENCE 높은 쪽(PEAK>HIGH>SHOULDER>LOW) →
 * ③ startDate 늦은 쪽 → ④ id 사전순 큰 쪽.
 * ④는 cuid가 생성순 대략 단조증가라 "최신 행" 근사(엄밀 보장 아님) — 완전 동일 범위·시즌
 *    중복행(예: 원본 기간 위 조정 레이어)에서만 도달. id 미포함이면 "" 비교로 무해히 스킵.
 * 목업 정본 stackFor(interaction-spec.html)의 sort와 동일 순서.
 */
function periodBeats(p: RatePeriodLike, best: RatePeriodLike): boolean {
  const lp = periodLengthMs(p);
  const lb = periodLengthMs(best);
  if (lp !== lb) return lp < lb; // ① 짧은 기간
  const sp = SEASON_PRECEDENCE[p.season];
  const sb = SEASON_PRECEDENCE[best.season];
  if (sp !== sb) return sp > sb; // ② 높은 시즌
  const stp = p.startDate?.getTime() ?? -Infinity;
  const stb = best.startDate?.getTime() ?? -Infinity;
  if (stp !== stb) return stp > stb; // ③ 늦은 시작일
  return (p.id ?? "") > (best.id ?? ""); // ④ 큰 id(최신 근사)
}

/**
 * 날짜의 적용 요금 판정 (ADR-0014 D2 · rate-calendar-ux 겹침 허용) — 그 날짜를 덮는 웃돈 기간 중
 * 승자 1개(periodBeats 4단계), 어떤 기간도 없으면 기본요금(base). 겹침은 허용되며 항상 결정적.
 * 제네릭 T: 승자 선택은 season/isBase/날짜/id만 보므로 추가 컬럼(원가·공급자가 등)을 실은 행을
 *   넘기면 그 행 참조를 그대로 돌려준다(rate-layers 구간화·공급자 견적이 원본 컬럼 회수에 활용).
 */
export function resolveRatePeriod<T extends RatePeriodLike>(
  date: Date,
  periods: T[],
  base: T | null
): T {
  const t = date.getTime();
  let best: T | null = null;
  for (const p of periods) {
    if (p.isBase || !p.startDate || !p.endDate) continue;
    if (p.startDate.getTime() <= t && t < p.endDate.getTime()) {
      if (!best || periodBeats(p, best)) best = p;
    }
  }
  if (best) return best;
  if (!base) throw new MissingBaseRateError();
  return base;
}

export interface QuoteStayByPeriodInput extends StayRange {
  saleCurrency: Currency;
  /** 기본요금 행 (isBase=true). 없으면 견적 불가 */
  base: RatePeriodLike | null;
  /** 웃돈 기간 (isBase=false) — 보통 숙박 구간 교차분만 로드 */
  periods: RatePeriodLike[];
  /** 가격 계층 (ADR-0031). 미지정=NET(하위호환). CONSUMER=소비자 직판가(폴백 Net) */
  priceTier?: PriceTier;
  /**
   * ADR-0042 프리미엄 요일 — getUTCDay 값(0=일…6=토). 미지정/빈 배열=요일 프리미엄 없음(하위호환).
   * 그 요일의 박은 프리미엄 컬럼(premiumX ?? X)으로 해소한다.
   */
  premiumDays?: number[];
  /**
   * ADR-0042 공휴일 — 숙박 구간 교차 HolidayDate(@db.Date UTC 자정) 목록. 미지정/빈 배열=공휴일 프리미엄 없음.
   * 그 날짜의 박은 프리미엄(요일과 OR). 공휴일·요일 둘 다면 HOLIDAY 사유.
   */
  holidayDates?: Date[];
}

/** 기간별 박별 합산 견적 (ADR-0014) — quoteStay의 기간 판정 버전. 순수 함수 */
export function quoteStayByPeriod(input: QuoteStayByPeriodInput): StayQuote {
  assertSupportedSaleCurrency(input.saleCurrency);
  assertValidStayRange(input);

  const nightly: NightQuote[] = [];
  let totalSaleKrw = 0;
  let totalSaleVnd = 0n;
  let totalSupplierCostVnd = 0n;

  const nights = Math.round(
    (input.checkOut.getTime() - input.checkIn.getTime()) / MS_PER_DAY
  );

  // ADR-0042 프리미엄 판정 입력 — 미지정/빈 배열이면 null(판정 스킵) → 기존 빌라 완전 무중단.
  const premiumDaySet =
    input.premiumDays && input.premiumDays.length > 0 ? new Set(input.premiumDays) : null;
  const holidaySet =
    input.holidayDates && input.holidayDates.length > 0
      ? new Set(input.holidayDates.map((d) => d.getTime()))
      : null;

  for (let i = 0; i < nights; i++) {
    const date = new Date(input.checkIn.getTime() + i * MS_PER_DAY);
    const rawRate = resolveRatePeriod(date, input.periods, input.base);
    // ADR-0042: 프리미엄 박이면 각 가격 컬럼을 premiumX ?? X로 해소한 유효 행 사용(컬럼 단위 폴백).
    // ⚠ QA P2: 프리미엄 요일/공휴일이어도 그 행에 premium* 값이 하나도 없으면(미설정 빌라 — default '{5,6}'
    //   백필) 적용될 웃돈이 없다 → 프리미엄 취급 안 함(금액·뱃지 모두 평일과 동일). 뱃지 의미 =
    //   "실제 웃돈/프리미엄 원가 적용된 박"으로 명확화(계약 기준 2 표시층까지 보장).
    const reason = premiumReasonFor(date, premiumDaySet, holidaySet);
    const applied = reason !== null && hasAnyPremiumValue(rawRate);
    const rate = applied ? resolvePremiumRow(rawRate) : rawRate;

    const night: NightQuote = { date, season: rate.season, costVnd: rate.supplierCostVnd };
    if (applied) night.premium = reason;
    // USD(Phase 2)는 요율표에 판매단가가 없어 sale 칸을 비운다 — 원가만 박별 합산.
    // 계층(ADR-0031): CONSUMER면 소비자가(폴백 Net), 아니면 Net. 원가는 계층 무관 동일.
    const tier: PriceTier = input.priceTier ?? "NET";
    if (input.saleCurrency === Currency.KRW) {
      const krw = nightSaleKrw(rate, tier);
      night.saleKrw = krw;
      totalSaleKrw += krw;
    } else if (input.saleCurrency === Currency.VND) {
      const vnd = nightSaleVnd(rate, tier);
      night.saleVnd = vnd;
      totalSaleVnd += vnd;
    }
    totalSupplierCostVnd += rate.supplierCostVnd;
    nightly.push(night);
  }

  return {
    nights,
    saleCurrency: input.saleCurrency,
    nightly,
    // KRW/VND만 sale 총액을 채운다. USD는 둘 다 미포함(수동입력) — totalSupplierCostVnd만 의미.
    ...(input.saleCurrency === Currency.KRW
      ? { totalSaleKrw }
      : input.saleCurrency === Currency.VND
        ? { totalSaleVnd }
        : {}),
    totalSupplierCostVnd,
  };
}

/**
 * dual-read 대표 요금 행 선택 (ADR-0014) — 단일 대표가격이 필요한 "비인지 소비처"
 * (Zalo 빌라 공유 카드, STAFF 원가 읽기뷰 등)가 변환된 빌라에서 stale 가격을 보이지
 * 않도록 일원화한 선택기.
 *
 * - `baseRatePeriod`(VillaRatePeriod isBase=true)가 있으면 그것이 대표값(신규 경로).
 * - 없으면 기존 VillaRate에서 LOW(비수기), 없으면 첫 행, 그것도 없으면 null.
 *
 * ⚠️ 누수 책임 분리: 이 함수는 "행 선택"만 한다. 어떤 필드가 노출되는지는 전적으로
 *    호출자의 select에 달려 있다 — 원가 전용 소비처는 base/rates 양쪽에 supplierCostVnd만,
 *    판매가 전용 소비처는 salePrice* 만 select 해야 누수 불변식이 유지된다(같은 필드 집합).
 */
export function pickRepresentativeRate<T extends { season: SeasonType }>(
  baseRatePeriod: T | null | undefined,
  rates: T[]
): T | null {
  if (baseRatePeriod) return baseRatePeriod;
  return rates.find((r) => r.season === SeasonType.LOW) ?? rates[0] ?? null;
}

/**
 * 마진 자동계산: salePriceVnd = 원가 + 마진 (T1.2 요율 편집의 제안값 — ADMIN 오버라이드 가능)
 * PERCENT는 BigInt 정수 나눗셈(내림) — VND는 소수 없음
 */
export function computeSalePriceVnd(
  supplierCostVnd: bigint,
  marginType: MarginType,
  marginValue: bigint
): bigint {
  if (supplierCostVnd < 0n || marginValue < 0n) {
    throw new RangeError("원가·마진은 음수일 수 없습니다");
  }
  return marginType === MarginType.PERCENT
    ? supplierCostVnd + (supplierCostVnd * marginValue) / 100n
    : supplierCostVnd + marginValue;
}

/**
 * 소비자 직판가 자동계산 (ADR-0031): consumerSalePriceVnd = Net(salePriceVnd) + 소비자마진.
 * computeSalePriceVnd와 동형이나 **기준이 원가가 아니라 Net 판매가**다(마진 위에 마진).
 * PERCENT는 BigInt 정수 나눗셈(내림). ADMIN 오버라이드 가능한 제안값.
 */
export function computeConsumerSalePriceVnd(
  netSalePriceVnd: bigint,
  marginType: MarginType,
  marginValue: bigint
): bigint {
  if (netSalePriceVnd < 0n || marginValue < 0n) {
    throw new RangeError("Net 판매가·소비자마진은 음수일 수 없습니다");
  }
  return marginType === MarginType.PERCENT
    ? netSalePriceVnd + (netSalePriceVnd * marginValue) / 100n
    : netSalePriceVnd + marginValue;
}

/**
 * VND를 "1 외화 = x VND" 환율로 나눠 외화 정수로 반올림 (float 금지) — suggestSalePrice* 공통 코어.
 * 환율은 Decimal(14,4) 문자열 → 1e4 스케일 BigInt, half-up 반올림.
 */
function roundVndToForeign(amountVnd: bigint, fxVndPerUnit: string): number {
  if (!/^\d+(\.\d{1,4})?$/.test(fxVndPerUnit)) {
    throw new RangeError(`잘못된 환율 형식: ${fxVndPerUnit} (소수 4자리까지 숫자)`);
  }
  const [int, frac = ""] = fxVndPerUnit.split(".");
  const fxScaled = BigInt(int + frac.padEnd(4, "0")); // 환율 × 1e4
  if (fxScaled <= 0n) throw new RangeError("환율은 0보다 커야 합니다");

  // foreign = vnd / (fxScaled / 1e4) = vnd * 1e4 / fxScaled — half-up 반올림
  const numerator = amountVnd * 10_000n;
  return Number((numerator + fxScaled / 2n) / fxScaled); // Int 범위(수억)에서 안전
}

/**
 * VND→KRW 환산 제안: salePriceKrw ≈ salePriceVnd ÷ fxVndPerKrw (1 KRW = x VND)
 * 환율은 Decimal(14,4) 문자열로 받아 1e4 스케일 BigInt로 계산 (float 금지), 반올림.
 * ADMIN이 라운딩 오버라이드하는 제안값이다.
 */
export function suggestSalePriceKrw(salePriceVnd: bigint, fxVndPerKrw: string): number {
  return roundVndToForeign(salePriceVnd, fxVndPerKrw);
}

/**
 * VND→USD 환산 제안 (Phase 2, admin-manual-booking 후속확장 3): salePriceUsd ≈ salePriceVnd ÷ fxVndPerUsd.
 * suggestSalePriceKrw와 **동일 코어**(roundVndToForeign) — 1e4 스케일 BigInt half-up 반올림(float 금지).
 * usdToVndSnapshot의 역방향. ADMIN이 라운딩 오버라이드하는 제안값이다(정수 달러).
 */
export function suggestSalePriceUsd(salePriceVnd: bigint, fxVndPerUsd: string): number {
  return roundVndToForeign(salePriceVnd, fxVndPerUsd);
}

/**
 * KRW→VND 환산 (정산 손익 환산용, 정산 고도화): vnd = krw × fxVndPerKrw (1 KRW = x VND).
 * suggestSalePriceKrw의 역방향. 환율은 Decimal(14,4) 문자열 → 1e4 스케일 BigInt, half-up 반올림(float 금지).
 * 환율 스냅샷(Booking.fxVndPerKrw)을 받아 KRW 수납액을 VND 환산한다.
 */
export function krwToVndSnapshot(krw: number, fxVndPerKrw: string): bigint {
  if (!Number.isInteger(krw) || krw < 0) {
    throw new RangeError(`잘못된 KRW 금액: ${krw} (음이 아닌 정수)`);
  }
  if (!/^\d+(\.\d{1,4})?$/.test(fxVndPerKrw)) {
    throw new RangeError(`잘못된 환율 형식: ${fxVndPerKrw} (소수 4자리까지 숫자)`);
  }
  const [int, frac = ""] = fxVndPerKrw.split(".");
  const fxScaled = BigInt(int + frac.padEnd(4, "0")); // 환율 × 1e4
  if (fxScaled <= 0n) throw new RangeError("환율은 0보다 커야 합니다");

  // vnd = krw × (fxScaled / 1e4) = krw × fxScaled / 1e4 — half-up 반올림
  const numerator = BigInt(krw) * fxScaled;
  return (numerator + 5_000n) / 10_000n;
}

/**
 * USD→VND 환산 (Phase 2): vnd = usd × fxVndPerUsd (1 USD = x VND).
 * krwToVndSnapshot과 동형 — 환율은 Decimal(14,4) 문자열 → 1e4 스케일 BigInt, half-up 반올림(float 금지).
 * 환율 스냅샷(Booking.fxVndPerUsd / Proposal.fxVndPerUsd)을 받아 USD 매출을 VND 환산한다.
 * usd는 비음 정수(정수 달러)만 허용.
 */
export function usdToVndSnapshot(usd: number, fxVndPerUsd: string): bigint {
  if (!Number.isInteger(usd) || usd < 0) {
    throw new RangeError(`잘못된 USD 금액: ${usd} (음이 아닌 정수)`);
  }
  if (!/^\d+(\.\d{1,4})?$/.test(fxVndPerUsd)) {
    throw new RangeError(`잘못된 환율 형식: ${fxVndPerUsd} (소수 4자리까지 숫자)`);
  }
  const [int, frac = ""] = fxVndPerUsd.split(".");
  const fxScaled = BigInt(int + frac.padEnd(4, "0")); // 환율 × 1e4
  if (fxScaled <= 0n) throw new RangeError("환율은 0보다 커야 합니다");

  // vnd = usd × (fxScaled / 1e4) = usd × fxScaled / 1e4 — half-up 반올림
  const numerator = BigInt(usd) * fxScaled;
  return (numerator + 5_000n) / 10_000n;
}

/**
 * 듀얼/트리 컬럼 검증 (SPEC F3, Phase 2): ProposalItem·Booking 금액은 saleCurrency에 해당하는
 * 통화 컬럼만 채워야 한다.
 *  - KRW ⇒ krw 필수, vnd·usd 금지
 *  - VND ⇒ vnd 필수, krw·usd 금지
 *  - USD ⇒ usd 필수, krw·vnd 금지 (Phase 2)
 */
export function assertSaleAmountColumns(
  saleCurrency: Currency,
  amounts: { krw?: number | null; vnd?: bigint | null; usd?: number | null }
): void {
  assertSupportedSaleCurrency(saleCurrency);
  const hasKrw = amounts.krw != null;
  const hasVnd = amounts.vnd != null;
  const hasUsd = amounts.usd != null;
  if (saleCurrency === Currency.KRW && (!hasKrw || hasVnd || hasUsd)) {
    throw new Error("KRW 거래는 KRW 금액만 채워야 합니다 (krw 필수, vnd·usd 금지)");
  }
  if (saleCurrency === Currency.VND && (!hasVnd || hasKrw || hasUsd)) {
    throw new Error("VND 거래는 VND 금액만 채워야 합니다 (vnd 필수, krw·usd 금지)");
  }
  if (saleCurrency === Currency.USD && (!hasUsd || hasKrw || hasVnd)) {
    throw new Error("USD 거래는 USD 금액만 채워야 합니다 (usd 필수, krw·vnd 금지)");
  }
}

// ===================== DB 래퍼 층 =====================

/** AppSetting 키 — 환율 (1 KRW = x VND), ADMIN이 /settings에서 수동 갱신 */
export const FX_VND_PER_KRW_KEY = "FX_VND_PER_KRW";

/** AppSetting 키 — USD 환율 (1 USD = x VND), ADMIN이 /settings에서 수동 갱신 (후속확장 3) */
export const FX_VND_PER_USD_KEY = "FX_VND_PER_USD";

/**
 * 단일 빌라 견적 (ADR-0014 Phase B — VillaRatePeriod 단일 경로).
 * 기본요금(base, isBase=true) + 숙박 구간 교차 웃돈 기간을 로드해 quoteStayByPeriod로 박별 합산.
 * base가 없으면 견적 불가 → MissingBaseRateError(MissingRateError 하위 — 소비처 catch 호환).
 * @param db PrismaClient 또는 트랜잭션 클라이언트 (T2.3 HOLD 스냅샷은 tx 주입)
 */
export async function quoteStayForVilla(
  db: DbClient,
  villaId: string,
  range: StayRange,
  saleCurrency: Currency,
  /** 채널 (ADR-0031). DIRECT면 소비자가 계층, 그 외/미지정이면 Net. 원가는 계층 무관 동일 */
  channel?: BookingChannel
): Promise<StayQuote> {
  assertValidStayRange(range);

  const RP_SELECT = {
    id: true, // 겹침 승자 4단계 tie-break ④(최신 행) — 동일 범위 중복행(조정 레이어 등) 결정성
    season: true,
    isBase: true,
    startDate: true,
    endDate: true,
    supplierCostVnd: true,
    salePriceVnd: true,
    salePriceKrw: true,
    // ADR-0031 — 소비자 계층 폴백 판정용. NET 견적에도 select하나 사용 안 함(누수 아님: 운영자 견적 경로).
    consumerSalePriceVnd: true,
    consumerSalePriceKrw: true,
    // ADR-0042 프리미엄일 컬럼 — 운영자 견적 경로(누수 아님). ⚠ 공급자/공개 경로엔 절대 select 금지.
    premiumSupplierCostVnd: true,
    premiumSalePriceVnd: true,
    premiumSalePriceKrw: true,
    premiumConsumerSalePriceVnd: true,
    premiumConsumerSalePriceKrw: true,
  } as const;
  const [villa, base, periods, holidays] = await Promise.all([
    // ADR-0042: 빌라 프리미엄 요일. 미존재 빌라는 base 부재로 어차피 MissingBaseRateError.
    db.villa.findUnique({ where: { id: villaId }, select: { premiumDays: true } }),
    db.villaRatePeriod.findFirst({ where: { villaId, isBase: true }, select: RP_SELECT }),
    db.villaRatePeriod.findMany({
      where: {
        villaId,
        isBase: false,
        startDate: { lt: range.checkOut },
        endDate: { gt: range.checkIn },
      },
      select: RP_SELECT,
    }),
    // ADR-0042: 숙박 박 집합과 동일 범위(half-open) 교차 공휴일만 로드
    db.holidayDate.findMany({
      where: { date: { gte: range.checkIn, lt: range.checkOut } },
      select: { date: true },
    }),
  ]);
  if (!base) throw new MissingBaseRateError();
  const priceTier = channel ? priceTierForChannel(channel) : "NET";
  return quoteStayByPeriod({
    ...range,
    saleCurrency,
    base,
    periods,
    priceTier,
    premiumDays: villa?.premiumDays ?? [],
    holidayDates: holidays.map((h) => h.date),
  });
}

/**
 * 공급자 자기 판매가(supplierSalePriceVnd) 미설정으로 견적 불가 (F10 Phase B, ADR-0021 §7).
 * 운영자 요율(MissingBaseRateError)과 **별개 경로** — 공급자 직접 판매 링크 전용.
 * season·date 정보를 담아 어느 박/기간에서 막혔는지 안내한다.
 */
export class MissingSupplierPriceError extends Error {
  constructor(
    public readonly season: SeasonType,
    public readonly date: Date
  ) {
    super(`공급자 판매가 미설정: ${season} (${date.toISOString().slice(0, 10)})`);
    this.name = "MissingSupplierPriceError";
  }
}

/** 공급자 판매가 견적용 행 — supplierSalePriceVnd(+프리미엄)만 보는 RatePeriodLike의 부분집합 */
interface SupplierRatePeriodLike {
  id: string;
  season: SeasonType;
  isBase: boolean;
  startDate: Date | null;
  endDate: Date | null;
  supplierSalePriceVnd: bigint | null;
  // ADR-0042 — 프리미엄 박 공급자 판매 정가. null이면 supplierSalePriceVnd로 컬럼 단위 폴백.
  premiumSupplierSalePriceVnd?: bigint | null;
}

/**
 * 공급자 자기 판매가 견적 (F10 Phase B, ADR-0021 §7).
 *
 * quoteStayForVilla와 **동일한 박별 기간 선택 로직**(resolveRatePeriod: 웃돈 기간 우선, 없으면 base)을
 * 따르되, 각 박에서 **supplierSalePriceVnd만** 읽는다. 운영자 salePrice*·margin*·supplierCostVnd는
 * select에도 넣지 않는다(마진 비공개 — 컬럼이 메모리에 적재조차 안 됨).
 *
 * - 적용 기간의 supplierSalePriceVnd가 null이면 MissingSupplierPriceError(그 시즌·날짜) throw.
 * - 통화는 항상 VND(공급자 화면은 VND만).
 * @param db PrismaClient 또는 트랜잭션 클라이언트 (HOLD 스냅샷은 tx 주입)
 */
export async function quoteSupplierSaleForVilla(
  db: DbClient,
  villaId: string,
  range: StayRange
): Promise<{ totalVnd: bigint; nightlyVnd: bigint[] }> {
  assertValidStayRange(range);

  // ⚠ supplierSalePriceVnd·프리미엄 공급자가·날짜·season만 select — 운영자 salePrice*/margin*/supplierCostVnd·
  //    premiumSalePrice*/premiumConsumer* 절대 미포함(마진 비공개). 공급자 자기 필드 2개만.
  const SRP_SELECT = {
    id: true, // 겹침 승자 tie-break ④ + sourceOf 원본 회수 키(동일 범위 중복행 결정성)
    season: true,
    isBase: true,
    startDate: true,
    endDate: true,
    supplierSalePriceVnd: true,
    premiumSupplierSalePriceVnd: true, // ADR-0042 — 공급자 자기 프리미엄 판매 정가(허용 필드)
  } as const;
  const [villa, base, periods, holidays] = await Promise.all([
    db.villa.findUnique({ where: { id: villaId }, select: { premiumDays: true } }),
    db.villaRatePeriod.findFirst({ where: { villaId, isBase: true }, select: SRP_SELECT }),
    db.villaRatePeriod.findMany({
      where: {
        villaId,
        isBase: false,
        startDate: { lt: range.checkOut },
        endDate: { gt: range.checkIn },
      },
      select: SRP_SELECT,
    }),
    db.holidayDate.findMany({
      where: { date: { gte: range.checkIn, lt: range.checkOut } },
      select: { date: true },
    }),
  ]);
  if (!base) throw new MissingBaseRateError();

  // resolveRatePeriod는 RatePeriodLike(가격 필드 다수)를 받지만 우리는 기간 선택만 쓰므로,
  // 가격 필드를 0으로 채운 어댑터로 호출하고 선택 결과의 season/date 키로 원본을 되짚는다.
  const nights = Math.round((range.checkOut.getTime() - range.checkIn.getTime()) / MS_PER_DAY);
  const nightlyVnd: bigint[] = [];
  let totalVnd = 0n;

  // 기간 선택을 위한 어댑터(가격 0) — resolveRatePeriod의 겹침/우선순위 로직 재사용.
  // id를 실어 승자 tie-break ④와 sourceOf 원본 회수를 동일 범위 중복행에서도 결정적으로 유지.
  const toLike = (r: SupplierRatePeriodLike): RatePeriodLike => ({
    id: r.id,
    season: r.season,
    isBase: r.isBase,
    startDate: r.startDate,
    endDate: r.endDate,
    supplierCostVnd: 0n,
    salePriceVnd: 0n,
    salePriceKrw: 0,
  });
  const baseLike = toLike(base);
  const periodLikes = periods.map(toLike);
  // 승자 행 id로 원본 SupplierRatePeriodLike 회수(동일 범위 중복행도 정확 — season+날짜 매칭 모호성 제거)
  const sourceOf = (chosen: RatePeriodLike): SupplierRatePeriodLike => {
    if (chosen.isBase) return base;
    return periods.find((p) => p.id === chosen.id) ?? base;
  };

  // ADR-0042 프리미엄 판정 입력 — 미지정/빈 배열이면 null(스킵) → 기존 공급자 견적 완전 무중단.
  const premiumDaySet =
    villa?.premiumDays && villa.premiumDays.length > 0 ? new Set(villa.premiumDays) : null;
  const holidaySet = holidays.length > 0 ? new Set(holidays.map((h) => h.date.getTime())) : null;

  for (let i = 0; i < nights; i++) {
    const date = new Date(range.checkIn.getTime() + i * MS_PER_DAY);
    const chosen = resolveRatePeriod(date, periodLikes, baseLike);
    const src = sourceOf(chosen);
    // ADR-0042: 프리미엄 박이면 premiumSupplierSalePriceVnd ?? supplierSalePriceVnd(컬럼 단위 폴백).
    const reason = premiumReasonFor(date, premiumDaySet, holidaySet);
    const priceVnd = reason
      ? src.premiumSupplierSalePriceVnd ?? src.supplierSalePriceVnd
      : src.supplierSalePriceVnd;
    if (priceVnd == null) {
      throw new MissingSupplierPriceError(src.season, date);
    }
    nightlyVnd.push(priceVnd);
    totalVnd += priceVnd;
  }

  return { totalVnd, nightlyVnd };
}

/** 환율 스냅샷용 조회 — 미설정이면 null (제안 생성 UI에서 ADMIN 입력 유도) */
export async function getFxVndPerKrw(db: DbClient): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: FX_VND_PER_KRW_KEY } });
  return row?.value ?? null;
}

/** USD 수동 환율 스냅샷용 조회 (후속확장 3) — 미설정이면 null. getFxVndPerKrw와 동형. */
export async function getFxVndPerUsd(db: DbClient): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: FX_VND_PER_USD_KEY } });
  return row?.value ?? null;
}
