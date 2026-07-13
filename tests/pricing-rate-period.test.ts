import { describe, expect, it, vi } from "vitest";
import { Currency, SeasonType } from "@prisma/client";
import {
  resolveRatePeriod,
  quoteStayByPeriod,
  quoteStayForVilla,
  pickRepresentativeRate,
  representativeRatesBySeason,
  buildRatePeriodRowsFromSeasonCosts,
  MissingBaseRateError,
  type RatePeriodLike,
} from "@/lib/pricing";
import type { DbClient } from "@/lib/availability";

// ADR-0014 기간별 요금 — resolveRatePeriod/quoteStayByPeriod 순수함수 + quoteStayForVilla dual-read 분기.
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const base: RatePeriodLike = {
  season: SeasonType.LOW,
  isBase: true,
  startDate: null,
  endDate: null,
  supplierCostVnd: 1_000_000n,
  salePriceVnd: 1_200_000n,
  salePriceKrw: 60_000,
};
// 같은 PEAK 시즌이지만 기간·가격이 다른 두 극성수기 (회의 핵심 요구)
const peakTet: RatePeriodLike = {
  season: SeasonType.PEAK,
  isBase: false,
  startDate: utc("2026-02-14"),
  endDate: utc("2026-02-20"),
  supplierCostVnd: 5_000_000n,
  salePriceVnd: 6_000_000n,
  salePriceKrw: 300_000,
};
const peakSummer: RatePeriodLike = {
  season: SeasonType.PEAK,
  isBase: false,
  startDate: utc("2026-07-10"),
  endDate: utc("2026-07-20"),
  supplierCostVnd: 4_500_000n,
  salePriceVnd: 5_500_000n,
  salePriceKrw: 275_000,
};

describe("resolveRatePeriod — 기간 우선, 없으면 기본요금", () => {
  it("기간에 걸린 날짜 → 그 기간 가격 (같은 PEAK라도 기간별 상이)", () => {
    expect(resolveRatePeriod(utc("2026-02-15"), [peakTet, peakSummer], base)).toBe(peakTet);
    expect(resolveRatePeriod(utc("2026-07-11"), [peakTet, peakSummer], base)).toBe(peakSummer);
  });
  it("어떤 기간에도 안 걸린 날짜 → 기본요금", () => {
    expect(resolveRatePeriod(utc("2026-05-01"), [peakTet, peakSummer], base)).toBe(base);
  });
  it("half-open: endDate 당일은 제외 → 기본요금", () => {
    expect(resolveRatePeriod(utc("2026-02-20"), [peakTet], base)).toBe(base);
    expect(resolveRatePeriod(utc("2026-02-19"), [peakTet], base)).toBe(peakTet);
  });
  it("base 없고 매칭도 없으면 MissingBaseRateError", () => {
    expect(() => resolveRatePeriod(utc("2026-05-01"), [peakTet], null)).toThrow(MissingBaseRateError);
  });
  it("겹침 방어 tie-break: 우선순위 높은 시즌, 같으면 startDate 늦은 것", () => {
    const lowOverlap: RatePeriodLike = { ...base, isBase: false, startDate: utc("2026-07-10"), endDate: utc("2026-07-20") };
    // PEAK(peakSummer) vs LOW(lowOverlap) 겹침 → PEAK 우선
    expect(resolveRatePeriod(utc("2026-07-11"), [lowOverlap, peakSummer], base)).toBe(peakSummer);
  });
});

// 준성수기(SHOULDER, T-season-shoulder) — LOW < SHOULDER < HIGH < PEAK
const shoulderSpring: RatePeriodLike = {
  season: SeasonType.SHOULDER,
  isBase: false,
  startDate: utc("2026-09-01"),
  endDate: utc("2026-09-10"),
  supplierCostVnd: 2_000_000n,
  salePriceVnd: 2_400_000n,
  salePriceKrw: 120_000,
};

describe("SHOULDER(준성수기) — 우선순위 LOW < SHOULDER < HIGH", () => {
  const overlap = { startDate: utc("2026-07-10"), endDate: utc("2026-07-20") };
  const shoulderOverlap: RatePeriodLike = { ...shoulderSpring, ...overlap };
  const lowOverlap: RatePeriodLike = { ...base, isBase: false, ...overlap };
  const highOverlap: RatePeriodLike = {
    season: SeasonType.HIGH,
    isBase: false,
    ...overlap,
    supplierCostVnd: 3_000_000n,
    salePriceVnd: 3_600_000n,
    salePriceKrw: 180_000,
  };

  it("SHOULDER vs LOW 겹침 → SHOULDER 우선", () => {
    expect(resolveRatePeriod(utc("2026-07-11"), [lowOverlap, shoulderOverlap], base)).toBe(shoulderOverlap);
  });
  it("HIGH vs SHOULDER 겹침 → HIGH 우선", () => {
    expect(resolveRatePeriod(utc("2026-07-11"), [shoulderOverlap, highOverlap], base)).toBe(highOverlap);
  });
  it("SHOULDER 기간 걸린 날 → SHOULDER 가격 박별 합산", () => {
    const q = quoteStayByPeriod({
      checkIn: utc("2026-09-01"),
      checkOut: utc("2026-09-03"),
      saleCurrency: Currency.VND,
      base,
      periods: [shoulderSpring],
    });
    expect(q.nightly.map((n) => n.season)).toEqual([SeasonType.SHOULDER, SeasonType.SHOULDER]);
    expect(q.totalSaleVnd).toBe(2_400_000n + 2_400_000n);
  });
});

describe("buildRatePeriodRowsFromSeasonCosts — SHOULDER 선택·방어 스킵", () => {
  const globalSeasons = [
    { season: SeasonType.SHOULDER, startDate: utc("2026-09-01"), endDate: utc("2026-09-10"), label: null },
    { season: SeasonType.HIGH, startDate: utc("2026-10-01"), endDate: utc("2026-11-01"), label: null },
  ];
  it("SHOULDER 원가 있으면 SHOULDER 기간행 생성", () => {
    const { base: b, periods } = buildRatePeriodRowsFromSeasonCosts(
      { LOW: 1_000_000n, SHOULDER: 2_000_000n, HIGH: 3_000_000n, PEAK: 5_000_000n },
      globalSeasons
    );
    expect(b.season).toBe(SeasonType.LOW);
    expect(periods.map((p) => p.season)).toEqual([SeasonType.SHOULDER, SeasonType.HIGH]);
    expect(periods.find((p) => p.season === SeasonType.SHOULDER)!.supplierCostVnd).toBe(2_000_000n);
  });
  it("SHOULDER 원가 미포함(구 payload) → 전역 SHOULDER 기간 스킵(방어), HIGH만 생성", () => {
    const { periods } = buildRatePeriodRowsFromSeasonCosts(
      { LOW: 1_000_000n, HIGH: 3_000_000n, PEAK: 5_000_000n },
      globalSeasons
    );
    expect(periods.map((p) => p.season)).toEqual([SeasonType.HIGH]);
  });
});

describe("quoteStayByPeriod — 박별 합산", () => {
  it("기간 경계 걸친 숙박: base→PEAK→base 박별 다른 가격 합산 (VND)", () => {
    // 2/13(base) 2/14(peakTet) 2/15(peakTet) = 3박
    const q = quoteStayByPeriod({
      checkIn: utc("2026-02-13"),
      checkOut: utc("2026-02-16"),
      saleCurrency: Currency.VND,
      base,
      periods: [peakTet],
    });
    expect(q.nights).toBe(3);
    expect(q.nightly.map((n) => n.season)).toEqual([SeasonType.LOW, SeasonType.PEAK, SeasonType.PEAK]);
    expect(q.totalSaleVnd).toBe(1_200_000n + 6_000_000n + 6_000_000n);
    expect(q.totalSupplierCostVnd).toBe(1_000_000n + 5_000_000n + 5_000_000n);
  });
  it("KRW 채널 합산", () => {
    const q = quoteStayByPeriod({
      checkIn: utc("2026-07-10"),
      checkOut: utc("2026-07-12"),
      saleCurrency: Currency.KRW,
      base,
      periods: [peakSummer],
    });
    expect(q.totalSaleKrw).toBe(275_000 + 275_000);
    expect(q.totalSaleVnd).toBeUndefined();
  });
});

// ── quoteStayForVilla: VillaRatePeriod 단일 경로 (ADR-0014 Phase B — 구 VillaRate 경로 제거) ──
// ADR-0042: 엔진이 villa.premiumDays·holidayDate를 로드하므로 mock에 함께 제공(기본 프리미엄 없음).
function makeDb(
  ratePeriods: RatePeriodLike[],
  opts: { premiumDays?: number[]; holidays?: string[] } = {}
) {
  const nonBase = ratePeriods.filter((p) => !p.isBase);
  const baseRow = ratePeriods.find((p) => p.isBase) ?? null;
  const rpFindMany = vi.fn(async ({ where }: { where: { startDate: { lt: Date }; endDate: { gt: Date } } }) =>
    nonBase.filter(
      (r) => r.startDate!.getTime() < where.startDate.lt.getTime() && r.endDate!.getTime() > where.endDate.gt.getTime()
    )
  );
  const rpFindFirst = vi.fn(async () => baseRow);
  const holidayRows = (opts.holidays ?? []).map((s) => ({ date: utc(s) }));
  const holidayFindMany = vi.fn(
    async ({ where }: { where: { date: { gte: Date; lt: Date } } }) =>
      holidayRows.filter(
        (h) => h.date.getTime() >= where.date.gte.getTime() && h.date.getTime() < where.date.lt.getTime()
      )
  );
  const db = {
    villa: { findUnique: vi.fn(async () => ({ premiumDays: opts.premiumDays ?? [] })) },
    villaRatePeriod: { findFirst: rpFindFirst, findMany: rpFindMany },
    holidayDate: { findMany: holidayFindMany },
  } as unknown as DbClient;
  return { db, rpFindFirst, rpFindMany };
}

describe("pickRepresentativeRate — base 우선 대표가격 선택 (비인지 소비처 일원화)", () => {
  const lowRate = { season: SeasonType.LOW, supplierCostVnd: 1_000_000n };
  const highRate = { season: SeasonType.HIGH, supplierCostVnd: 2_000_000n };

  it("base 기간행 있으면 그것이 대표값", () => {
    const baseRP = { season: SeasonType.LOW, supplierCostVnd: 9_000_000n };
    expect(pickRepresentativeRate(baseRP, [lowRate, highRate])).toBe(baseRP);
  });
  it("base 없으면 fallback 배열 LOW 우선", () => {
    expect(pickRepresentativeRate(null, [highRate, lowRate])).toBe(lowRate);
  });
  it("base·LOW 둘 다 없으면 첫 행", () => {
    expect(pickRepresentativeRate(undefined, [highRate])).toBe(highRate);
  });
  it("아무 요율도 없으면 null", () => {
    expect(pickRepresentativeRate(null, [])).toBeNull();
  });
});

describe("representativeRatesBySeason — 시즌별 대표행(표시·경보용), HIGH/PEAK base 폴백 없음", () => {
  const baseRow = { season: SeasonType.LOW, isBase: true, supplierCostVnd: 1_000_000n };
  const highRow = { season: SeasonType.HIGH, isBase: false, supplierCostVnd: 2_000_000n };
  const peak1 = { season: SeasonType.PEAK, isBase: false, supplierCostVnd: 5_000_000n };
  const peak2 = { season: SeasonType.PEAK, isBase: false, supplierCostVnd: 8_000_000n };

  it("LOW=base, HIGH/PEAK=해당 시즌 기간", () => {
    const rep = representativeRatesBySeason([baseRow, highRow, peak1]);
    expect(rep.LOW).toBe(baseRow);
    expect(rep.HIGH).toBe(highRow);
    expect(rep.PEAK).toBe(peak1);
  });
  it("SHOULDER 기간 포함 시 rep.SHOULDER 반환 (T-season-shoulder)", () => {
    const shoulderRow = { season: SeasonType.SHOULDER, isBase: false, supplierCostVnd: 2_000_000n };
    const rep = representativeRatesBySeason([baseRow, shoulderRow, highRow, peak1]);
    expect(rep.SHOULDER).toBe(shoulderRow);
    expect(rep.HIGH).toBe(highRow);
    expect(rep.PEAK).toBe(peak1);
  });
  it("HIGH/PEAK 기간 없으면 그 키 미포함 (base 폴백 금지 — 비수기 원가를 성수기로 오표시 방지)", () => {
    const rep = representativeRatesBySeason([baseRow]);
    expect(rep.LOW).toBe(baseRow);
    expect(rep.HIGH).toBeUndefined();
    expect(rep.PEAK).toBeUndefined();
  });
  it("같은 시즌 다중 기간이면 첫 기간만 대표", () => {
    const rep = representativeRatesBySeason([baseRow, peak1, peak2]);
    expect(rep.PEAK).toBe(peak1);
    expect(rep.HIGH).toBeUndefined();
  });
  it("base 없으면 LOW도 미포함 (빈 요율 빌라)", () => {
    const rep = representativeRatesBySeason([highRow]);
    expect(rep.LOW).toBeUndefined();
    expect(rep.HIGH).toBe(highRow);
  });
});

describe("quoteStayForVilla — ADR-0014 단일 경로", () => {
  it("base + 교차 기간으로 박별 합산 (구 VillaRate/SeasonPeriod 미조회)", async () => {
    const { db } = makeDb([base, peakSummer]);
    const q = await quoteStayForVilla(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") }, Currency.VND);
    // 7/9 base, 7/10 peakSummer, 7/11 peakSummer
    expect(q.totalSaleVnd).toBe(1_200_000n + 5_500_000n + 5_500_000n);
  });
  it("base 없으면 MissingBaseRateError", async () => {
    const { db } = makeDb([peakSummer]); // base 없음
    await expect(
      quoteStayForVilla(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") }, Currency.VND)
    ).rejects.toThrow(MissingBaseRateError);
  });
});

// ── ADR-0042 프리미엄일(요일·공휴일) 2단 요금 ──
// UTC 요일(getUTCDay): 2026-07-09=목(4) 07-10=금(5) 07-11=토(6) 07-12=일(0) 07-13=월(1) 07-08=수(3)
const premiumBase: RatePeriodLike = {
  season: SeasonType.LOW,
  isBase: true,
  startDate: null,
  endDate: null,
  supplierCostVnd: 1_000_000n,
  salePriceVnd: 1_200_000n,
  salePriceKrw: 60_000,
  premiumSupplierCostVnd: 1_500_000n,
  premiumSalePriceVnd: 1_800_000n,
  premiumSalePriceKrw: 90_000,
  premiumConsumerSalePriceVnd: 2_000_000n,
  premiumConsumerSalePriceKrw: 100_000,
};

describe("quoteStayByPeriod — ADR-0042 프리미엄 (요일·공휴일)", () => {
  it("① 금·토 박에 프리미엄가 적용, 평일 박은 평일가 (VND)", () => {
    // 07-09(목·평일) 07-10(금·프) 07-11(토·프)
    const q = quoteStayByPeriod({
      checkIn: utc("2026-07-09"),
      checkOut: utc("2026-07-12"),
      saleCurrency: Currency.VND,
      base: premiumBase,
      periods: [],
      premiumDays: [5, 6],
    });
    expect(q.totalSaleVnd).toBe(1_200_000n + 1_800_000n + 1_800_000n);
    expect(q.totalSupplierCostVnd).toBe(1_000_000n + 1_500_000n + 1_500_000n);
    expect(q.nightly.map((n) => n.premium)).toEqual([undefined, "WEEKDAY_RULE", "WEEKDAY_RULE"]);
  });

  it("② 공휴일 박(평일이지만 목록에 있음)에 프리미엄가 적용, 사유=HOLIDAY", () => {
    // 07-08(수·평일이지만 공휴일 지정)
    const q = quoteStayByPeriod({
      checkIn: utc("2026-07-08"),
      checkOut: utc("2026-07-09"),
      saleCurrency: Currency.VND,
      base: premiumBase,
      periods: [],
      premiumDays: [5, 6],
      holidayDates: [utc("2026-07-08")],
    });
    expect(q.totalSaleVnd).toBe(1_800_000n);
    expect(q.nightly[0].premium).toBe("HOLIDAY");
  });

  it("③ premium* 전부 null이면 결과 완전 불변(회귀) — premiumDays/공휴일 지정해도 평일가", () => {
    const range = { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") };
    const noPremium = quoteStayByPeriod({ ...range, saleCurrency: Currency.VND, base, periods: [] });
    const withFlags = quoteStayByPeriod({
      ...range,
      saleCurrency: Currency.VND,
      base, // premium* 컬럼 없음
      periods: [],
      premiumDays: [5, 6],
      holidayDates: [utc("2026-07-10")],
    });
    // 금액은 완전 동일(컬럼 폴백). 사유 플래그만 표기됨(가격 영향 0).
    expect(withFlags.totalSaleVnd).toBe(noPremium.totalSaleVnd);
    expect(withFlags.totalSupplierCostVnd).toBe(noPremium.totalSupplierCostVnd);
  });

  it("④ 컬럼 단위 폴백 — premiumSalePriceVnd만 설정 시 KRW는 평일가", () => {
    const partial: RatePeriodLike = {
      ...base,
      premiumSalePriceVnd: 1_800_000n, // VND 프리미엄만
      // premiumSalePriceKrw 미설정 → KRW는 평일가 폴백
    };
    const range = { checkIn: utc("2026-07-11"), checkOut: utc("2026-07-12") }; // 토(프리미엄) 1박
    const vnd = quoteStayByPeriod({ ...range, saleCurrency: Currency.VND, base: partial, periods: [], premiumDays: [6] });
    const krw = quoteStayByPeriod({ ...range, saleCurrency: Currency.KRW, base: partial, periods: [], premiumDays: [6] });
    expect(vnd.totalSaleVnd).toBe(1_800_000n); // 프리미엄 VND
    expect(krw.totalSaleKrw).toBe(60_000); // 평일 KRW 폴백(premiumSalePriceKrw null)
  });

  it("⑤ CONSUMER 계층 × 프리미엄 — premiumConsumer 설정 시 소비자 프리미엄가", () => {
    const range = { checkIn: utc("2026-07-11"), checkOut: utc("2026-07-12") }; // 토 1박
    const q = quoteStayByPeriod({
      ...range,
      saleCurrency: Currency.VND,
      base: premiumBase,
      periods: [],
      priceTier: "CONSUMER",
      premiumDays: [6],
    });
    expect(q.totalSaleVnd).toBe(2_000_000n); // premiumConsumerSalePriceVnd
  });

  it("⑤b CONSUMER × 프리미엄 폴백 — premiumConsumer=null·consumer=Net보다 큼 → 평일 소비자가(역전 방지)", () => {
    // ADR §2 예시: premiumConsumer=null, consumer=130k(평일), premiumNet=110k → CONSUMER는 130k
    const row: RatePeriodLike = {
      ...base,
      consumerSalePriceVnd: 130_000n,
      premiumSalePriceVnd: 110_000n, // 프리미엄 Net(평일 소비자가보다 낮음)
      premiumConsumerSalePriceVnd: null,
    };
    const range = { checkIn: utc("2026-07-11"), checkOut: utc("2026-07-12") };
    const q = quoteStayByPeriod({
      ...range,
      saleCurrency: Currency.VND,
      base: row,
      periods: [],
      priceTier: "CONSUMER",
      premiumDays: [6],
    });
    // 유효행 consumer = premiumConsumer(null) ?? consumer(130k)=130k, Net=premiumNet 110k → CONSUMER=130k
    expect(q.totalSaleVnd).toBe(130_000n);
  });

  it("⑥ premiumDays 빈 배열 + 공휴일만 — 요일 프리미엄 없음, 공휴일 박만 프리미엄", () => {
    // 07-10(금)·07-11(토) 모두 요일 프리미엄 대상이지만 premiumDays=[] → 공휴일(07-10)만 프리미엄
    const q = quoteStayByPeriod({
      checkIn: utc("2026-07-10"),
      checkOut: utc("2026-07-12"),
      saleCurrency: Currency.VND,
      base: premiumBase,
      periods: [],
      premiumDays: [],
      holidayDates: [utc("2026-07-10")],
    });
    expect(q.nightly.map((n) => n.premium)).toEqual(["HOLIDAY", undefined]);
    expect(q.totalSaleVnd).toBe(1_800_000n + 1_200_000n); // 공휴일 프리미엄 + 평일
  });
});

describe("quoteStayForVilla — ADR-0042 프리미엄 로드(villa.premiumDays·holidayDate)", () => {
  it("빌라 premiumDays로 프리미엄 박 판정 (금·토)", async () => {
    const { db } = makeDb([premiumBase], { premiumDays: [5, 6] });
    // 07-09(목) 07-10(금·프) 07-11(토·프)
    const q = await quoteStayForVilla(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") }, Currency.VND);
    expect(q.totalSaleVnd).toBe(1_200_000n + 1_800_000n + 1_800_000n);
  });
  it("공휴일 로드 — 평일 공휴일 박도 프리미엄", async () => {
    const { db } = makeDb([premiumBase], { premiumDays: [], holidays: ["2026-07-09"] });
    const q = await quoteStayForVilla(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-10") }, Currency.VND);
    expect(q.totalSaleVnd).toBe(1_800_000n);
    expect(q.nightly[0].premium).toBe("HOLIDAY");
  });
});
