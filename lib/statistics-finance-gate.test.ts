import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadVillaPerformance, loadOperationsStats } from "@/lib/statistics";

// 통계 finance 누수 게이트 — STAFF(canViewFinance=false → includeFinance=false)에게
//   매출·마진·보증금차감 금액이 페이로드에서 빠지는지 검증한다.
//   기존 statistics.test.ts는 계산 헬퍼(통화분리·마진환산)만 덮고, load* 함수의 게이트는 미검증이었다.
//   db 주입(injectable)으로 모듈 mock 없이 직접 호출한다.

const NOW = new Date("2026-06-15T00:00:00Z");

// 부분 mock을 PrismaClient로 캐스팅(테스트 전용 — 실제로 쓰이는 메서드만 구현)
const asDb = (m: unknown): PrismaClient => m as unknown as PrismaClient;

describe("loadVillaPerformance — includeFinance 누수 게이트", () => {
  it("false: 빌라 행에 매출·마진 키 부재 + 재무 쿼리 미발생", async () => {
    const bookingFindMany = vi.fn().mockResolvedValue([]); // 점유 0건이어도 빌라 행은 생성됨
    const db = asDb({
      booking: { findMany: bookingFindMany },
      villa: { findMany: vi.fn().mockResolvedValue([{ id: "v1", name: "V1", complex: "A" }]) },
    });

    const rows = await loadVillaPerformance("12", false, NOW, db);

    // 재무 쿼리(두 번째 booking.findMany)가 아예 발생하지 않아야 함 → 점유 1회만
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    const r = rows[0] as unknown as Record<string, unknown>;
    expect(r.marginVnd).toBeUndefined();
    expect(r.marginVndText).toBeUndefined();
    expect(r.krwRevenue).toBeUndefined();
    expect(r.vndRevenue).toBeUndefined();
    // 비재무 지표는 정상 존재
    expect(r.ratePct).toBeDefined();
    expect(r.bookingCount).toBeDefined();
    expect(r.occupiedNights).toBeDefined();
  });

  it("true: 매출·마진 키 존재 + 재무 쿼리 발생 (게이트 토글 양성 대조)", async () => {
    const finBookings = [
      {
        villaId: "v1",
        saleCurrency: "VND",
        totalSaleKrw: null,
        totalSaleVnd: 10_000_000n,
        supplierCostVnd: 6_000_000n,
        fxVndPerKrw: null,
      },
    ];
    const bookingFindMany = vi
      .fn()
      .mockResolvedValueOnce([]) // 점유
      .mockResolvedValueOnce(finBookings); // 재무
    const db = asDb({
      booking: { findMany: bookingFindMany },
      villa: { findMany: vi.fn().mockResolvedValue([{ id: "v1", name: "V1", complex: "A" }]) },
    });

    const rows = await loadVillaPerformance("12", true, NOW, db);

    expect(bookingFindMany).toHaveBeenCalledTimes(2); // 점유 + 재무
    const r = rows[0] as unknown as Record<string, unknown>;
    expect(r.vndRevenue).toBe(10_000_000);
    expect(r.marginVnd).toBe(4_000_000); // 10M − 6M
  });
});

describe("loadOperationsStats — includeFinance 누수 게이트", () => {
  const cleaningStub = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  });

  it("false: deposit(보증금 차감 건수·ΣVND) 키 자체 없음", async () => {
    const db = asDb({
      booking: {
        findMany: vi.fn().mockResolvedValue([
          { status: "CHECKED_OUT", depositStatus: "PARTIAL_DEDUCTED", depositDeductVnd: 500_000n },
        ]),
      },
      cleaningTask: cleaningStub(),
    });

    const stats = await loadOperationsStats("12", false, NOW, db);

    expect(stats.deposit).toBeUndefined();
    // 비재무 운영 지표(전환율·청소)는 존재
    expect(stats.cleaning).toBeDefined();
    expect(typeof stats.cancelPct).toBe("number");
    expect(typeof stats.noShowPct).toBe("number");
  });

  it("true: deposit 집계 존재 — PARTIAL_DEDUCTED만 합산", async () => {
    const db = asDb({
      booking: {
        findMany: vi.fn().mockResolvedValue([
          { status: "CHECKED_OUT", depositStatus: "PARTIAL_DEDUCTED", depositDeductVnd: 500_000n },
          { status: "CHECKED_OUT", depositStatus: "REFUNDED", depositDeductVnd: null },
        ]),
      },
      cleaningTask: cleaningStub(),
    });

    const stats = await loadOperationsStats("12", true, NOW, db);

    expect(stats.deposit?.deductedCount).toBe(1); // REFUNDED 제외
    expect(stats.deposit?.deductVnd).toBe(500_000);
  });
});
