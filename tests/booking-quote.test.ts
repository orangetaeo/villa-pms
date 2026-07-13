import { describe, expect, it, vi } from "vitest";
import { BookingChannel, Currency, SeasonType } from "@prisma/client";
import {
  groupQuoteRows,
  buildBookingQuote,
  BookingQuoteRejectedError,
  type BookingQuoteResult,
} from "@/lib/booking-quote";
import { MissingBaseRateError, type NightQuote, type RatePeriodLike } from "@/lib/pricing";
import { serializeBigInt } from "@/lib/serialize";
import type { DbClient } from "@/lib/availability";

// 관리자 예약 견적(admin-manual-booking 후속 확장 2) — 그룹핑 순수함수 + buildBookingQuote DB층.
// quoteStayForVilla는 pricing 테스트가 커버하므로 여기선 견적 조립(그룹·총액·마진·USD·에러)에 집중.
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
const peakSummer: RatePeriodLike = {
  season: SeasonType.PEAK,
  isBase: false,
  startDate: utc("2026-07-10"),
  endDate: utc("2026-07-20"),
  supplierCostVnd: 4_500_000n,
  salePriceVnd: 5_500_000n,
  salePriceKrw: 275_000,
};

/**
 * villa 존재 + villaRatePeriod(base/기간) + appSetting(환율) mock DB.
 * appSetting은 키별로 응답 — FX_VND_PER_KRW=fx, FX_VND_PER_USD=fxUsd, FX_MODE=fxMode.
 * (유효 환율 해석(getEffectiveFx*)이 여러 키를 조회하므로 키 인지 필요 — 후속확장 3)
 */
function makeDb(opts: {
  villaExists?: boolean;
  ratePeriods?: RatePeriodLike[];
  fx?: string | null;
  fxUsd?: string | null;
  fxMode?: "MANUAL" | "AUTO" | null;
}) {
  const {
    villaExists = true,
    ratePeriods = [base, peakSummer],
    fx = null,
    fxUsd = null,
    fxMode = null,
  } = opts;
  const nonBase = ratePeriods.filter((p) => !p.isBase);
  const baseRow = ratePeriods.find((p) => p.isBase) ?? null;
  const settings: Record<string, string | null> = {
    FX_VND_PER_KRW: fx,
    FX_VND_PER_USD: fxUsd,
    FX_MODE: fxMode,
  };
  const db = {
    villa: {
      findUnique: vi.fn(async () => (villaExists ? { id: "v1" } : null)),
    },
    villaRatePeriod: {
      findFirst: vi.fn(async () => baseRow),
      findMany: vi.fn(
        async ({ where }: { where: { startDate: { lt: Date }; endDate: { gt: Date } } }) =>
          nonBase.filter(
            (r) =>
              r.startDate!.getTime() < where.startDate.lt.getTime() &&
              r.endDate!.getTime() > where.endDate.gt.getTime()
          )
      ),
    },
    appSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const v = settings[where.key];
        return v == null ? null : { value: v };
      }),
    },
    // ADR-0042: 엔진이 교차 공휴일을 로드(프리미엄 없는 기본 목)
    holidayDate: { findMany: vi.fn(async () => []) },
  } as unknown as DbClient;
  return db;
}

describe("groupQuoteRows — 연속 동일 요율 그룹핑", () => {
  it("같은 시즌·가격·원가 연속 밤은 한 행으로 합산(VND)", () => {
    const nightly: NightQuote[] = [
      { date: utc("2026-05-01"), season: SeasonType.LOW, saleVnd: 1_200_000n, costVnd: 1_000_000n },
      { date: utc("2026-05-02"), season: SeasonType.LOW, saleVnd: 1_200_000n, costVnd: 1_000_000n },
      { date: utc("2026-05-03"), season: SeasonType.LOW, saleVnd: 1_200_000n, costVnd: 1_000_000n },
    ];
    const rows = groupQuoteRows(nightly, "VND");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "LOW",
      nights: 3,
      saleVndPerNight: 1_200_000n,
      costVndPerNight: 1_000_000n,
    });
    expect(rows[0].saleKrwPerNight).toBeUndefined();
  });

  it("시즌 경계로 요율이 바뀌면 행이 나뉜다(base→PEAK→base = 3행)", () => {
    const nightly: NightQuote[] = [
      { date: utc("2026-07-09"), season: SeasonType.LOW, saleVnd: 1_200_000n, costVnd: 1_000_000n },
      { date: utc("2026-07-10"), season: SeasonType.PEAK, saleVnd: 5_500_000n, costVnd: 4_500_000n },
      { date: utc("2026-07-11"), season: SeasonType.PEAK, saleVnd: 5_500_000n, costVnd: 4_500_000n },
      { date: utc("2026-07-20"), season: SeasonType.LOW, saleVnd: 1_200_000n, costVnd: 1_000_000n },
    ];
    const rows = groupQuoteRows(nightly, "VND");
    expect(rows.map((r) => [r.label, r.nights])).toEqual([
      ["LOW", 1],
      ["PEAK", 2],
      ["LOW", 1],
    ]);
  });

  it("KRW 표시는 saleKrw만, saleVnd는 비움", () => {
    const nightly: NightQuote[] = [
      { date: utc("2026-05-01"), season: SeasonType.LOW, saleKrw: 60_000, costVnd: 1_000_000n },
      { date: utc("2026-05-02"), season: SeasonType.LOW, saleKrw: 60_000, costVnd: 1_000_000n },
    ];
    const rows = groupQuoteRows(nightly, "KRW");
    expect(rows).toHaveLength(1);
    expect(rows[0].saleKrwPerNight).toBe(60_000);
    expect(rows[0].saleVndPerNight).toBeUndefined();
    expect(rows[0].costVndPerNight).toBe(1_000_000n);
  });
});

describe("buildBookingQuote — VND 채널", () => {
  it("총 판매가·원가·마진 합산 (fx 무관, VND 실판매가)", async () => {
    const db = makeDb({ ratePeriods: [base, peakSummer] });
    // 7/9 base, 7/10 peak, 7/11 peak = 3박
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") },
      Currency.VND,
      BookingChannel.TRAVEL_AGENCY
    );
    expect(q.nights).toBe(3);
    expect(q.saleCurrency).toBe(Currency.VND);
    expect(q.manual).toBeUndefined();
    expect(q.totalSaleVnd).toBe(1_200_000n + 5_500_000n + 5_500_000n);
    expect(q.totalCostVnd).toBe(1_000_000n + 4_500_000n + 4_500_000n);
    // 마진 = 판매 - 원가 (VND는 fx 불필요)
    expect(q.marginVnd).toBe(q.totalSaleVnd! - q.totalCostVnd);
    expect(q.totalSaleKrw).toBeUndefined();
    // 행 그룹: base 1박 + peak 2박
    expect(q.rows.map((r) => [r.label, r.nights])).toEqual([
      ["LOW", 1],
      ["PEAK", 2],
    ]);
  });
});

describe("buildBookingQuote — KRW 채널 (fx로 마진 환산)", () => {
  it("fx 있으면 marginVnd = KRW판매가 환산 - 원가", async () => {
    const db = makeDb({ ratePeriods: [base], fx: "18.0000" }); // 1 KRW = 18 VND
    // 5/1~5/3 = 2박, base salePriceKrw 60,000 → 총 120,000 KRW
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.KRW,
      BookingChannel.DIRECT
    );
    expect(q.totalSaleKrw).toBe(120_000);
    expect(q.totalSaleVnd).toBeUndefined();
    expect(q.fxVndPerKrw).toBe("18.0000");
    // 120,000 KRW × 18 = 2,160,000 VND, 원가 2,000,000 → 마진 160,000
    expect(q.marginVnd).toBe(2_160_000n - 2_000_000n);
  });

  it("fx 미설정이면 marginVnd = null (환산 불가)", async () => {
    const db = makeDb({ ratePeriods: [base], fx: null });
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.KRW,
      BookingChannel.DIRECT
    );
    expect(q.totalSaleKrw).toBe(120_000);
    expect(q.marginVnd).toBeNull();
    expect(q.fxVndPerKrw).toBeNull();
  });
});

describe("buildBookingQuote — USD manual (참조 VND 견적)", () => {
  it("manual:true + VND 참조 총액 + 마진, fx 있으면 KRW 환산 총액", async () => {
    const db = makeDb({ ratePeriods: [base], fx: "18.0000" });
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.USD,
      BookingChannel.DIRECT
    );
    expect(q.manual).toBe(true);
    expect(q.saleCurrency).toBe(Currency.USD);
    // VND 참조 총액 = base salePriceVnd 1.2M × 2박
    expect(q.totalSaleVnd).toBe(2_400_000n);
    expect(q.totalCostVnd).toBe(2_000_000n);
    expect(q.marginVnd).toBe(2_400_000n - 2_000_000n);
    // fx 있으면 KRW 참조 환산 총액 제공 (2.4M / 18 = 133,333 반올림)
    expect(q.totalSaleKrw).toBe(Math.round(2_400_000 / 18));
    // 행은 VND 참조 판매가 표시
    expect(q.rows[0].saleVndPerNight).toBe(1_200_000n);
    expect(q.rows[0].saleKrwPerNight).toBeUndefined();
  });

  it("fx 미설정이면 KRW 환산 총액 없음, VND 참조 마진은 유지", async () => {
    const db = makeDb({ ratePeriods: [base], fx: null });
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.USD
    );
    expect(q.manual).toBe(true);
    expect(q.totalSaleKrw).toBeUndefined();
    expect(q.marginVnd).toBe(2_400_000n - 2_000_000n);
  });
});

describe("buildBookingQuote — USD 자동 제안 (유효 USD 환율)", () => {
  it("USD 환율 있으면 totalSaleUsd 자동(총액 반올림) + fxVndPerUsd, manual 제거", async () => {
    // 2박 base salePriceVnd 1.2M → 참조 총액 2.4M VND. 1$=26,000₫ → 2.4M/26,000 = 92.3 → $92
    const db = makeDb({ ratePeriods: [base], fxUsd: "26000", fx: "18.0000" });
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.USD,
      BookingChannel.DIRECT
    );
    expect(q.manual).toBeUndefined(); // 자동 제안 성공 → manual 아님
    expect(q.totalSaleVnd).toBe(2_400_000n); // VND 참조 총액(마진 기준)
    expect(q.totalSaleUsd).toBe(Math.round(2_400_000 / 26000)); // 92
    expect(q.fxVndPerUsd).toBe("26000");
    expect(q.marginVnd).toBe(2_400_000n - 2_000_000n);
    // rows는 VND 참조 유지(박별합≠총액 혼동 방지) — saleUsdPerNight 없음
    expect(q.rows[0].saleVndPerNight).toBe(1_200_000n);
    // KRW 참조 환산 총액도 함께(유효 KRW 환율 있으면)
    expect(q.totalSaleKrw).toBe(Math.round(2_400_000 / 18));
  });

  it("USD 환율 없으면 기존 manual 폴백(totalSaleUsd·fxVndPerUsd 미포함)", async () => {
    const db = makeDb({ ratePeriods: [base], fxUsd: null });
    const q = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.USD
    );
    expect(q.manual).toBe(true);
    expect(q.totalSaleUsd).toBeUndefined();
    expect(q.fxVndPerUsd).toBeUndefined();
  });
});

describe("buildBookingQuote — 에러 경로", () => {
  it("빌라 없음 → BookingQuoteRejectedError(VILLA_NOT_FOUND)", async () => {
    const db = makeDb({ villaExists: false });
    await expect(
      buildBookingQuote(db, "nope", { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") }, Currency.VND)
    ).rejects.toBeInstanceOf(BookingQuoteRejectedError);
  });

  it("요율(base) 미설정 → MissingBaseRateError (라우트 409 RATE_NOT_SET)", async () => {
    const db = makeDb({ ratePeriods: [peakSummer] }); // base 없음
    await expect(
      buildBookingQuote(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") }, Currency.VND)
    ).rejects.toBeInstanceOf(MissingBaseRateError);
  });
});

describe("BigInt 직렬화 (응답 계약)", () => {
  it("serializeBigInt가 VND·마진·행 원가를 문자열로 변환", async () => {
    const db = makeDb({ ratePeriods: [base], fx: "18.0000" });
    const q: BookingQuoteResult = await buildBookingQuote(
      db,
      "v1",
      { checkIn: utc("2026-05-01"), checkOut: utc("2026-05-03") },
      Currency.VND,
      BookingChannel.TRAVEL_AGENCY
    );
    const json = serializeBigInt(q) as Record<string, unknown>;
    expect(json.totalSaleVnd).toBe("2400000");
    expect(json.totalCostVnd).toBe("2000000");
    expect(json.marginVnd).toBe("400000");
    expect(json.fxVndPerKrw).toBe("18.0000");
    const rows = json.rows as Array<Record<string, unknown>>;
    expect(rows[0].saleVndPerNight).toBe("1200000");
    expect(rows[0].costVndPerNight).toBe("1000000");
    // 직렬화 결과가 JSON.stringify 가능해야 함(BigInt 잔존 없음)
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});
