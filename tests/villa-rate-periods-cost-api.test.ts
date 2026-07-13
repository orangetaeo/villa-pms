import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR-0014 후속 — PATCH /api/villas/[id]/rate-periods/cost (SUPPLIER 원가).
// 권한·자기빌라·마진보존(판매가 서버재계산)·신규 기간 base마진 상속·누수0·겹침 검증.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  villa: { findUnique: vi.fn() },
  villaRatePeriod: {
    findMany: vi.fn(),
    update: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
    create: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
    deleteMany: vi.fn(async () => ({})),
  },
  proposal: { findMany: vi.fn(async (): Promise<{ id: string }[]> => []) },
  user: { findMany: vi.fn(async (): Promise<{ id: string }[]> => []) },
  // ADR-0039 — 알림 적재는 enqueueOperatorNotification 경유(그룹 미설정 → 개별 create fan-out)
  appSetting: { findUnique: vi.fn(async (): Promise<{ value: string } | null> => null) },
  notification: {
    create: vi.fn(async (_a: { data: { payload: Record<string, unknown> } }) => ({})),
  },
};
const transactionSpy = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(async () => null) }, // fx 미설정 → KRW=0
    $transaction: (fn: (t: unknown) => Promise<unknown>) => transactionSpy(fn),
  },
}));

import { PATCH } from "@/app/api/villas/[id]/rate-periods/cost/route";

const BODY = {
  base: { season: "LOW", supplierCostVnd: "1000000" },
  periods: [{ season: "PEAK", startDate: "2026-02-14", endDate: "2026-02-20", supplierCostVnd: "5000000" }],
};
const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/villas/v1/rate-periods/cost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "sup1", name: "V1" });
  tx.proposal.findMany.mockResolvedValue([]);
  tx.user.findMany.mockResolvedValue([]);
});

describe("권한·스코프", () => {
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req(BODY)).status).toBe(401);
  });
  it("운영자(OWNER) 403 — 원가 입력은 공급자 영역", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    expect((await req(BODY)).status).toBe(403);
  });
  it("타인 빌라 404 (존재 미누설)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other", role: "SUPPLIER" } });
    tx.villaRatePeriod.findMany.mockResolvedValue([]);
    expect((await req(BODY)).status).toBe(404);
  });
});

describe("마진 보존·판매가 재계산·누수0 (SUPPLIER 소유)", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "sup1", role: "SUPPLIER" } }));

  it("기존 base 마진(20%) 보존 → base 판매가=원가+20%, 신규 기간은 base마진 상속", async () => {
    // 기존: base(PERCENT 20) 1행만 (신규 기간은 이 마진 상속)
    tx.villaRatePeriod.findMany.mockResolvedValue([
      { id: "b1", isBase: true, marginType: "PERCENT", marginValue: 20n },
    ]);
    const res = await req(BODY);
    expect(res.status).toBe(200);
    // base는 update(기존 b1) — salePriceVnd = 1,000,000 + 20% = 1,200,000
    expect(tx.villaRatePeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b1" }, data: expect.objectContaining({ salePriceVnd: 1200000n }) })
    );
    // 신규 기간 create — base 마진 20% 상속: 5,000,000 + 20% = 6,000,000
    const created = tx.villaRatePeriod.create.mock.calls.find((c) => c[0].data.isBase === false);
    expect(created?.[0].data.salePriceVnd).toBe(6000000n);
    expect(created?.[0].data.marginValue).toBe(20n);
  });

  it("매칭된 기존 기간은 그 행의 마진 보존(상속 아님)", async () => {
    tx.villaRatePeriod.findMany.mockResolvedValue([
      { id: "b1", isBase: true, marginType: "PERCENT", marginValue: 20n },
      { id: "p1", isBase: false, marginType: "PERCENT", marginValue: 50n }, // 이 기간만 50%
    ]);
    const res = await req({
      ...BODY,
      periods: [{ id: "p1", season: "PEAK", startDate: "2026-02-14", endDate: "2026-02-20", supplierCostVnd: "4000000" }],
    });
    expect(res.status).toBe(200);
    // p1 update — 4,000,000 + 50% = 6,000,000 (base 20% 아님)
    expect(tx.villaRatePeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: expect.objectContaining({ salePriceVnd: 6000000n }) })
    );
  });

  it("응답에 salePrice·margin 미포함 (누수0)", async () => {
    tx.villaRatePeriod.findMany.mockResolvedValue([{ id: "b1", isBase: true, marginType: "PERCENT", marginValue: 20n }]);
    const json = await (await req(BODY)).json();
    expect(JSON.stringify(json)).not.toMatch(/salePrice|margin/i);
    expect(json).toMatchObject({ villaId: "v1", baseCount: 1, periodCount: 1 });
  });

  it("제거된 기존 기간 deleteMany", async () => {
    tx.villaRatePeriod.findMany.mockResolvedValue([
      { id: "b1", isBase: true, marginType: "PERCENT", marginValue: 20n },
      { id: "pOld", isBase: false, marginType: "PERCENT", marginValue: 20n },
    ]);
    await req({ ...BODY, periods: [] }); // pOld 미포함 → 삭제
    expect(tx.villaRatePeriod.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["pOld"] } } });
  });

  it("원가 변경 + ACTIVE 제안 → cost-alerts 호환 알림(season·old/newCostVnd) 발송", async () => {
    // 기존 base 원가 900,000 → 신규 1,000,000(변경). cost-alerts.ts가 BigInt(oldCostVnd) 읽으므로 필수 필드.
    tx.villaRatePeriod.findMany.mockResolvedValue([
      { id: "b1", isBase: true, season: "LOW", supplierCostVnd: 900000n, marginType: "PERCENT", marginValue: 20n },
    ]);
    tx.proposal.findMany.mockResolvedValue([{ id: "pr1" }]);
    tx.user.findMany.mockResolvedValue([{ id: "a1" }]);
    const res = await req(BODY);
    expect(res.status).toBe(200);
    // ADR-0039 — 그룹 미설정 → 운영자 개별 DM fan-out(create). (제안×원가변경)당 헬퍼 1회.
    const alerts = tx.notification.create.mock.calls.map((c) => c[0].data);
    const baseAlert = alerts.find((d) => d.payload.season === "LOW");
    expect(baseAlert?.payload).toMatchObject({
      season: "LOW",
      oldCostVnd: "900000",
      newCostVnd: "1000000",
      proposalId: "pr1",
      villaId: "v1",
    });
  });

  it("원가 변경 없으면 알림·제안조회 안 함 (신규 기간 추가만)", async () => {
    // base 원가 동일(1,000,000), BODY의 기간은 신규(id 없음) → 변경 추적 0
    tx.villaRatePeriod.findMany.mockResolvedValue([
      { id: "b1", isBase: true, season: "LOW", supplierCostVnd: 1000000n, marginType: "PERCENT", marginValue: 20n },
    ]);
    tx.proposal.findMany.mockResolvedValue([{ id: "pr1" }]);
    tx.user.findMany.mockResolvedValue([{ id: "a1" }]);
    await req(BODY);
    expect(tx.proposal.findMany).not.toHaveBeenCalled(); // costChanges 0 → 단락
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it("겹치는 기간 거부 (400)", async () => {
    tx.villaRatePeriod.findMany.mockResolvedValue([]);
    const res = await req({
      ...BODY,
      periods: [
        { season: "PEAK", startDate: "2026-02-10", endDate: "2026-02-20", supplierCostVnd: "5000000" },
        { season: "HIGH", startDate: "2026-02-15", endDate: "2026-02-25", supplierCostVnd: "4000000" },
      ],
    });
    expect(res.status).toBe(400);
  });
});
