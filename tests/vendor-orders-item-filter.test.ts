// 벤더 발주 목록 GET — 품목(catalogItemId) 필터 테스트 (vendor-board-item-filter)
//   - 목록 where에 catalogItemId 정확일치가 AND로 결합(검색·날짜와 동일 패턴)
//   - 불량 itemId(40자 초과)는 무시(400 아님) — where에 catalogItemId 없음
//   - 뱃지 카운트(inboxCount·proposalPendingCount)·settlement 전역합계는 품목 무관 유지
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
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

const authFn = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => authFn(...a) }));
vi.mock("@/lib/permissions", () => ({ isVendor: (r?: string) => r === "VENDOR" }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a) }));

vi.mock("@/lib/locale", () => ({ getSupplierLocale: vi.fn(async () => "vi") }));
vi.mock("@/lib/service-display", () => ({ pickI18n: () => "item", selectedOptionLabels: () => [] }));
vi.mock("@/lib/villa-name", () => ({ formatVillaName: () => "villa" }));

import { GET } from "@/app/api/vendor/orders/route";

const call = (qs: string) => GET(new Request(`http://local/api/vendor/orders?${qs}`));

// where 트리(AND/OR 중첩 포함) 안에 catalogItemId 정확일치 제약이 있는지 재귀 탐색.
function hasCatalogItemId(w: unknown, id: string): boolean {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  if (o.catalogItemId === id) return true;
  for (const key of ["AND", "OR"] as const) {
    const arr = o[key];
    if (Array.isArray(arr) && arr.some((x) => hasCatalogItemId(x, id))) return true;
  }
  return false;
}

const listWheres = () => soFindMany.mock.calls.map((c) => (c[0] as { where: unknown }).where);
// base where에 무료 제외 조건(priceVnd/costVnd = 0n, BigInt)이 포함되므로 직렬화 시 BigInt→string 치환.
const biReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const countWheres = () => soCount.mock.calls.map((c) => (c[0] as { where: unknown }).where);
const aggregateWheres = () => soAggregate.mock.calls.map((c) => (c[0] as { where: unknown }).where);

beforeEach(() => {
  vi.clearAllMocks();
  authFn.mockResolvedValue({ user: { id: "vu-1", role: "VENDOR", locale: "vi" } });
  getVendorIdForUser.mockResolvedValue("vd-1");
  soCount.mockResolvedValue(0);
  soFindMany.mockResolvedValue([]);
  soAggregate.mockResolvedValue({ _sum: { costVnd: null }, _count: 0 });
  catalogFindMany.mockResolvedValue([]);
});

describe("vendor orders — 품목 필터(catalogItemId)", () => {
  it("inbox: 목록 where에 catalogItemId 결합, 뱃지 카운트는 품목 무관", async () => {
    const res = await call("tab=inbox&itemId=ci-safari");
    expect(res.status).toBe(200);
    expect(listWheres().length).toBeGreaterThan(0);
    expect(listWheres().every((w) => hasCatalogItemId(w, "ci-safari"))).toBe(true);
    // 뱃지 카운트(inbox·proposal 미해결) — 어느 count에도 catalogItemId 없어야 함
    const badgeCounts = countWheres().filter((w) => {
      const o = w as Record<string, unknown>;
      return o.vendorStatus === "PENDING_VENDOR" || o.proposedServiceDate != null;
    });
    expect(badgeCounts.length).toBeGreaterThanOrEqual(2);
    expect(badgeCounts.some((w) => hasCatalogItemId(w, "ci-safari"))).toBe(false);
  });

  it("schedule: 목록 + cancelled 배너 목록 모두 품목 필터 반영", async () => {
    await call("tab=schedule&itemId=ci-safari");
    const wheres = listWheres();
    expect(wheres.length).toBe(2);
    expect(wheres.every((w) => hasCatalogItemId(w, "ci-safari"))).toBe(true);
  });

  it("settlement: 목록 where는 품목 필터, 전역 합계(aggregate)는 품목 무관", async () => {
    await call("tab=settlement&itemId=ci-safari");
    expect(listWheres().every((w) => hasCatalogItemId(w, "ci-safari"))).toBe(true);
    expect(aggregateWheres().length).toBe(2);
    expect(aggregateWheres().some((w) => hasCatalogItemId(w, "ci-safari"))).toBe(false);
  });

  it("검색·날짜와 함께 AND 결합", async () => {
    await call("tab=inbox&itemId=ci-safari&from=2026-07-01&search=abc");
    const flat = JSON.stringify(listWheres(), biReplacer);
    expect(flat).toContain('"catalogItemId":"ci-safari"');
    expect(flat).toContain('"serviceDate"');
  });

  it("불량 itemId(40자 초과)는 무시 — where에 catalogItemId 없음, 200", async () => {
    const longId = "x".repeat(41);
    const res = await call(`tab=inbox&itemId=${longId}`);
    expect(res.status).toBe(200);
    expect(listWheres().some((w) => hasCatalogItemId(w, longId))).toBe(false);
  });

  it("itemId 파라미터 없으면 필터 미적용", async () => {
    await call("tab=inbox");
    const flat = JSON.stringify(listWheres(), biReplacer);
    expect(flat).not.toContain("catalogItemId");
  });
});
