import { describe, expect, it } from "vitest";
import { Currency, type PrismaClient } from "@prisma/client";
import {
  conversionRate,
  changeRate,
  resolveStatsPeriod,
  loadMinibarStats,
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
