// 정산 허브 무료 티켓 제외 (P2-A) — settleable 합계 + pending/paid 목록 where에 무료 제외 NOT 전파.
//   무료 티켓(priceVnd=0·costVnd=0)이 "정산 대기"에 유령 잔류하지 않도록 발주함/벤더 통계와 동일 상수 사용.
import { describe, it, expect, vi, beforeEach } from "vitest";

const soCount = vi.fn();
const soFindMany = vi.fn();
const soAggregate = vi.fn();
const catalogFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      count: (...a: unknown[]) => soCount(...a),
      findMany: (...a: unknown[]) => soFindMany(...a),
      aggregate: (...a: unknown[]) => soAggregate(...a),
    },
    serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) },
  },
}));

import { queryHub, type HubQuery } from "@/lib/service-orders-hub";
import { EXCLUDE_FREE_TICKET_WHERE } from "@/lib/service-order";

const EXCLUDE = EXCLUDE_FREE_TICKET_WHERE.NOT;
const q = (over: Partial<HubQuery> = {}): HubQuery => ({ view: "pending", page: 1, pageSize: 10, ...over });

// where 트리(중첩 AND) 안에 무료 제외 NOT이 존재하는지 재귀 탐색.
function hasExcludeNot(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  if (w.NOT && JSON.stringify(w.NOT, bigintSafe) === JSON.stringify(EXCLUDE, bigintSafe)) return true;
  if (Array.isArray(w.AND)) return w.AND.some(hasExcludeNot);
  return false;
}
const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);

beforeEach(() => {
  vi.clearAllMocks();
  soCount.mockResolvedValue(0);
  soFindMany.mockResolvedValue([]);
  soAggregate.mockResolvedValue({ _sum: { costVnd: null }, _count: 0 });
  catalogFindMany.mockResolvedValue([]);
});

describe("정산 허브 무료 티켓 제외 (P2-A)", () => {
  it("pending 뷰 목록 findMany where에 무료 제외 NOT 포함", async () => {
    await queryHub(q({ view: "pending" }), "ko");
    const where = (soFindMany.mock.calls[0][0] as { where: unknown }).where;
    expect(hasExcludeNot(where)).toBe(true);
  });

  it("paid 뷰 목록 findMany where에 무료 제외 NOT 포함", async () => {
    await queryHub(q({ view: "paid" }), "ko");
    const where = (soFindMany.mock.calls[0][0] as { where: unknown }).where;
    expect(hasExcludeNot(where)).toBe(true);
  });

  it("settleable 합계 aggregate(대기·완료) where에 무료 제외 NOT 포함", async () => {
    await queryHub(q({ view: "pending" }), "ko");
    const aggWheres = soAggregate.mock.calls.map((c) => (c[0] as { where: unknown }).where);
    expect(aggWheres.length).toBeGreaterThanOrEqual(2);
    for (const w of aggWheres) expect(hasExcludeNot(w)).toBe(true);
  });

  it("status 뷰(정산 아님) 목록은 무료 제외 없음 — 운영자 상태 감사 보존(계약 범위 밖)", async () => {
    await queryHub(q({ view: "status", status: "all" }), "ko");
    const where = (soFindMany.mock.calls[0][0] as { where: unknown }).where;
    expect(hasExcludeNot(where)).toBe(false);
  });
});
