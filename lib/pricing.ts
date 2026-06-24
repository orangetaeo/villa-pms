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

/** 판매 통화 게이트 — SPEC F3: 판매 통화는 KRW(직접 소비자)·VND(여행사·랜드사)뿐 */
function assertSupportedSaleCurrency(saleCurrency: Currency): void {
  if (saleCurrency !== Currency.KRW && saleCurrency !== Currency.VND) {
    throw new RangeError(`지원하지 않는 판매 통화: ${saleCurrency} (KRW·VND만 가능)`);
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

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

// ===================== 기간별 요금 (ADR-0014) — 순수 함수 층 =====================

/** 빌라 생성/수정 입력의 시즌별 원가 (LOW/HIGH/PEAK, 동 단위 BigInt). */
export interface SeasonCostsVnd {
  LOW: bigint;
  HIGH: bigint;
  PEAK: bigint;
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
    .map((s) => row(s.season, costs[s.season as "HIGH" | "PEAK"], false, s.startDate, s.endDate, s.label));
  return { base, periods };
}

/**
 * 시즌별 "대표" 요금 행 추출 (ADR-0014 Phase B) — 구 VillaRate(시즌 키) 표시/원가경보를 신규 경로로 대체.
 * 한 빌라의 VillaRatePeriod 행들에서 시즌별 대표값을 만든다: LOW=base, HIGH/PEAK=그 시즌 첫 기간(없으면 base).
 * 표시·경보용(견적 아님). T는 호출자 select 필드(누수 책임은 호출자 — base/period 동일 필드집합 전제).
 */
export function representativeRatesBySeason<
  T extends { season: SeasonType; isBase: boolean }
>(ratePeriods: T[]): Partial<Record<SeasonType, T>> {
  const base = ratePeriods.find((r) => r.isBase) ?? null;
  const out: Partial<Record<SeasonType, T>> = {};
  for (const season of [SeasonType.LOW, SeasonType.HIGH, SeasonType.PEAK]) {
    if (season === SeasonType.LOW) {
      if (base) out.LOW = base;
    } else {
      const period = ratePeriods.find((r) => !r.isBase && r.season === season);
      const rep = period ?? base;
      if (rep) out[season] = rep;
    }
  }
  return out;
}

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
 * 단일 빌라 견적 (ADR-0014 Phase B — VillaRatePeriod 단일 경로).
 * 기본요금(base, isBase=true) + 숙박 구간 교차 웃돈 기간을 로드해 quoteStayByPeriod로 박별 합산.
 * base가 없으면 견적 불가 → MissingBaseRateError(MissingRateError 하위 — 소비처 catch 호환).
 * @param db PrismaClient 또는 트랜잭션 클라이언트 (T2.3 HOLD 스냅샷은 tx 주입)
 */
export async function quoteStayForVilla(
  db: DbClient,
  villaId: string,
  range: StayRange,
  saleCurrency: Currency
): Promise<StayQuote> {
  assertValidStayRange(range);

  const RP_SELECT = {
    season: true,
    isBase: true,
    startDate: true,
    endDate: true,
    supplierCostVnd: true,
    salePriceVnd: true,
    salePriceKrw: true,
  } as const;
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
  if (!base) throw new MissingBaseRateError();
  return quoteStayByPeriod({ ...range, saleCurrency, base, periods });
}

/** 환율 스냅샷용 조회 — 미설정이면 null (제안 생성 UI에서 ADMIN 입력 유도) */
export async function getFxVndPerKrw(db: DbClient): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: FX_VND_PER_KRW_KEY } });
  return row?.value ?? null;
}
