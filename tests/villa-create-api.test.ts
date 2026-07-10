import { beforeEach, describe, expect, it, vi } from "vitest";

// T-admin-villa-register — POST /api/villas: SUPPLIER 자기등록 + ADMIN 직접등록(공급자 선택 귀속) 검증
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
// custom 라벨 번역은 커밋 후 best-effort — 저장 경로 테스트에선 no-op 목으로 격리(개별 실패 케이스만 reject).
const mockTranslateAmenities = vi.fn();
vi.mock("@/lib/amenity-translate", () => ({
  translateVillaCustomAmenities: (...a: unknown[]) => mockTranslateAmenities(...a),
}));

const tx = {
  villa: { create: vi.fn(async () => ({ id: "villa-new", status: "PENDING_REVIEW" })) },
  villaPhoto: { createMany: vi.fn(async () => ({})) },
  villaAmenity: { createMany: vi.fn(async () => ({})) },
  // ADR-0014: 요율은 VillaRatePeriod (base 1행 + 전역 비-LOW 시즌 N행).
  villaRatePeriod: { create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
  seasonPeriod: { findMany: vi.fn(async () => []) },
};
const mockUserFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { POST } from "@/app/api/villas/route";

const VALID_BODY = {
  name: "쏘나씨 V12",
  bedrooms: 3,
  bathrooms: 2,
  maxGuests: 6,
  hasPool: true,
  breakfastAvailable: false,
  photos: [],
  amenities: [],
  rates: { LOW: "1000000", HIGH: "2000000", PEAK: "3000000" },
};

const postReq = (body: unknown) =>
  POST(
    new Request("http://local/api/villas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  tx.villa.create.mockResolvedValue({ id: "villa-new", status: "PENDING_REVIEW" });
  mockTranslateAmenities.mockResolvedValue(undefined);
});

describe("POST /api/villas — SUPPLIER 자기등록", () => {
  it("supplierId를 세션으로 강제하고 바디 supplierId는 무시한다", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const res = await postReq({ ...VALID_BODY, supplierId: "other-supplier" });
    expect(res.status).toBe(201);
    expect(tx.villa.create).toHaveBeenCalledTimes(1);
    const arg = (tx.villa.create.mock.calls[0] as unknown[])[0] as { data: { supplierId: string } };
    expect(arg.data.supplierId).toBe("sup-1"); // 바디 other-supplier 무시
    expect(mockUserFindUnique).not.toHaveBeenCalled(); // SUPPLIER는 공급자 조회 안 함
  });
});

describe("POST /api/villas — ADMIN 직접등록", () => {
  it("공급자 미선택이면 400 SUPPLIER_REQUIRED", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    const res = await postReq({ ...VALID_BODY }); // supplierId 없음
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "SUPPLIER_REQUIRED" });
    expect(tx.villa.create).not.toHaveBeenCalled();
  });

  it("비SUPPLIER id를 보내면 400 INVALID_SUPPLIER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mockUserFindUnique.mockResolvedValue({ id: "admin-2", role: "ADMIN" }); // SUPPLIER 아님
    const res = await postReq({ ...VALID_BODY, supplierId: "admin-2" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_SUPPLIER" });
    expect(tx.villa.create).not.toHaveBeenCalled();
  });

  it("존재하지 않는 공급자면 400 INVALID_SUPPLIER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mockUserFindUnique.mockResolvedValue(null);
    const res = await postReq({ ...VALID_BODY, supplierId: "ghost" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_SUPPLIER" });
  });

  it("유효한 공급자 선택 시 201 + 빌라가 그 공급자에 귀속, 감사로그 actor=ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mockUserFindUnique.mockResolvedValue({ id: "sup-9", role: "SUPPLIER" });
    const res = await postReq({ ...VALID_BODY, supplierId: "sup-9" });
    expect(res.status).toBe(201);
    const arg = (tx.villa.create.mock.calls[0] as unknown[])[0] as { data: { supplierId: string } };
    expect(arg.data.supplierId).toBe("sup-9"); // 선택 공급자 귀속
    // 감사로그 — actor는 ADMIN, 귀속 supplier 기록
    const audit = (writeAuditLog as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      userId: string;
      changes: { supplierId: { new: string } };
    };
    expect(audit.userId).toBe("admin-1");
    expect(audit.changes.supplierId.new).toBe("sup-9");
  });
});

describe("POST /api/villas — 권한", () => {
  it("CLEANER 등 그 외 역할은 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "c-1", role: "CLEANER" } });
    const res = await postReq({ ...VALID_BODY });
    expect(res.status).toBe(403);
  });

  it("미인증은 401", async () => {
    // P1-S8: 중앙 가드(requireAuth)가 미인증을 401로 표준화(이전엔 복합조건이 403 반환).
    // 인증됐으나 권한 없는 경우(CLEANER)는 위 케이스대로 여전히 403.
    mockAuth.mockResolvedValue(null);
    const res = await postReq({ ...VALID_BODY });
    expect(res.status).toBe(401);
  });
});

describe("#2b 생성 시 MINIBAR 비품 drop (회사표준 분리)", () => {
  it("마법사가 MINIBAR를 보내도 createMany엔 비-MINIBAR만 저장", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const res = await postReq({
      ...VALID_BODY,
      amenities: [
        { category: "KITCHEN", itemKey: "riceCooker", quantity: 1 },
        { category: "MINIBAR", itemKey: "water", quantity: 5 },
      ],
    });
    expect(res.status).toBe(201);
    const arg = (tx.villaAmenity.createMany.mock.calls[0] as unknown[])[0] as {
      data: { category: string }[];
    };
    const cats = arg.data.map((a) => a.category);
    expect(cats).toContain("KITCHEN");
    expect(cats).not.toContain("MINIBAR");
  });
});

describe("POST /api/villas — 직접입력(custom) 비품", () => {
  it("허용 카테고리(KITCHEN) custom 항목을 customLabel과 함께 저장한다", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const res = await postReq({
      ...VALID_BODY,
      amenities: [
        { category: "KITCHEN", itemKey: "custom", quantity: 2, customLabel: "Máy xay sinh tố" },
      ],
    });
    expect(res.status).toBe(201);
    const arg = (tx.villaAmenity.createMany.mock.calls[0] as unknown[])[0] as {
      data: { itemKey: string; customLabel: string | null; quantity: number }[];
    };
    expect(arg.data[0]).toMatchObject({
      itemKey: "custom",
      customLabel: "Máy xay sinh tố",
      quantity: 2,
    });
  });

  it("custom인데 customLabel 누락이면 400 VALIDATION_FAILED", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const res = await postReq({
      ...VALID_BODY,
      amenities: [{ category: "BATHROOM", itemKey: "custom", quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION_FAILED");
    expect(tx.villaAmenity.createMany).not.toHaveBeenCalled();
  });

  it("카테고리당 custom 10개 초과면 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      category: "APPLIANCE" as const,
      itemKey: "custom",
      quantity: 1,
      customLabel: `item ${i}`,
    }));
    const res = await postReq({ ...VALID_BODY, amenities: eleven });
    expect(res.status).toBe(400);
    expect(tx.villaAmenity.createMany).not.toHaveBeenCalled();
  });

  it("MINIBAR custom도 회사표준 분리로 drop 유지(비-MINIBAR custom만 저장)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const res = await postReq({
      ...VALID_BODY,
      amenities: [
        { category: "KITCHEN", itemKey: "custom", quantity: 1, customLabel: "Nồi áp suất" },
        { category: "MINIBAR", itemKey: "custom", quantity: 3, customLabel: "Rượu vang" },
      ],
    });
    expect(res.status).toBe(201);
    const arg = (tx.villaAmenity.createMany.mock.calls[0] as unknown[])[0] as {
      data: { category: string }[];
    };
    expect(arg.data.map((a) => a.category)).toEqual(["KITCHEN"]);
  });

  it("임의 itemKey 주입은 여전히 400(사전 검증)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    const res = await postReq({
      ...VALID_BODY,
      amenities: [{ category: "KITCHEN", itemKey: "__hacked__", quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(tx.villaAmenity.createMany).not.toHaveBeenCalled();
  });

  it("번역 파이프라인이 실패해도 저장 응답은 201(격리)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup-1", role: "SUPPLIER" } });
    mockTranslateAmenities.mockRejectedValue(new Error("gemini down"));
    const res = await postReq({
      ...VALID_BODY,
      amenities: [
        { category: "KITCHEN", itemKey: "custom", quantity: 1, customLabel: "Bình đun nước" },
      ],
    });
    expect(res.status).toBe(201);
    expect(mockTranslateAmenities).toHaveBeenCalledWith("villa-new");
  });
});
