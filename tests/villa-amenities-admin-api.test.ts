import { beforeEach, describe, expect, it, vi } from "vitest";

// Batch A — 비품 ADMIN CRUD 확장. PATCH /api/villas/[id]/amenities 권한·스코프 검증.
// 운영자(OWNER/MANAGER/STAFF/ADMIN)는 모든 빌라 편집, SUPPLIER는 자기 빌라만, 그 외 403.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));

vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  villa: {
    findUnique: vi.fn(),
  },
  villaAmenity: {
    deleteMany: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({})),
  },
};
const transactionSpy = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: unknown) => Promise<unknown>) => transactionSpy(fn) },
}));

import { PATCH } from "@/app/api/villas/[id]/amenities/route";

const BODY = { amenities: [{ category: "KITCHEN", itemKey: "riceCooker", quantity: 1 }] };
const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/villas/v1/amenities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 빌라는 다른 공급자(s-other) 소유
  tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "s-other", _count: { amenities: 0 } });
});

describe("권한 — 운영자 모든 빌라 / SUPPLIER 자기 빌라만", () => {
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req(BODY)).status).toBe(401);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("OWNER는 타인 소유 빌라도 편집 가능 (200)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    expect((await req(BODY)).status).toBe(200);
  });

  it("STAFF도 비품 편집 가능 (운영 실무 — 비품은 돈 아님, 200)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "st1", role: "STAFF" } });
    expect((await req(BODY)).status).toBe(200);
  });

  it("SUPPLIER는 타인 빌라 404 (존재 미누설)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await req(BODY)).status).toBe(404);
  });

  it("SUPPLIER는 자기 빌라 200", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "s1", _count: { amenities: 0 } });
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await req(BODY)).status).toBe(200);
  });

  it("CLEANER 403 (운영자도 공급자도 아님)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await req(BODY)).status).toBe(403);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
});
