import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import {
  conversionRate,
  changeRate,
  parseStatsRange,
  resolveRangePeriod,
  toVndAmount,
  toKrwAmount,
  toFinanceBooking,
  toFinanceBlock,
  type FinanceSourceRow,
} from "@/lib/statistics";
import { summarizeFinance } from "@/lib/settlement-finance";

const NOW = new Date("2026-06-15T12:00:00.000Z"); // VN 기준 2026-06

// ===================================================================
// ③ 기간 → 월키 변환
// ===================================================================
describe("resolveRangePeriod — range → 월키 + 창 (③ 기간 변환)", () => {
  it('"6" → 현재 포함 과거 6개월 오름차순', () => {
    const p = resolveRangePeriod("6", NOW);
    expect(p.monthKeys).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(p.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-07-01T00:00:00.000Z"); // exclusive
  });

  it('"12" → 12개월, 연 경계 롤백', () => {
    const p = resolveRangePeriod("12", NOW);
    expect(p.monthKeys).toHaveLength(12);
    expect(p.monthKeys[0]).toBe("2025-07");
    expect(p.monthKeys[11]).toBe("2026-06");
    expect(p.start.toISOString()).toBe("2025-07-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("{ year } → 그 해 1~12월", () => {
    const p = resolveRangePeriod({ year: 2025 }, NOW);
    expect(p.monthKeys[0]).toBe("2025-01");
    expect(p.monthKeys[11]).toBe("2025-12");
    expect(p.start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("잘못된 연도는 throw", () => {
    expect(() => resolveRangePeriod({ year: 1500 }, NOW)).toThrow(RangeError);
  });
});

describe("parseStatsRange — URL 쿼리 파싱", () => {
  it('"6"·"12"는 그대로', () => {
    expect(parseStatsRange("6")).toBe("6");
    expect(parseStatsRange("12")).toBe("12");
  });
  it('4자리 연도는 { year }', () => {
    expect(parseStatsRange("2025")).toEqual({ year: 2025 });
  });
  it("무효·미지정은 기본 12", () => {
    expect(parseStatsRange(undefined)).toBe("12");
    expect(parseStatsRange("abc")).toBe("12");
    expect(parseStatsRange("99")).toBe("12");
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
