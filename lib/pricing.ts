import { Currency, MarginType, SeasonType } from "@prisma/client";
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

/** 시즌 겹침 시 우선순위 — 극성수기 > 성수기 > 비수기 */
const SEASON_PRECEDENCE: Record<SeasonType, number> = {
  [SeasonType.PEAK]: 2,
  [SeasonType.HIGH]: 1,
  [SeasonType.LOW]: 0,
};

export interface SeasonPeriodLike {
  season: SeasonType;
  /** 시작일 (포함) — @db.Date, UTC 자정 */
  startDate: Date;
  /** 종료일 (제외) — [startDate, endDate) half-open, 프로젝트 날짜 규약 통일 */
  endDate: Date;
}

export interface VillaRateLike {
  season: SeasonType;
  supplierCostVnd: bigint;
  salePriceVnd: bigint;
  salePriceKrw: number;
}

/** 해당 시즌의 VillaRate가 없을 때 — 요율 미설정 빌라는 견적 불가 */
export class MissingRateError extends Error {
  constructor(public readonly season: SeasonType) {
    super(`시즌 ${season}의 요율(VillaRate)이 설정되지 않았습니다`);
    this.name = "MissingRateError";
  }
}

/** 판매 통화 게이트 — SPEC F3: 판매 통화는 KRW(직접 소비자)·VND(여행사·랜드사)뿐 */
function assertSupportedSaleCurrency(saleCurrency: Currency): void {
  if (saleCurrency !== Currency.KRW && saleCurrency !== Currency.VND) {
    throw new RangeError(`지원하지 않는 판매 통화: ${saleCurrency} (KRW·VND만 가능)`);
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** 날짜가 속한 시즌 판정 — 미등록은 LOW, 겹침은 PEAK > HIGH > LOW */
export function resolveSeason(date: Date, periods: SeasonPeriodLike[]): SeasonType {
  const t = date.getTime();
  let season: SeasonType = SeasonType.LOW;
  for (const p of periods) {
    if (p.startDate.getTime() <= t && t < p.endDate.getTime()) {
      if (SEASON_PRECEDENCE[p.season] > SEASON_PRECEDENCE[season]) season = p.season;
    }
  }
  return season;
}

export interface NightQuote {
  /** 숙박일 (그 날 밤) — UTC 자정 */
  date: Date;
  season: SeasonType;
  /** saleCurrency=KRW일 때만 채움 */
  saleKrw?: number;
  /** saleCurrency=VND일 때만 채움 */
  saleVnd?: bigint;
  costVnd: bigint;
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

export interface QuoteStayInput extends StayRange {
  saleCurrency: Currency;
  rates: VillaRateLike[];
  seasonPeriods: SeasonPeriodLike[];
}

/** 박별 합산 견적 — DB 조회 결과를 받아 계산하는 순수 함수 */
export function quoteStay(input: QuoteStayInput): StayQuote {
  assertSupportedSaleCurrency(input.saleCurrency);
  assertValidStayRange(input);

  const rateBySeason = new Map<SeasonType, VillaRateLike>(
    input.rates.map((r) => [r.season, r])
  );

  const nightly: NightQuote[] = [];
  let totalSaleKrw = 0;
  let totalSaleVnd = 0n;
  let totalSupplierCostVnd = 0n;

  const nights = Math.round(
    (input.checkOut.getTime() - input.checkIn.getTime()) / MS_PER_DAY
  );

  for (let i = 0; i < nights; i++) {
    const date = new Date(input.checkIn.getTime() + i * MS_PER_DAY);
    const season = resolveSeason(date, input.seasonPeriods);
    const rate = rateBySeason.get(season);
    if (!rate) throw new MissingRateError(season);

    const night: NightQuote = { date, season, costVnd: rate.supplierCostVnd };
    if (input.saleCurrency === Currency.KRW) {
      night.saleKrw = rate.salePriceKrw;
      totalSaleKrw += rate.salePriceKrw;
    } else {
      night.saleVnd = rate.salePriceVnd;
      totalSaleVnd += rate.salePriceVnd;
    }
    totalSupplierCostVnd += rate.supplierCostVnd;
    nightly.push(night);
  }

  return {
    nights,
    saleCurrency: input.saleCurrency,
    nightly,
    ...(input.saleCurrency === Currency.KRW
      ? { totalSaleKrw }
      : { totalSaleVnd }),
    totalSupplierCostVnd,
  };
}

// ===================== 기간별 요금 (ADR-0014) — 순수 함수 층 =====================

/** 기간별 요금 행 (ADR-0014) — 날짜 범위 + 가격을 한 행에. base는 startDate/endDate null. */
export interface RatePeriodLike {
  season: SeasonType;
  isBase: boolean;
  /** isBase=false일 때만 채움. 포함 — @db.Date UTC 자정 */
  startDate: Date | null;
  /** isBase=false일 때만. 제외 — [start,end) half-open */
  endDate: Date | null;
  supplierCostVnd: bigint;
  salePriceVnd: bigint;
  salePriceKrw: number;
}

/** 기본요금(base) 부재로 견적 불가 — 기간별 경로 빌라는 base가 필수 */
export class MissingBaseRateError extends Error {
  constructor() {
    super("기간별 요금 빌라에 기본요금(isBase) 행이 없습니다");
    this.name = "MissingBaseRateError";
  }
}

/**
 * 날짜의 적용 요금 판정 (ADR-0014 D2) — 그 날짜를 덮는 웃돈 기간 우선, 없으면 기본요금.
 * 입력 단계서 겹침을 거부하므로 보통 매칭은 0~1개. 방어적으로 겹침 시 PEAK>HIGH>LOW,
 * 같으면 startDate 늦은 것(최근 지정) 우선 — 결정적.
 */
export function resolveRatePeriod(
  date: Date,
  periods: RatePeriodLike[],
  base: RatePeriodLike | null
): RatePeriodLike {
  const t = date.getTime();
  let best: RatePeriodLike | null = null;
  for (const p of periods) {
    if (p.isBase || !p.startDate || !p.endDate) continue;
    if (p.startDate.getTime() <= t && t < p.endDate.getTime()) {
      if (
        !best ||
        SEASON_PRECEDENCE[p.season] > SEASON_PRECEDENCE[best.season] ||
        (SEASON_PRECEDENCE[p.season] === SEASON_PRECEDENCE[best.season] &&
          p.startDate.getTime() > (best.startDate?.getTime() ?? -Infinity))
      ) {
        best = p;
      }
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

  for (let i = 0; i < nights; i++) {
    const date = new Date(input.checkIn.getTime() + i * MS_PER_DAY);
    const rate = resolveRatePeriod(date, input.periods, input.base);

    const night: NightQuote = { date, season: rate.season, costVnd: rate.supplierCostVnd };
    if (input.saleCurrency === Currency.KRW) {
      night.saleKrw = rate.salePriceKrw;
      totalSaleKrw += rate.salePriceKrw;
    } else {
      night.saleVnd = rate.salePriceVnd;
      totalSaleVnd += rate.salePriceVnd;
    }
    totalSupplierCostVnd += rate.supplierCostVnd;
    nightly.push(night);
  }

  return {
    nights,
    saleCurrency: input.saleCurrency,
    nightly,
    ...(input.saleCurrency === Currency.KRW ? { totalSaleKrw } : { totalSaleVnd }),
    totalSupplierCostVnd,
  };
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
 * VND→KRW 환산 제안: salePriceKrw ≈ salePriceVnd ÷ fxVndPerKrw (1 KRW = x VND)
 * 환율은 Decimal(14,4) 문자열로 받아 1e4 스케일 BigInt로 계산 (float 금지), 반올림.
 * ADMIN이 라운딩 오버라이드하는 제안값이다.
 */
export function suggestSalePriceKrw(salePriceVnd: bigint, fxVndPerKrw: string): number {
  if (!/^\d+(\.\d{1,4})?$/.test(fxVndPerKrw)) {
    throw new RangeError(`잘못된 환율 형식: ${fxVndPerKrw} (소수 4자리까지 숫자)`);
  }
  const [int, frac = ""] = fxVndPerKrw.split(".");
  const fxScaled = BigInt(int + frac.padEnd(4, "0")); // 환율 × 1e4
  if (fxScaled <= 0n) throw new RangeError("환율은 0보다 커야 합니다");

  // krw = vnd / (fxScaled / 1e4) = vnd * 1e4 / fxScaled — 반올림
  const numerator = salePriceVnd * 10_000n;
  const krw = (numerator + fxScaled / 2n) / fxScaled;
  return Number(krw); // KRW Int 범위(수억 원)에서 안전
}

/**
 * 듀얼 컬럼 검증 (SPEC F3): ProposalItem·Booking 금액은 saleCurrency에 해당하는
 * 통화 컬럼만 채워야 한다. KRW ⇒ krw 필수·vnd 금지 / VND ⇒ 반대.
 */
export function assertSaleAmountColumns(
  saleCurrency: Currency,
  amounts: { krw?: number | null; vnd?: bigint | null }
): void {
  assertSupportedSaleCurrency(saleCurrency);
  const hasKrw = amounts.krw != null;
  const hasVnd = amounts.vnd != null;
  if (saleCurrency === Currency.KRW && (!hasKrw || hasVnd)) {
    throw new Error("KRW 거래는 KRW 금액만 채워야 합니다 (krw 필수, vnd 금지)");
  }
  if (saleCurrency === Currency.VND && (!hasVnd || hasKrw)) {
    throw new Error("VND 거래는 VND 금액만 채워야 합니다 (vnd 필수, krw 금지)");
  }
}

// ===================== DB 래퍼 층 =====================

/** AppSetting 키 — 환율 (1 KRW = x VND), ADMIN이 /settings에서 수동 갱신 */
export const FX_VND_PER_KRW_KEY = "FX_VND_PER_KRW";

/**
 * 단일 빌라 견적 — VillaRate·SeasonPeriod 로드 후 quoteStay.
 * @param db PrismaClient 또는 트랜잭션 클라이언트 (T2.3 HOLD 스냅샷은 tx 주입)
 */
export async function quoteStayForVilla(
  db: DbClient,
  villaId: string,
  range: StayRange,
  saleCurrency: Currency
): Promise<StayQuote> {
  assertValidStayRange(range);

  // ADR-0014 dual-read: 이 빌라가 VillaRatePeriod를 1건이라도 보유하면 기간별 경로.
  //   보유는 count로 판정(ADR-0008 교훈 — 교차분 length로 폴백 판정 금지), 기간은 교차분만 로드.
  //   0건이면 아래 기존 경로(VillaRate+VillaSeasonPeriod/전역) 그대로 — 무회귀.
  const RP_SELECT = {
    season: true,
    isBase: true,
    startDate: true,
    endDate: true,
    supplierCostVnd: true,
    salePriceVnd: true,
    salePriceKrw: true,
  } as const;
  const ratePeriodCount = await db.villaRatePeriod.count({ where: { villaId } });
  if (ratePeriodCount > 0) {
    const [base, periods] = await Promise.all([
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
    ]);
    return quoteStayByPeriod({ ...range, saleCurrency, base, periods });
  }

  // ADR-0008 D3: 빌라별 시즌 폴백 — 반드시 2단계로 분리한다.
  //   1) 보유 판정(count): 이 빌라가 VillaSeasonPeriod를 "하나라도" 가졌는가
  //      → 가졌으면 그 빌라 달력으로만 판정(전역 무시), 0건이면 전역 폴백.
  //   2) 기간 로드(교차분): 숙박 구간과 겹치는 행만 로드.
  // ⚠️ 보유 판정을 "교차분 length>0"으로 하면, 빌라가 시즌을 지정했지만 이번 구간과
  //    안 겹칠 때 length===0 → 잘못된 전역 폴백 버그(TDA 경고). count와 load를 섞지 말 것.
  const [rates, villaPeriodCount] = await Promise.all([
    db.villaRate.findMany({
      where: { villaId },
      select: {
        season: true,
        supplierCostVnd: true,
        salePriceVnd: true,
        salePriceKrw: true,
      },
    }),
    db.villaSeasonPeriod.count({ where: { villaId } }),
  ]);

  // 숙박 구간과 겹치는 시즌만 로드 — half-open. 보유 빌라는 빌라 집합, 0건이면 전역.
  const seasonPeriods = villaPeriodCount > 0
    ? await db.villaSeasonPeriod.findMany({
        where: {
          villaId,
          startDate: { lt: range.checkOut },
          endDate: { gt: range.checkIn },
        },
        select: { season: true, startDate: true, endDate: true },
      })
    : await db.seasonPeriod.findMany({
        where: { startDate: { lt: range.checkOut }, endDate: { gt: range.checkIn } },
        select: { season: true, startDate: true, endDate: true },
      });

  return quoteStay({ ...range, saleCurrency, rates, seasonPeriods });
}

/** 환율 스냅샷용 조회 — 미설정이면 null (제안 생성 UI에서 ADMIN 입력 유도) */
export async function getFxVndPerKrw(db: DbClient): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: FX_VND_PER_KRW_KEY } });
  return row?.value ?? null;
}
