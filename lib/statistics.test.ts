import { describe, expect, it } from "vitest";
import { Currency, type PrismaClient } from "@prisma/client";
import {
  conversionRate,
  changeRate,
  resolveStatsPeriod,
  loadMinibarStats,
  loadServiceOrderStats,
  loadOverviewStats,
  toVndAmount,
  toKrwAmount,
  toFinanceBooking,
  toFinanceBlock,
  type FinanceSourceRow,
  type StatsPeriod,
} from "@/lib/statistics";
import { summarizeFinance } from "@/lib/settlement-finance";

const NOW = new Date("2026-06-15T12:00:00.000Z"); // VN 기준 2026-06-15

// ===================================================================
// 작업 A — resolveStatsPeriod (프리셋·커스텀·all·granularity·previous)
// ===================================================================
describe("resolveStatsPeriod — 기간 v2 해석", () => {
  it("미지정/무효 → thisMonth (프리셋 키 설정)", () => {
    const p = resolveStatsPeriod({}, NOW);
    expect(p.presetKey).toBe("thisMonth");
    expect(p.from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-07-01T00:00:00.000Z"); // 배타
    expect(p.fromText).toBe("2026-06-01");
    expect(p.toText).toBe("2026-06-30"); // 포함 표시일(=to−1)
    expect(p.granularity).toBe("day"); // 30일 ≤ 92
    expect(p.buckets).toHaveLength(30);
    expect(p.buckets[0].label).toBe("06-01");
  });

  it("무효 range 문자열도 thisMonth 폴백", () => {
    expect(resolveStatsPeriod({ range: "garbage" }, NOW).presetKey).toBe("thisMonth");
    // nextMonth는 통계 제외 → 프리셋으로 인정 안 함 → thisMonth 폴백
    expect(resolveStatsPeriod({ range: "nextMonth" }, NOW).presetKey).toBe("thisMonth");
  });

  it("today/yesterday → 단일일·버킷1·granularity day", () => {
    const today = resolveStatsPeriod({ range: "today" }, NOW);
    expect(today.from.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(today.to.toISOString()).toBe("2026-06-16T00:00:00.000Z");
    expect(today.granularity).toBe("day");
    expect(today.buckets).toHaveLength(1);
    expect(today.toText).toBe("2026-06-15");

    const y = resolveStatsPeriod({ range: "yesterday" }, NOW);
    expect(y.from.toISOString()).toBe("2026-06-14T00:00:00.000Z");
    expect(y.to.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(y.buckets).toHaveLength(1);
  });

  it("커스텀 from·to 우선(포함일 → 배타 +1), range 무시", () => {
    const p = resolveStatsPeriod(
      { range: "today", from: "2026-03-01", to: "2026-03-10" },
      NOW
    );
    expect(p.presetKey).toBeNull(); // 커스텀이면 null
    expect(p.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-03-11T00:00:00.000Z"); // 10일 포함 → +1
    expect(p.toText).toBe("2026-03-10");
    expect(p.granularity).toBe("day"); // 10일
    expect(p.buckets).toHaveLength(10);
  });

  it("커스텀 단일일(from=to) → 버킷1", () => {
    const p = resolveStatsPeriod({ from: "2026-03-05", to: "2026-03-05" }, NOW);
    expect(p.from.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-03-06T00:00:00.000Z");
    expect(p.buckets).toHaveLength(1);
  });

  it("granularity 경계: 92일 → day, 93일 → month", () => {
    // [from, to) 길이 = 92일 → day
    const d92 = resolveStatsPeriod({ from: "2026-01-01", to: "2026-04-02" }, NOW); // to 포함 → +1 = 04-03 배타. span= 92
    expect(
      Math.round((d92.to.getTime() - d92.from.getTime()) / 86_400_000)
    ).toBe(92);
    expect(d92.granularity).toBe("day");
    expect(d92.buckets).toHaveLength(92);

    // 93일 → month
    const d93 = resolveStatsPeriod({ from: "2026-01-01", to: "2026-04-03" }, NOW); // span 93
    expect(
      Math.round((d93.to.getTime() - d93.from.getTime()) / 86_400_000)
    ).toBe(93);
    expect(d93.granularity).toBe("month");
    // 월 버킷: 2026-01, 02, 03, 04 (클리핑)
    expect(d93.buckets.map((b) => b.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    // 첫 버킷 start=from, 마지막 버킷 end=to(클리핑)
    expect(d93.buckets[0].start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(d93.buckets[3].end.toISOString()).toBe(d93.to.toISOString());
  });

  it("previous: 직전 동일 길이 창 [from−span, from)", () => {
    const p = resolveStatsPeriod({ from: "2026-03-11", to: "2026-03-20" }, NOW); // span 10
    expect(p.previous).not.toBeNull();
    expect(p.previous!.to.toISOString()).toBe("2026-03-11T00:00:00.000Z"); // = from
    expect(p.previous!.from.toISOString()).toBe("2026-03-01T00:00:00.000Z"); // from − 10일
  });

  it("'all' → previous null, to=내일, from≈데이터 최소일", () => {
    const floor = new Date("2025-09-10T00:00:00.000Z");
    const p = resolveStatsPeriod({ range: "all" }, NOW, floor);
    expect(p.presetKey).toBe("all");
    expect(p.previous).toBeNull();
    expect(p.to.toISOString()).toBe("2026-06-16T00:00:00.000Z"); // 내일(VN 06-15 + 1)
    expect(p.from.toISOString()).toBe("2025-09-10T00:00:00.000Z");
    expect(p.granularity).toBe("month"); // 280여 일 → month
  });

  it("'all' + 데이터 없음 → from = to − 1개월", () => {
    const p = resolveStatsPeriod({ range: "all" }, NOW, null);
    expect(p.to.toISOString()).toBe("2026-06-16T00:00:00.000Z");
    expect(p.from.toISOString()).toBe("2026-05-16T00:00:00.000Z"); // to − 1개월
    expect(p.previous).toBeNull();
  });
});

// ===================================================================
// ② 전환율 (0건 분모 무오류)
// ===================================================================
describe("conversionRate — 전환율 (② 0건 분모 무오류)", () => {
  it("정상 비율 (소수 1자리)", () => {
    expect(conversionRate(3, 4)).toBe(75);
    expect(conversionRate(1, 3)).toBe(33.3);
  });
  it("분모 0이면 0 (÷0 무오류)", () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(5, 0)).toBe(0);
  });
  it("분모 음수도 0", () => {
    expect(conversionRate(2, -1)).toBe(0);
  });
});

describe("changeRate — 전월 대비 증감", () => {
  it("증가/감소율", () => {
    expect(changeRate(120, 100)).toBe(20);
    expect(changeRate(80, 100)).toBe(-20);
  });
  it("이전값 0이면 null (÷0 방지)", () => {
    expect(changeRate(50, 0)).toBeNull();
  });
});

// ===================================================================
// ① 통화 분리 (KRW·VND가 한 숫자로 합산 안 됨)
// ===================================================================
describe("통화 분리 — KRW·VND 합산 금지 (①)", () => {
  const rows: FinanceSourceRow[] = [
    // KRW 채널(DIRECT) — 환율 스냅샷 있음
    {
      saleCurrency: Currency.KRW,
      totalSaleKrw: 1_000_000,
      totalSaleVnd: null,
      supplierCostVnd: 15_000_000n,
      fxVndPerKrw: { toString: () => "18.5000" },
    },
    // VND 채널(여행사) — 동일 통화
    {
      saleCurrency: Currency.VND,
      totalSaleKrw: null,
      totalSaleVnd: 30_000_000n,
      supplierCostVnd: 20_000_000n,
      fxVndPerKrw: null,
    },
  ];

  it("collectedKrw·collectedVnd가 서로 다른 필드로 분리 집계", () => {
    const s = summarizeFinance(rows.map(toFinanceBooking));
    expect(s.collectedKrw).toBe(1_000_000); // KRW만
    expect(s.collectedVnd).toBe(30_000_000n); // VND만
    // 두 값을 더한 단일 숫자가 어디에도 없음 — 구조적으로 분리
  });

  it("toFinanceBlock — KRW·VND·마진이 각자 필드로 직렬화(합산 없음)", () => {
    const block = toFinanceBlock(summarizeFinance(rows.map(toFinanceBooking)));
    expect(block.krwRevenue).toBe(1_000_000);
    expect(block.krwRevenueText).toBe("1,000,000원");
    expect(block.vndRevenue).toBe(30_000_000);
    expect(block.vndRevenueText).toBe("30,000,000₫");
    // krw와 vnd 필드가 별개 — 합산 키 없음
    expect(Object.keys(block)).not.toContain("totalRevenue");
  });
});

// ===================================================================
// ④ 마진 환산 위임 (summarizeFinance 결과 정합)
// ===================================================================
describe("마진 환산 — summarizeFinance 위임 정합 (④)", () => {
  it("KRW 채널: round(krw × fx) − cost = 환산 마진", () => {
    // 1,000,000 KRW × 18.5 = 18,500,000 VND − cost 15,000,000 = margin 3,500,000
    const row: FinanceSourceRow = {
      saleCurrency: Currency.KRW,
      totalSaleKrw: 1_000_000,
      totalSaleVnd: null,
      supplierCostVnd: 15_000_000n,
      fxVndPerKrw: { toString: () => "18.5000" },
    };
    const s = summarizeFinance([toFinanceBooking(row)]);
    expect(s.collectedVndEquivalent).toBe(18_500_000n);
    expect(s.marginVnd).toBe(3_500_000n);
    const block = toFinanceBlock(s);
    expect(block.marginVnd).toBe(3_500_000);
    expect(block.marginVndText).toBe("3,500,000₫");
    // 마진율 = 3.5M / 18.5M × 100 ≈ 18.9%
    expect(block.marginRatePct).toBe(18.9);
  });

  it("VND 채널: 동일 통화 직접 차감", () => {
    const row: FinanceSourceRow = {
      saleCurrency: Currency.VND,
      totalSaleKrw: null,
      totalSaleVnd: 30_000_000n,
      supplierCostVnd: 20_000_000n,
      fxVndPerKrw: null,
    };
    const s = summarizeFinance([toFinanceBooking(row)]);
    expect(s.marginVnd).toBe(10_000_000n);
  });

  it("환율 미기록 KRW 예약은 마진 제외 + fxMissingCount 집계", () => {
    const row: FinanceSourceRow = {
      saleCurrency: Currency.KRW,
      totalSaleKrw: 1_000_000,
      totalSaleVnd: null,
      supplierCostVnd: 15_000_000n,
      fxVndPerKrw: null, // 스냅샷 없음
    };
    const block = toFinanceBlock(summarizeFinance([toFinanceBooking(row)]));
    expect(block.fxMissingCount).toBe(1);
    expect(block.marginVnd).toBe(0); // 환산 불가 제외
    expect(block.marginRatePct).toBeNull(); // 환산 합 0 → null
  });

  it("역마진(음수) 보존 + -프리픽스 표기", () => {
    const row: FinanceSourceRow = {
      saleCurrency: Currency.VND,
      totalSaleKrw: null,
      totalSaleVnd: 10_000_000n,
      supplierCostVnd: 15_000_000n, // 원가 > 판매가
      fxVndPerKrw: null,
    };
    const block = toFinanceBlock(summarizeFinance([toFinanceBooking(row)]));
    expect(block.marginVnd).toBe(-5_000_000);
    expect(block.marginVndText).toBe("-5,000,000₫");
  });
});

describe("toVndAmount / toKrwAmount — 직렬화 쌍", () => {
  it("VND: number + 포맷 문자열", () => {
    expect(toVndAmount(86_200_000n)).toEqual({ vnd: 86_200_000, vndText: "86,200,000₫" });
  });
  it("음수 VND", () => {
    expect(toVndAmount(-1_000n)).toEqual({ vnd: -1000, vndText: "-1,000₫" });
  });
  it("KRW: number + 원 표기", () => {
    expect(toKrwAmount(12_450_000)).toEqual({ krw: 12_450_000, krwText: "12,450,000원" });
  });
});

// ===================================================================
// ⑤ 빈 데이터(0건) 무오류
// ===================================================================
describe("빈 데이터 (0건) 무오류 (⑤)", () => {
  it("summarizeFinance([]) → 0 합계, 마진율 null", () => {
    const block = toFinanceBlock(summarizeFinance([]));
    expect(block.krwRevenue).toBe(0);
    expect(block.vndRevenue).toBe(0);
    expect(block.marginVnd).toBe(0);
    expect(block.fxMissingCount).toBe(0);
    expect(block.marginRatePct).toBeNull();
  });

  it("conversionRate(0, 0) → 0 (전환 깔때기 0건)", () => {
    expect(conversionRate(0, 0)).toBe(0);
  });

  it("toVndAmount(0n) → 0₫", () => {
    expect(toVndAmount(0n)).toEqual({ vnd: 0, vndText: "0₫" });
  });
});

// ===================================================================
// 작업 C — loadMinibarStats (매출·top·마진·costMissingCount)
// ===================================================================
interface MockLine {
  nameKo: string;
  consumedQty: number;
  lineVnd: bigint;
  costVnd: bigint | null;
  lineCostVnd: bigint | null;
  checkOut: Date; // booking.checkOut
}

/** loadMinibarStats용 mock db — findMany가 checkoutMinibarLine을 반환(중첩 select 형태로 래핑) */
function mockDb(lines: MockLine[]): PrismaClient {
  return {
    checkoutMinibarLine: {
      findMany: async () =>
        lines.map((l) => ({
          nameKo: l.nameKo,
          consumedQty: l.consumedQty,
          lineVnd: l.lineVnd,
          costVnd: l.costVnd,
          lineCostVnd: l.lineCostVnd,
          checkOutRecord: { booking: { checkOut: l.checkOut } },
        })),
    },
  } as unknown as PrismaClient;
}

describe("loadMinibarStats — 미니바 통계 집계", () => {
  // 2026-06 전체 기간(day 버킷 30) — 체크아웃 06-05 / 06-05 / 06-20
  const period: StatsPeriod = resolveStatsPeriod({ range: "thisMonth" }, NOW);

  it("총 매출·버킷 추이·품목 top (원가 일부 입력)", async () => {
    const lines: MockLine[] = [
      // 콜라 2개 × 30,000 = 60,000 (원가 20,000/개 → lineCost 40,000) — 06-05
      { nameKo: "콜라", consumedQty: 2, lineVnd: 60_000n, costVnd: 20_000n, lineCostVnd: 40_000n, checkOut: new Date("2026-06-05T00:00:00.000Z") },
      // 물 1개 × 10,000 = 10,000 (원가 미입력) — 06-05
      { nameKo: "물", consumedQty: 1, lineVnd: 10_000n, costVnd: null, lineCostVnd: null, checkOut: new Date("2026-06-05T00:00:00.000Z") },
      // 콜라 1개 × 30,000 = 30,000 (원가 20,000 → lineCost 20,000) — 06-20
      { nameKo: "콜라", consumedQty: 1, lineVnd: 30_000n, costVnd: 20_000n, lineCostVnd: 20_000n, checkOut: new Date("2026-06-20T00:00:00.000Z") },
    ];
    const s = await loadMinibarStats(period, NOW, mockDb(lines));

    // 총 매출 = 60k + 10k + 30k = 100k
    expect(s.revenueVnd).toBe(100_000);
    expect(s.revenueVndText).toBe("100,000₫");

    // 버킷 추이 — 06-05 버킷 = 70,000, 06-20 버킷 = 30,000, 나머지 0
    const b0605 = s.trend.find((b) => b.bucketKey === "2026-06-05")!;
    const b0620 = s.trend.find((b) => b.bucketKey === "2026-06-20")!;
    expect(b0605.revenueVnd).toBe(70_000);
    expect(b0620.revenueVnd).toBe(30_000);
    expect(s.trend).toHaveLength(30); // day 버킷 30개

    // 품목 top — 콜라(90k, 3개) > 물(10k, 1개), 매출 내림차순
    expect(s.topItems.map((i) => i.nameKo)).toEqual(["콜라", "물"]);
    expect(s.topItems[0]).toMatchObject({ nameKo: "콜라", consumedQty: 3, revenueVnd: 90_000 });
    expect(s.topItems[1]).toMatchObject({ nameKo: "물", consumedQty: 1, revenueVnd: 10_000 });

    // 마진 — 원가있는 라인만: Σ lineVnd(60k+30k=90k) − Σ lineCost(40k+20k=60k) = 30,000
    expect(s.marginVnd).toBe(30_000);
    expect(s.marginVndText).toBe("30,000₫");
    // 원가 미입력 라인 = 물 1건
    expect(s.costMissingCount).toBe(1);
  });

  it("원가 전무 → margin null (\"원가 미입력\" 표기 가능)", async () => {
    const lines: MockLine[] = [
      { nameKo: "물", consumedQty: 3, lineVnd: 30_000n, costVnd: null, lineCostVnd: null, checkOut: new Date("2026-06-10T00:00:00.000Z") },
    ];
    const s = await loadMinibarStats(period, NOW, mockDb(lines));
    expect(s.revenueVnd).toBe(30_000);
    expect(s.marginVnd).toBeNull();
    expect(s.marginVndText).toBeNull();
    expect(s.costMissingCount).toBe(1);
  });

  it("역마진(음수) 보존 — 원가가 판매가보다 큼", async () => {
    const lines: MockLine[] = [
      { nameKo: "수입맥주", consumedQty: 1, lineVnd: 50_000n, costVnd: 70_000n, lineCostVnd: 70_000n, checkOut: new Date("2026-06-10T00:00:00.000Z") },
    ];
    const s = await loadMinibarStats(period, NOW, mockDb(lines));
    expect(s.marginVnd).toBe(-20_000);
    expect(s.marginVndText).toBe("-20,000₫");
    expect(s.costMissingCount).toBe(0);
  });

  it("0건 → 매출 0·top 빈배열·margin null·costMissing 0", async () => {
    const s = await loadMinibarStats(period, NOW, mockDb([]));
    expect(s.revenueVnd).toBe(0);
    expect(s.topItems).toEqual([]);
    expect(s.marginVnd).toBeNull();
    expect(s.costMissingCount).toBe(0);
    expect(s.trend.every((b) => b.revenueVnd === 0)).toBe(true);
  });
});

// ===================================================================
// ADR-0019 후속 #1 — loadServiceOrderStats (부가서비스 매출·통화분리·마진·기간필터)
// ===================================================================
interface MockOrder {
  type: string;
  priceKrw: number;
  priceVnd: bigint | null;
  costVnd: bigint;
  quantity: number;
  status: string;
  checkOut: Date; // booking.checkOut
}

/** loadServiceOrderStats용 mock db — findMany가 where(status·checkOut)로 필터링까지 흉내 */
function mockServiceDb(orders: MockOrder[]): PrismaClient {
  return {
    serviceOrder: {
      findMany: async (args: {
        where: {
          status: { in: string[] };
          booking: { checkOut: { gte: Date; lt: Date } };
        };
      }) => {
        const { status, booking } = args.where;
        return orders
          .filter(
            (o) =>
              status.in.includes(o.status) &&
              o.checkOut.getTime() >= booking.checkOut.gte.getTime() &&
              o.checkOut.getTime() < booking.checkOut.lt.getTime()
          )
          .map((o) => ({
            type: o.type,
            priceKrw: o.priceKrw,
            priceVnd: o.priceVnd,
            costVnd: o.costVnd,
            quantity: o.quantity,
            booking: { checkOut: o.checkOut },
          }));
      },
    },
  } as unknown as PrismaClient;
}

describe("loadServiceOrderStats — 부가서비스 매출 집계", () => {
  const period: StatsPeriod = resolveStatsPeriod({ range: "thisMonth" }, NOW);

  it("통화별 분리 매출·추이·타입 top (합산 금지)", async () => {
    const orders: MockOrder[] = [
      // BBQ 1건 — VND 채널 800,000 (원가 500,000) — 06-05, DELIVERED
      { type: "BBQ", priceKrw: 0, priceVnd: 800_000n, costVnd: 500_000n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-05T00:00:00.000Z") },
      // 마사지 2건 — KRW 채널 120,000원 (원가 미입력=0) — 06-05, CONFIRMED
      { type: "MASSAGE", priceKrw: 120_000, priceVnd: null, costVnd: 0n, quantity: 2, status: "CONFIRMED", checkOut: new Date("2026-06-05T00:00:00.000Z") },
      // BBQ 1건 — VND 800,000 (원가 500,000) — 06-20, CONFIRMED
      { type: "BBQ", priceKrw: 0, priceVnd: 800_000n, costVnd: 500_000n, quantity: 1, status: "CONFIRMED", checkOut: new Date("2026-06-20T00:00:00.000Z") },
    ];
    const s = await loadServiceOrderStats(period, NOW, mockServiceDb(orders));

    // 통화별 분리 합 — KRW 120,000원 / VND 1,600,000₫ (절대 합치지 않음)
    expect(s.revenueKrw).toBe(120_000);
    expect(s.revenueKrwText).toBe("120,000원");
    expect(s.revenueVnd).toBe(1_600_000);
    expect(s.revenueVndText).toBe("1,600,000₫");

    // 버킷 추이 — 06-05: KRW 120k + VND 800k, 06-20: VND 800k
    const b0605 = s.trend.find((b) => b.bucketKey === "2026-06-05")!;
    const b0620 = s.trend.find((b) => b.bucketKey === "2026-06-20")!;
    expect(b0605.revenueKrw).toBe(120_000);
    expect(b0605.revenueVnd).toBe(800_000);
    expect(b0620.revenueKrw).toBe(0);
    expect(b0620.revenueVnd).toBe(800_000);
    expect(s.trend).toHaveLength(30);

    // 타입 top — BBQ(VND 1.6M) > MASSAGE(VND 0), VND 내림차순
    expect(s.topTypes.map((r) => r.type)).toEqual(["BBQ", "MASSAGE"]);
    expect(s.topTypes[0]).toMatchObject({ type: "BBQ", quantity: 2, revenueVnd: 1_600_000, revenueKrw: 0 });
    expect(s.topTypes[1]).toMatchObject({ type: "MASSAGE", quantity: 2, revenueKrw: 120_000, revenueVnd: 0 });

    // 마진(VND만) — 원가있는 BBQ 2건: Σ priceVnd(1.6M) − Σ costVnd(1.0M) = 600,000
    expect(s.marginVnd).toBe(600_000);
    expect(s.marginVndText).toBe("600,000₫");
    // 원가 미입력 = MASSAGE 1건(costVnd=0)
    expect(s.costMissingCount).toBe(1);
  });

  it("기간 필터 — 범위 밖·취소·미확정 제외", async () => {
    const orders: MockOrder[] = [
      // 범위 안·DELIVERED → 포함
      { type: "TICKET", priceKrw: 0, priceVnd: 100_000n, costVnd: 0n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-10T00:00:00.000Z") },
      // 범위 밖(5월) → 제외
      { type: "TICKET", priceKrw: 0, priceVnd: 999_000n, costVnd: 0n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-05-10T00:00:00.000Z") },
      // 범위 안이나 REQUESTED → 제외
      { type: "GUIDE", priceKrw: 0, priceVnd: 999_000n, costVnd: 0n, quantity: 1, status: "REQUESTED", checkOut: new Date("2026-06-11T00:00:00.000Z") },
      // 범위 안이나 CANCELLED → 제외
      { type: "GUIDE", priceKrw: 0, priceVnd: 999_000n, costVnd: 0n, quantity: 1, status: "CANCELLED", checkOut: new Date("2026-06-12T00:00:00.000Z") },
    ];
    const s = await loadServiceOrderStats(period, NOW, mockServiceDb(orders));
    expect(s.revenueVnd).toBe(100_000);
    expect(s.topTypes.map((r) => r.type)).toEqual(["TICKET"]);
  });

  it("원가 전무 → margin null (\"원가 미입력\" 표기)", async () => {
    const orders: MockOrder[] = [
      { type: "BARBER", priceKrw: 0, priceVnd: 50_000n, costVnd: 0n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-10T00:00:00.000Z") },
    ];
    const s = await loadServiceOrderStats(period, NOW, mockServiceDb(orders));
    expect(s.revenueVnd).toBe(50_000);
    expect(s.marginVnd).toBeNull();
    expect(s.marginVndText).toBeNull();
    expect(s.costMissingCount).toBe(1);
  });

  it("KRW 라인은 마진서 제외 — 원가는 VND뿐(ADR-0003 환산 없음)", async () => {
    const orders: MockOrder[] = [
      // KRW 매출이지만 priceVnd 없음 → costVnd 있어도 마진 제외, costMissing
      { type: "MASSAGE", priceKrw: 100_000, priceVnd: null, costVnd: 300_000n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-10T00:00:00.000Z") },
      // VND 매출 + 원가 → 마진 산입
      { type: "BBQ", priceKrw: 0, priceVnd: 800_000n, costVnd: 500_000n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-11T00:00:00.000Z") },
    ];
    const s = await loadServiceOrderStats(period, NOW, mockServiceDb(orders));
    // 마진 = BBQ만: 800k − 500k = 300,000 (KRW 라인 환산 없이 제외)
    expect(s.marginVnd).toBe(300_000);
    expect(s.costMissingCount).toBe(1);
    expect(s.revenueKrw).toBe(100_000);
    expect(s.revenueVnd).toBe(800_000);
  });

  it("역마진(음수) 보존", async () => {
    const orders: MockOrder[] = [
      { type: "CAR_RENTAL", priceKrw: 0, priceVnd: 400_000n, costVnd: 600_000n, quantity: 1, status: "CONFIRMED", checkOut: new Date("2026-06-10T00:00:00.000Z") },
    ];
    const s = await loadServiceOrderStats(period, NOW, mockServiceDb(orders));
    expect(s.marginVnd).toBe(-200_000);
    expect(s.marginVndText).toBe("-200,000₫");
    expect(s.costMissingCount).toBe(0);
  });

  it("0건 → 매출 0·top 빈배열·margin null", async () => {
    const s = await loadServiceOrderStats(period, NOW, mockServiceDb([]));
    expect(s.revenueKrw).toBe(0);
    expect(s.revenueVnd).toBe(0);
    expect(s.topTypes).toEqual([]);
    expect(s.marginVnd).toBeNull();
    expect(s.costMissingCount).toBe(0);
    expect(s.trend.every((b) => b.revenueKrw === 0 && b.revenueVnd === 0)).toBe(true);
  });
});

// ===================================================================
// loadOverviewStats — 개요 통합(빌라 + 부가서비스 + 미니바 합산)
//   매출·마진 총계가 세 소스 합이며, KRW·VND는 통화 분리(미합산) 유지인지 검증.
// ===================================================================
interface MockBookingRow {
  status: string;
  channel: string;
  saleCurrency: Currency;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  supplierCostVnd: bigint;
  fxVndPerKrw: string | null;
  checkOut: Date;
}

/**
 * loadOverviewStats용 통합 mock db — booking·serviceOrder·checkoutMinibarLine 3개 findMany.
 * 각 findMany는 where(status·checkOut 범위)로 필터링까지 흉내(실제 쿼리 시맨틱과 동일).
 */
function mockOverviewDb(args: {
  bookings?: MockBookingRow[];
  services?: MockOrder[];
  minibar?: MockLine[];
}): PrismaClient {
  const bookings = args.bookings ?? [];
  const services = args.services ?? [];
  const minibar = args.minibar ?? [];
  return {
    booking: {
      findMany: async (q: {
        where: { status: { in: string[] }; checkOut: { gte: Date; lt: Date } };
      }) => {
        const { status, checkOut } = q.where;
        return bookings
          .filter(
            (b) =>
              status.in.includes(b.status) &&
              b.checkOut.getTime() >= checkOut.gte.getTime() &&
              b.checkOut.getTime() < checkOut.lt.getTime()
          )
          .map((b) => ({
            checkOut: b.checkOut,
            channel: b.channel,
            saleCurrency: b.saleCurrency,
            totalSaleKrw: b.totalSaleKrw,
            totalSaleVnd: b.totalSaleVnd,
            supplierCostVnd: b.supplierCostVnd,
            fxVndPerKrw: b.fxVndPerKrw,
          }));
      },
    },
    serviceOrder: {
      findMany: async (q: {
        where: {
          status: { in: string[] };
          booking: { checkOut: { gte: Date; lt: Date } };
        };
      }) => {
        const { status, booking } = q.where;
        return services
          .filter(
            (o) =>
              status.in.includes(o.status) &&
              o.checkOut.getTime() >= booking.checkOut.gte.getTime() &&
              o.checkOut.getTime() < booking.checkOut.lt.getTime()
          )
          .map((o) => ({
            priceKrw: o.priceKrw,
            priceVnd: o.priceVnd,
            costVnd: o.costVnd,
            booking: { checkOut: o.checkOut },
          }));
      },
    },
    checkoutMinibarLine: {
      findMany: async (q: {
        where: { checkOutRecord: { booking: { checkOut: { gte: Date; lt: Date } } } };
      }) => {
        const { gte, lt } = q.where.checkOutRecord.booking.checkOut;
        return minibar
          .filter((l) => l.checkOut.getTime() >= gte.getTime() && l.checkOut.getTime() < lt.getTime())
          .map((l) => ({
            lineVnd: l.lineVnd,
            costVnd: l.costVnd,
            lineCostVnd: l.lineCostVnd,
            checkOutRecord: { booking: { checkOut: l.checkOut } },
          }));
      },
    },
  } as unknown as PrismaClient;
}

describe("loadOverviewStats — 개요 통합(빌라+부가서비스+미니바)", () => {
  const period: StatsPeriod = resolveStatsPeriod({ range: "thisMonth" }, NOW);

  // 공통 빌라 예약: VND 채널 1건 — 매출 30,000,000 / 원가 20,000,000 → 마진 10,000,000 — 06-05
  const villaVnd: MockBookingRow = {
    status: "CHECKED_OUT",
    channel: "TRAVEL_AGENCY",
    saleCurrency: Currency.VND,
    totalSaleKrw: null,
    totalSaleVnd: 30_000_000n,
    supplierCostVnd: 20_000_000n,
    fxVndPerKrw: null,
    checkOut: new Date("2026-06-05T00:00:00.000Z"),
  };
  // KRW 채널 1건 — 1,000,000원 × 18.5 = 18,500,000 VND환산 / 원가 15,000,000 → 마진 3,500,000 — 06-05
  const villaKrw: MockBookingRow = {
    status: "CHECKED_OUT",
    channel: "DIRECT",
    saleCurrency: Currency.KRW,
    totalSaleKrw: 1_000_000,
    totalSaleVnd: null,
    supplierCostVnd: 15_000_000n,
    fxVndPerKrw: "18.5000",
    checkOut: new Date("2026-06-05T00:00:00.000Z"),
  };

  it("빌라-only(부가서비스·미니바 0건) = 종전 빌라 결과와 동일(회귀)", async () => {
    const db = mockOverviewDb({ bookings: [villaVnd, villaKrw] });
    const s = await loadOverviewStats(period, NOW, db);

    // 빌라만: KRW 1,000,000원 / VND 30,000,000₫ / 마진 10M+3.5M=13.5M
    expect(s.current.krwRevenue).toBe(1_000_000);
    expect(s.current.vndRevenue).toBe(30_000_000);
    expect(s.current.marginVnd).toBe(13_500_000);
    // 마진율 = 13.5M / (VND수납 30M + KRW환산 18.5M = 48.5M) × 100 ≈ 27.8%
    expect(s.current.marginRatePct).toBe(27.8);
    // 채널(빌라 기준 유지)
    const ta = s.channels.find((c) => c.channel === "TRAVEL_AGENCY")!;
    expect(ta.vndRevenue).toBe(30_000_000);
  });

  it("부가서비스·미니바가 KPI·버킷에 합산(통화 분리 유지 — KRW·VND 미합산)", async () => {
    const db = mockOverviewDb({
      bookings: [villaVnd, villaKrw],
      // 부가서비스: BBQ VND 800,000(원가 500,000)·마사지 KRW 120,000(원가 0) — 06-05
      services: [
        { type: "BBQ", priceKrw: 0, priceVnd: 800_000n, costVnd: 500_000n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-05T00:00:00.000Z") },
        { type: "MASSAGE", priceKrw: 120_000, priceVnd: null, costVnd: 0n, quantity: 1, status: "CONFIRMED", checkOut: new Date("2026-06-05T00:00:00.000Z") },
      ],
      // 미니바: 콜라 VND 60,000(원가 lineCost 40,000) — 06-05
      minibar: [
        { nameKo: "콜라", consumedQty: 2, lineVnd: 60_000n, costVnd: 20_000n, lineCostVnd: 40_000n, checkOut: new Date("2026-06-05T00:00:00.000Z") },
      ],
    });
    const s = await loadOverviewStats(period, NOW, db);

    // KRW 매출 = 빌라 1,000,000 + 부가서비스 120,000 = 1,120,000원
    expect(s.current.krwRevenue).toBe(1_120_000);
    expect(s.current.krwRevenueText).toBe("1,120,000원");
    // VND 매출 = 빌라 30,000,000 + 미니바 60,000 + 부가서비스 800,000 = 30,860,000₫
    expect(s.current.vndRevenue).toBe(30_860_000);
    expect(s.current.vndRevenueText).toBe("30,860,000₫");
    // KRW·VND가 한 숫자로 합산되지 않음(별개 필드 — 구조적 분리)
    expect(s.current.krwRevenue).not.toBe(s.current.vndRevenue);

    // 마진 = 빌라 13,500,000 + 미니바(60k−40k=20k) + 부가서비스(800k−500k=300k) = 13,820,000
    expect(s.current.marginVnd).toBe(13_820_000);
    expect(s.current.marginVndText).toBe("13,820,000₫");
    // 마진율 = 13,820,000 / (빌라환산 48.5M + 미니바 60k + 부가서비스 800k = 49,360,000) × 100 ≈ 28.0%
    expect(s.current.marginRatePct).toBe(28);

    // 버킷 추이 — 06-05 버킷에 세 소스 합산 반영
    const b0605 = s.trend.find((b) => b.bucketKey === "2026-06-05")!;
    expect(b0605.krwRevenue).toBe(1_120_000);
    expect(b0605.vndRevenue).toBe(30_860_000);
    expect(b0605.marginVnd).toBe(13_820_000);
    // 다른 버킷(데이터 없음)은 0
    const b0610 = s.trend.find((b) => b.bucketKey === "2026-06-10")!;
    expect(b0610.krwRevenue).toBe(0);
    expect(b0610.vndRevenue).toBe(0);
    expect(b0610.marginVnd).toBe(0);

    // 채널 도넛은 빌라 기준 유지(부가서비스·미니바 미반영) — TRAVEL_AGENCY VND 30M 그대로
    const ta = s.channels.find((c) => c.channel === "TRAVEL_AGENCY")!;
    expect(ta.vndRevenue).toBe(30_000_000);
    const direct = s.channels.find((c) => c.channel === "DIRECT")!;
    expect(direct.krwRevenue).toBe(1_000_000);
  });

  it("부가서비스 KRW 라인·원가 미입력 라인은 마진서 제외(ADR-0003)", async () => {
    const db = mockOverviewDb({
      // KRW 매출 + costVnd 있어도 priceVnd 없으면 마진 제외(환산 없음)
      services: [
        { type: "MASSAGE", priceKrw: 100_000, priceVnd: null, costVnd: 300_000n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-10T00:00:00.000Z") },
        { type: "BBQ", priceKrw: 0, priceVnd: 800_000n, costVnd: 500_000n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-11T00:00:00.000Z") },
      ],
      // 원가 미입력 미니바 라인 — 매출만, 마진 제외
      minibar: [
        { nameKo: "물", consumedQty: 1, lineVnd: 10_000n, costVnd: null, lineCostVnd: null, checkOut: new Date("2026-06-12T00:00:00.000Z") },
      ],
    });
    const s = await loadOverviewStats(period, NOW, db);

    expect(s.current.krwRevenue).toBe(100_000);
    expect(s.current.vndRevenue).toBe(810_000); // 800k + 10k
    // 마진 = BBQ만(800k−500k=300k). KRW 라인·원가미입력 미니바 제외
    expect(s.current.marginVnd).toBe(300_000);
    // 마진율 = 300k / VND분모(810k) × 100 ≈ 37.0%
    expect(s.current.marginRatePct).toBe(37);
  });

  it("VND 매출 0 → marginRatePct null(÷0 방지)", async () => {
    // KRW 매출만(환산 불가 — fx 없음) → VND 분모 0
    const db = mockOverviewDb({
      services: [
        { type: "MASSAGE", priceKrw: 100_000, priceVnd: null, costVnd: 0n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-10T00:00:00.000Z") },
      ],
    });
    const s = await loadOverviewStats(period, NOW, db);
    expect(s.current.krwRevenue).toBe(100_000);
    expect(s.current.vndRevenue).toBe(0);
    expect(s.current.marginVnd).toBe(0);
    expect(s.current.marginRatePct).toBeNull();
  });

  it("직전 동기간 대비(changePct) — 통합 총계 기준", async () => {
    // 커스텀 06-11~06-20(span 10) → previous = 06-01~06-11
    const p10 = resolveStatsPeriod({ from: "2026-06-11", to: "2026-06-20" }, NOW);
    expect(p10.previous).not.toBeNull();

    const db = mockOverviewDb({
      // 현재 기간(06-15): 빌라 VND 20,000,000
      bookings: [
        { status: "CHECKED_OUT", channel: "TRAVEL_AGENCY", saleCurrency: Currency.VND, totalSaleKrw: null, totalSaleVnd: 20_000_000n, supplierCostVnd: 10_000_000n, fxVndPerKrw: null, checkOut: new Date("2026-06-15T00:00:00.000Z") },
      ],
      // 현재 기간(06-15): 부가서비스 VND 1,000,000 / previous(06-05): 부가서비스 VND 500,000
      services: [
        { type: "BBQ", priceKrw: 0, priceVnd: 1_000_000n, costVnd: 0n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-15T00:00:00.000Z") },
        { type: "BBQ", priceKrw: 0, priceVnd: 500_000n, costVnd: 0n, quantity: 1, status: "DELIVERED", checkOut: new Date("2026-06-05T00:00:00.000Z") },
      ],
      // previous(06-05): 미니바 VND 500,000
      minibar: [
        { nameKo: "콜라", consumedQty: 1, lineVnd: 500_000n, costVnd: null, lineCostVnd: null, checkOut: new Date("2026-06-05T00:00:00.000Z") },
      ],
    });
    const s = await loadOverviewStats(p10, NOW, db);

    // current VND = 빌라 20,000,000 + 부가서비스 1,000,000 = 21,000,000
    expect(s.current.vndRevenue).toBe(21_000_000);
    // previous VND = 부가서비스 500,000 + 미니바 500,000 = 1,000,000
    // changePct = (21,000,000 − 1,000,000) / 1,000,000 × 100 = 2000%
    expect(s.current.vndChangePct).toBe(2000);
  });

  it("전부 0건 → 매출·마진 0·marginRatePct null·버킷 전부 0", async () => {
    const s = await loadOverviewStats(period, NOW, mockOverviewDb({}));
    expect(s.current.krwRevenue).toBe(0);
    expect(s.current.vndRevenue).toBe(0);
    expect(s.current.marginVnd).toBe(0);
    expect(s.current.marginRatePct).toBeNull();
    expect(s.trend.every((b) => b.krwRevenue === 0 && b.vndRevenue === 0 && b.marginVnd === 0)).toBe(true);
  });
});
