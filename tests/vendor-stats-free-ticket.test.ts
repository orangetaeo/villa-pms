// 벤더 통계 정산 잔액 무료 티켓 제외 (P3-④) — settleable aggregate where에 무료 제외 NOT 포함.
//   주석("발주함 정산탭과 동일 쿼리")과 정합. 금액 무영향(무료=지급 0)이나 정의 동기화가 목적.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadVendorStats } from "@/lib/vendor-stats";
import { EXCLUDE_FREE_TICKET_WHERE } from "@/lib/service-order";
import type { StatsPeriod } from "@/lib/statistics";

const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);
const eq = (a: unknown, b: unknown) => JSON.stringify(a, bigintSafe) === JSON.stringify(b, bigintSafe);

const period: StatsPeriod = {
  from: new Date("2026-07-01T00:00:00Z"),
  to: new Date("2026-08-01T00:00:00Z"),
  previous: null,
  buckets: [],
} as unknown as StatsPeriod;

const aggregate = vi.fn();
const count = vi.fn();
const soFindMany = vi.fn();
const catalogFindMany = vi.fn();
const db = {
  serviceOrder: {
    findMany: (...a: unknown[]) => soFindMany(...a),
    aggregate: (...a: unknown[]) => aggregate(...a),
    count: (...a: unknown[]) => count(...a),
  },
  serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  soFindMany.mockResolvedValue([]);
  catalogFindMany.mockResolvedValue([]);
  aggregate.mockResolvedValue({ _sum: { costVnd: null } });
  count.mockResolvedValue(0);
});

describe("벤더 통계 settleable 무료 티켓 제외 (P3-④)", () => {
  it("정산 대기·완료 aggregate where에 무료 제외 NOT 포함(vendorId 스코프 유지)", async () => {
    await loadVendorStats("vd-1", period, "vi", db);
    expect(aggregate).toHaveBeenCalledTimes(2);
    for (const c of aggregate.mock.calls) {
      const where = (c[0] as { where: Record<string, unknown> }).where;
      expect(eq(where.NOT, EXCLUDE_FREE_TICKET_WHERE.NOT)).toBe(true);
      expect(where.vendorId).toBe("vd-1"); // 누수 방어 — 스코프 강제 유지
    }
  });
});
