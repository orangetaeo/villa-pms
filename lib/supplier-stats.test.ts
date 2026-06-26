import { describe, expect, it } from "vitest";
import { BookingStatus } from "@prisma/client";
import { resolveStatsPeriod } from "@/lib/statistics";
import {
  changeRateOrNull,
  clippedNights,
  formatVndDot,
  loadSupplierStats,
} from "@/lib/supplier-stats";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("formatVndDot — 공급자 점 구분 표기", () => {
  it("천 단위 점 구분 + ₫", () => {
    expect(formatVndDot(45_000_000n)).toBe("45.000.000₫");
    expect(formatVndDot(0n)).toBe("0₫");
    expect(formatVndDot(1_500n)).toBe("1.500₫");
  });
  it("음수(역조정) 보존", () => {
    expect(formatVndDot(-2_000_000n)).toBe("-2.000.000₫");
  });
});

describe("clippedNights — half-open 윈도우 클리핑", () => {
  const win = { s: d("2026-07-01"), e: d("2026-08-01") };
  it("완전 포함", () => {
    expect(clippedNights({ status: BookingStatus.CHECKED_OUT, checkIn: d("2026-07-05"), checkOut: d("2026-07-08") }, win.s, win.e)).toBe(3);
  });
  it("경계 밖으로 클리핑", () => {
    expect(clippedNights({ status: BookingStatus.CONFIRMED, checkIn: d("2026-06-28"), checkOut: d("2026-07-03") }, win.s, win.e)).toBe(2);
  });
  it("비중첩 → 0", () => {
    expect(clippedNights({ status: BookingStatus.CONFIRMED, checkIn: d("2026-08-02"), checkOut: d("2026-08-05") }, win.s, win.e)).toBe(0);
  });
});

describe("changeRateOrNull — ÷0 방지", () => {
  it("정상 증감률", () => {
    expect(changeRateOrNull(150, 100)).toBe(50);
    expect(changeRateOrNull(80, 100)).toBe(-20);
  });
  it("이전값 0·null → null", () => {
    expect(changeRateOrNull(100, 0)).toBeNull();
    expect(changeRateOrNull(100, null)).toBeNull();
  });
});

// ── 가짜 PrismaClient — supplierId 스코프·집계 검증 ──
type AnyArgs = {
  where?: { villa?: { supplierId?: string }; supplierId?: string; status?: { in: BookingStatus[] } };
};

function fakeDb(opts: {
  revenue: Array<{ checkOut: Date; supplierCostVnd: bigint; villaId: string }>;
  occupancy: Array<{ status: BookingStatus; checkIn: Date; checkOut: Date; villaId: string }>;
  villas: Array<{ id: string; name: string; complex: string | null; supplierId: string }>;
}) {
  // findMany는 호출 순서(loadSupplierStats: revenue → occupancy)로 구분
  let bookingCall = 0;
  return {
    booking: {
      findMany: async (args: AnyArgs) => {
        // 스코프 강제 검증
        expect(args.where?.villa?.supplierId).toBeDefined();
        const sid = args.where!.villa!.supplierId!;
        const allowed = new Set(args.where?.status?.in ?? []);
        const ofSupplier = (villaId: string) =>
          opts.villas.find((v) => v.id === villaId)?.supplierId === sid;
        bookingCall += 1;
        if (bookingCall === 1)
          return opts.revenue.filter((r) => ofSupplier(r.villaId) && allowed.has(BookingStatus.CHECKED_OUT));
        return opts.occupancy.filter((r) => ofSupplier(r.villaId) && allowed.has(r.status));
      },
    },
    villa: {
      count: async (args: AnyArgs) => opts.villas.filter((v) => v.supplierId === args.where?.supplierId).length,
      findMany: async (args: AnyArgs) =>
        opts.villas
          .filter((v) => v.supplierId === args.where?.supplierId)
          .map((v) => ({ id: v.id, name: v.name, complex: v.complex })),
    },
  } as never;
}

describe("loadSupplierStats — 공급자 스코프 집계", () => {
  const period = resolveStatsPeriod({ range: "thisMonth" }, NOW);

  it("자기 빌라만 집계 + 수익/가동율/빌라별 성과", async () => {
    const villas = [
      { id: "vA", name: "Villa A", complex: "Sonasea", supplierId: "sup1" },
      { id: "vB", name: "Villa B", complex: null, supplierId: "sup1" },
      { id: "vX", name: "Other", complex: null, supplierId: "sup2" }, // 다른 공급자 — 제외돼야
    ];
    const stats = await loadSupplierStats(
      "sup1",
      period,
      fakeDb({
        revenue: [
          { checkOut: d("2026-07-10"), supplierCostVnd: 10_000_000n, villaId: "vA" },
          { checkOut: d("2026-07-20"), supplierCostVnd: 5_000_000n, villaId: "vB" },
          { checkOut: d("2026-07-12"), supplierCostVnd: 99_000_000n, villaId: "vX" }, // sup2 — 제외
        ],
        occupancy: [
          { status: BookingStatus.CHECKED_OUT, checkIn: d("2026-07-08"), checkOut: d("2026-07-10"), villaId: "vA" },
          { status: BookingStatus.CONFIRMED, checkIn: d("2026-07-18"), checkOut: d("2026-07-20"), villaId: "vB" },
          { status: BookingStatus.HOLD, checkIn: d("2026-07-01"), checkOut: d("2026-07-31"), villaId: "vA" }, // HOLD 제외
          { status: BookingStatus.CHECKED_OUT, checkIn: d("2026-07-01"), checkOut: d("2026-07-31"), villaId: "vX" }, // sup2 제외
        ],
        villas,
      })
    );

    // 다른 공급자 99M 제외 → 총 15M
    expect(stats.totalVnd).toBe(15_000_000);
    expect(stats.totalVndText).toBe("15.000.000₫");
    expect(stats.villaCount).toBe(2);
    // 빌라별: vA 10M > vB 5M, sup2 미포함
    expect(stats.villas.map((v) => v.villaId)).toEqual(["vA", "vB"]);
    expect(stats.villas[0].vndText).toBe("10.000.000₫");
    // 점유박: vA 2 + vB 2 = 4 (HOLD·sup2 제외)
    expect(stats.bookingCount).toBe(2);
    expect(stats.avgNights).toBe(2);
    // 가동율 = 4박 / (2빌라 × 31일) ≈ 6.5%
    expect(stats.currentRatePct).toBeGreaterThan(0);
    expect(stats.currentRatePct).toBeLessThan(10);
    // 추이 길이 = 버킷 수
    expect(stats.revenueTrend.length).toBe(period.buckets.length);
    expect(stats.occupancyTrend.length).toBe(period.buckets.length);
  });

  it("빈 데이터(빌라 0·예약 0) → 0 그레이스풀", async () => {
    const stats = await loadSupplierStats(
      "supEmpty",
      period,
      fakeDb({ revenue: [], occupancy: [], villas: [] })
    );
    expect(stats.totalVnd).toBe(0);
    expect(stats.villaCount).toBe(0);
    expect(stats.currentRatePct).toBe(0);
    expect(stats.villas).toEqual([]);
    expect(stats.avgNights).toBe(0);
  });

  it("누수 가드 — 반환 객체에 금지 필드 키 0개", async () => {
    const stats = await loadSupplierStats(
      "sup1",
      period,
      fakeDb({
        revenue: [{ checkOut: d("2026-07-10"), supplierCostVnd: 10_000_000n, villaId: "vA" }],
        occupancy: [],
        villas: [{ id: "vA", name: "A", complex: null, supplierId: "sup1" }],
      })
    );
    const json = JSON.stringify(stats);
    expect(json).not.toMatch(/sale|margin|fxVnd|guest|krw/i);
  });
});
