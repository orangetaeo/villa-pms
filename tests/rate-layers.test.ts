import { describe, expect, it } from "vitest";
import { SeasonType } from "@prisma/client";
import {
  segmentByWinner,
  adjustVnd,
  adjustKrw,
  shiftDateYears,
  shiftEndDateYears,
  generateBatchId,
  type DateRange,
} from "@/lib/rate-layers";
import type { RatePeriodLike } from "@/lib/pricing";

// rate-calendar-ux 일괄 작업 순수 함수 — 구간화·퍼센트 조정·연도 시프트
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const base: RatePeriodLike = {
  id: "base",
  season: SeasonType.LOW,
  isBase: true,
  startDate: null,
  endDate: null,
  supplierCostVnd: 1_000_000n,
  salePriceVnd: 1_200_000n,
  salePriceKrw: 60_000,
};

describe("segmentByWinner — 밤별 승자 구간화 (ADJUST 정본)", () => {
  const high: RatePeriodLike = {
    id: "high",
    season: SeasonType.HIGH,
    isBase: false,
    startDate: utc("2027-01-01"),
    endDate: utc("2027-01-31"), // 30박
    supplierCostVnd: 3_000_000n,
    salePriceVnd: 3_600_000n,
    salePriceKrw: 180_000,
  };
  const peak: RatePeriodLike = {
    id: "peak",
    season: SeasonType.PEAK,
    isBase: false,
    startDate: utc("2027-01-10"),
    endDate: utc("2027-01-13"), // 3박, HIGH 내부
    supplierCostVnd: 8_000_000n,
    salePriceVnd: 10_000_000n,
    salePriceKrw: 500_000,
  };

  it("base+HIGH+PEAK 걸친 range → 3개 구간(base, HIGH, PEAK)", () => {
    const range: DateRange = { start: utc("2026-12-30"), end: utc("2027-01-13") };
    const segs = segmentByWinner(range, [high, peak], base);
    expect(segs).toHaveLength(3);
    // base [12-30, 01-01)
    expect(segs[0].row).toBe(base);
    expect(segs[0].start).toEqual(utc("2026-12-30"));
    expect(segs[0].end).toEqual(utc("2027-01-01"));
    // HIGH [01-01, 01-10)
    expect(segs[1].row).toBe(high);
    expect(segs[1].start).toEqual(utc("2027-01-01"));
    expect(segs[1].end).toEqual(utc("2027-01-10"));
    // PEAK [01-10, 01-13)  (짧은 기간 승)
    expect(segs[2].row).toBe(peak);
    expect(segs[2].start).toEqual(utc("2027-01-10"));
    expect(segs[2].end).toEqual(utc("2027-01-13"));
  });

  it("겹침 없는 range는 승자 1개(base)면 1구간", () => {
    const range: DateRange = { start: utc("2027-06-01"), end: utc("2027-06-05") };
    const segs = segmentByWinner(range, [high, peak], base);
    expect(segs).toHaveLength(1);
    expect(segs[0].row).toBe(base);
  });
});

describe("adjustVnd — pct 조정 + 1,000동 반올림 (BigInt)", () => {
  it("+10% 정확 배수", () => {
    expect(adjustVnd(5_000_000n, 10)).toBe(5_500_000n);
  });
  it("-15%", () => {
    expect(adjustVnd(5_000_000n, -15)).toBe(4_250_000n);
  });
  it("0%라도 1,000동 반올림(비배수 → 최근접)", () => {
    expect(adjustVnd(1_234_567n, 0)).toBe(1_235_000n);
  });
  it("소수 퍼센트(만분율) 정밀 — 12.5%", () => {
    // 4,000,000 × 1.125 = 4,500,000
    expect(adjustVnd(4_000_000n, 12.5)).toBe(4_500_000n);
  });
});

describe("adjustKrw — pct 조정 + 100원 반올림 (Int)", () => {
  it("+10% 정확 배수", () => {
    expect(adjustKrw(300_000, 10)).toBe(330_000);
  });
  it("0%라도 100원 반올림", () => {
    expect(adjustKrw(12_345, 0)).toBe(12_300);
  });
});

describe("shiftDateYears — 같은 월·일, 2/29→2/28 보정", () => {
  it("평범한 날짜 +1년", () => {
    expect(shiftDateYears(utc("2027-01-10"), 1)).toEqual(utc("2028-01-10"));
  });
  it("2/29 → 대상 비윤년이면 2/28", () => {
    // 2028 윤년 2/29 → 2029(비윤년) → 2/28
    expect(shiftDateYears(utc("2028-02-29"), 1)).toEqual(utc("2029-02-28"));
  });
  it("2/29 → 대상도 윤년이면 그대로", () => {
    // 2028 → 2032 둘 다 윤년
    expect(shiftDateYears(utc("2028-02-29"), 4)).toEqual(utc("2032-02-29"));
  });
});

describe("shiftEndDateYears — COPY_YEAR 윤년 경계(마지막 밤 보존)", () => {
  const nights = (start: Date, end: Date) =>
    (end.getTime() - start.getTime()) / 86_400_000;

  it("[2024-01-01, 2024-02-29) +1년 → end=2025-03-01 (59박 보존, 직접 시프트 58박 버그 방지)", () => {
    // C1: exclusive end를 직접 시프트하면 2025-02-28(58박)로 1박 유실. 마지막 밤(02-28)→+1일로 복원.
    const start = shiftDateYears(utc("2024-01-01"), 1);
    const end = shiftEndDateYears(utc("2024-02-29"), 1);
    expect(start).toEqual(utc("2025-01-01"));
    expect(end).toEqual(utc("2025-03-01"));
    expect(nights(utc("2024-01-01"), utc("2024-02-29"))).toBe(59); // 원본 밤 수
    expect(nights(start, end)).toBe(59); // 시프트 후 동일
  });

  it("단일 밤 [2024-02-28, 2024-02-29) +1년 → [2025-02-28, 2025-03-01) 1박 보존", () => {
    const start = shiftDateYears(utc("2024-02-28"), 1);
    const end = shiftEndDateYears(utc("2024-02-29"), 1);
    expect(start).toEqual(utc("2025-02-28"));
    expect(end).toEqual(utc("2025-03-01"));
    expect(nights(start, end)).toBe(1);
  });

  it("평범한 exclusive end +1년 (비경계)", () => {
    expect(shiftEndDateYears(utc("2027-01-13"), 1)).toEqual(utc("2028-01-13"));
  });
});

describe("generateBatchId — 고유 그룹 키", () => {
  it("batch_ 접두 + 매번 다른 값", () => {
    const a = generateBatchId();
    const b = generateBatchId();
    expect(a.startsWith("batch_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
