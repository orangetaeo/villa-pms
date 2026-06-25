import { beforeEach, describe, expect, it, vi } from "vitest";

// #2b 미니바 회사표준 전환 — PATCH /api/villas/[id]/amenities 누수·격리 검증.
// 미니바는 더 이상 빌라별이 아니다(MinibarItem, /settings/minibar). 누가 보내든:
//  - MINIBAR 항목은 silent drop(createMany에 미포함) — SUPPLIER·운영자 동일.
//  - deleteMany는 항상 비-MINIBAR로 스코프 → 레거시 MINIBAR 행은 S3 폐기까지 보존.
//  - 비-MINIBAR 저장은 회귀 0. unitPrice는 항상 null(빌라별 미니바 단가 저장 폐기).
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  villa: { findUnique: vi.fn() },
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

const KITCHEN = { category: "KITCHEN", itemKey: "riceCooker", quantity: 1 };
const MINIBAR = { category: "MINIBAR", itemKey: "water", quantity: 5, unitPrice: "30000" };

const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/villas/v1/amenities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

// createMany에 실린 data 배열 (없으면 [] — createMany 미호출 시).
// mock fn이 무인자라 calls가 빈 튜플로 추론되므로 unknown 경유 캐스트.
const createdData = () => {
  const calls = tx.villaAmenity.createMany.mock.calls as unknown as Array<
    [{ data: { category: string; unitPrice: bigint | null }[] }]
  >;
  return calls[0]?.[0]?.data ?? [];
};
const deleteWhere = () => {
  const calls = tx.villaAmenity.deleteMany.mock.calls as unknown as Array<
    [{ where: Record<string, unknown> }]
  >;
  return calls[0][0].where;
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "s1", _count: { amenities: 3 } });
});

describe("#2b SUPPLIER 미니바 누수 차단", () => {
  it("SUPPLIER가 MINIBAR를 보내도 createMany에 미포함 (silent drop)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    const res = await req({ amenities: [KITCHEN, MINIBAR] });
    expect(res.status).toBe(200);
    const cats = createdData().map((a) => a.category);
    expect(cats).toContain("KITCHEN");
    expect(cats).not.toContain("MINIBAR"); // 미니바 판매가 차단
    // 응답 개수도 비-MINIBAR만
    expect((await res.json()).amenityCount).toBe(1);
  });

  it("SUPPLIER deleteMany는 비-MINIBAR로 스코프 → 기존 미니바 보존", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    await req({ amenities: [KITCHEN] });
    expect(deleteWhere()).toEqual({ villaId: "v1", category: { not: "MINIBAR" } });
  });

  it("SUPPLIER가 비-MINIBAR만 보내면 정상 저장 (회귀 없음)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    const res = await req({ amenities: [KITCHEN] });
    expect(res.status).toBe(200);
    expect(createdData().map((a) => a.category)).toEqual(["KITCHEN"]);
  });

  it("SUPPLIER가 MINIBAR만 보내면 createMany 미호출(빈 결과) + 개수 0", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    const res = await req({ amenities: [MINIBAR] });
    expect(res.status).toBe(200);
    expect(createdData()).toEqual([]); // 전부 drop → createMany 미호출
    expect((await res.json()).amenityCount).toBe(0);
  });
});

describe("#2b 운영자도 미니바 빌라별 저장 안 함 (회사표준 분리)", () => {
  it("OWNER가 MINIBAR를 보내도 createMany에 미포함 (drop)", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "s-other", _count: { amenities: 0 } });
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    const res = await req({ amenities: [KITCHEN, MINIBAR] });
    expect(res.status).toBe(200);
    const cats = createdData().map((a) => a.category);
    expect(cats).toContain("KITCHEN");
    expect(cats).not.toContain("MINIBAR"); // 빌라별 미니바 저장 폐기
    expect((await res.json()).amenityCount).toBe(1);
  });

  it("운영자 deleteMany도 비-MINIBAR 스코프 → 레거시 미니바 행 보존(S3 폐기 전)", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "s-other", _count: { amenities: 0 } });
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    await req({ amenities: [KITCHEN, MINIBAR] });
    expect(deleteWhere()).toEqual({ villaId: "v1", category: { not: "MINIBAR" } });
  });

  it("비-MINIBAR 항목 unitPrice는 항상 null (빌라별 단가 저장 폐기)", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "s-other", _count: { amenities: 0 } });
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    await req({ amenities: [KITCHEN] });
    expect(createdData().every((a) => a.unitPrice === null)).toBe(true);
  });
});
