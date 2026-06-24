import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR-0014 구현 — PATCH /api/villas/[id]/rate-periods. 권한·base필수·날짜·겹침·영속 검증.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  villa: { findUnique: vi.fn() },
  villaRatePeriod: {
    deleteMany: vi.fn(async () => ({})),
    create: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
    createMany: vi.fn(async (_a: { data: Record<string, unknown>[] }) => ({})),
  },
};
const transactionSpy = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: unknown) => Promise<unknown>) => transactionSpy(fn) },
}));

import { PATCH } from "@/app/api/villas/[id]/rate-periods/route";

const BASE = {
  base: { season: "LOW", supplierCostVnd: "1000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "1200000", salePriceKrw: 60000 },
  periods: [
    { season: "PEAK", startDate: "2026-02-14", endDate: "2026-02-20", supplierCostVnd: "5000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "6000000", salePriceKrw: 300000 },
    { season: "PEAK", startDate: "2026-07-10", endDate: "2026-07-20", supplierCostVnd: "4500000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "5500000", salePriceKrw: 275000 },
  ],
};
const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/villas/v1/rate-periods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  tx.villa.findUnique.mockResolvedValue({ id: "v1" });
});

describe("권한 — canSetPrice 전용", () => {
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req(BASE)).status).toBe(401);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
  it("STAFF 403 (돈 차단)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "STAFF" } });
    expect((await req(BASE)).status).toBe(403);
  });
  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "p1", role: "SUPPLIER" } });
    expect((await req(BASE)).status).toBe(403);
  });
});

describe("검증·영속 (OWNER)", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("정상 저장 — base create 1 + periods createMany, 200", async () => {
    const res = await req(BASE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "v1", baseCount: 1, periodCount: 2 });
    // base는 create(isBase=true·BigInt 변환), periods는 createMany
    expect(tx.villaRatePeriod.deleteMany).toHaveBeenCalledWith({ where: { villaId: "v1" } });
    const baseArg = tx.villaRatePeriod.create.mock.calls[0][0].data;
    expect(baseArg.isBase).toBe(true);
    expect(baseArg.salePriceVnd).toBe(1200000n);
    expect(baseArg.startDate).toBeNull();
    const periodArg = tx.villaRatePeriod.createMany.mock.calls[0][0].data;
    expect(periodArg).toHaveLength(2);
    expect(periodArg[0].isBase).toBe(false);
    expect(periodArg[0].supplierCostVnd).toBe(5000000n);
  });

  it("base 누락 거부 (400)", async () => {
    const res = await req({ periods: [] });
    expect(res.status).toBe(400);
  });

  it("기간 없이 base만 허용 (periods=[], createMany 미호출)", async () => {
    const res = await req({ ...BASE, periods: [] });
    expect(res.status).toBe(200);
    expect(tx.villaRatePeriod.create).toHaveBeenCalledTimes(1);
    expect(tx.villaRatePeriod.createMany).not.toHaveBeenCalled();
  });

  it("start>=end 거부 (400)", async () => {
    const res = await req({
      ...BASE,
      periods: [{ ...BASE.periods[0], startDate: "2026-02-20", endDate: "2026-02-14" }],
    });
    expect(res.status).toBe(400);
  });

  it("겹치는 기간 거부 (400)", async () => {
    const res = await req({
      ...BASE,
      periods: [
        { ...BASE.periods[0], startDate: "2026-02-10", endDate: "2026-02-20" },
        { ...BASE.periods[1], startDate: "2026-02-15", endDate: "2026-02-25" },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("인접(경계 맞닿음)은 겹침 아님 — half-open 허용 (200)", async () => {
    const res = await req({
      ...BASE,
      periods: [
        { ...BASE.periods[0], startDate: "2026-02-10", endDate: "2026-02-15" },
        { ...BASE.periods[1], startDate: "2026-02-15", endDate: "2026-02-20" },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("미존재 빌라 404", async () => {
    tx.villa.findUnique.mockResolvedValue(null);
    expect((await req(BASE)).status).toBe(404);
  });
});
