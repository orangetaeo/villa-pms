// 티켓 전용 벤더 파생 판정 테스트 (ticket-vendor-board)
//   - 순수 판정(isTicketOnlyFromCounts): 활성 품목 개수만으로 결정 — 전부 TICKET+1개↑=true.
//   - async 래퍼(isTicketOnlyVendor): count 2쿼리(전체 활성 / 활성 TICKET)로 위 판정 위임.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isTicketOnlyFromCounts } from "@/lib/vendor-order";

// ── prisma mock (count 2쿼리만) ──
const catalogCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceCatalogItem: { count: (...a: unknown[]) => catalogCount(...a) },
  },
}));

import { isTicketOnlyVendor } from "@/lib/vendor-auth";

describe("isTicketOnlyFromCounts — 순수 판정", () => {
  it("활성 품목이 전부 TICKET이면 true", () => {
    expect(isTicketOnlyFromCounts(2, 2)).toBe(true);
    expect(isTicketOnlyFromCounts(1, 1)).toBe(true);
  });

  it("혼합(TICKET + 비TICKET)이면 false", () => {
    expect(isTicketOnlyFromCounts(3, 1)).toBe(false);
    expect(isTicketOnlyFromCounts(2, 1)).toBe(false);
  });

  it("활성 품목 0개면 false(판단 근거 없음 — 일반 보드 유지)", () => {
    expect(isTicketOnlyFromCounts(0, 0)).toBe(false);
  });

  it("활성 TICKET이 하나도 없으면 false(비TICKET만 보유)", () => {
    expect(isTicketOnlyFromCounts(2, 0)).toBe(false);
  });
});

describe("isTicketOnlyVendor — count 2쿼리 위임", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("전부 TICKET(활성 2/티켓 2) → true, active:true 필터 사용", async () => {
    catalogCount.mockResolvedValueOnce(2).mockResolvedValueOnce(2); // [전체 활성, 활성 TICKET]
    expect(await isTicketOnlyVendor("vd-1")).toBe(true);
    expect(catalogCount).toHaveBeenCalledTimes(2);
    // 첫 쿼리=전체 활성, 둘째=활성 TICKET
    expect(catalogCount.mock.calls[0][0]).toMatchObject({ where: { vendorId: "vd-1", active: true } });
    expect(catalogCount.mock.calls[1][0]).toMatchObject({
      where: { vendorId: "vd-1", active: true, type: "TICKET" },
    });
  });

  it("혼합(활성 3/티켓 1) → false", async () => {
    catalogCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    expect(await isTicketOnlyVendor("vd-1")).toBe(false);
  });

  it("활성 품목 0개(미등록) → false", async () => {
    catalogCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    expect(await isTicketOnlyVendor("vd-1")).toBe(false);
  });

  it("비활성 TICKET만 보유(활성 count=0) → false", async () => {
    // active:true 필터가 비활성 TICKET을 제외 → 전체 활성 0, 활성 TICKET 0.
    catalogCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    expect(await isTicketOnlyVendor("vd-1")).toBe(false);
  });
});
