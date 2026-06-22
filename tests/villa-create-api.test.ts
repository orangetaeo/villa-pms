import { beforeEach, describe, expect, it, vi } from "vitest";

// T-admin-villa-register — POST /api/villas: SUPPLIER 자기등록 + ADMIN 직접등록(공급자 선택 귀속) 검증
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  villa: { create: vi.fn(async () => ({ id: "villa-new", status: "PENDING_REVIEW" })) },
  villaPhoto: { createMany: vi.fn(async () => ({})) },
  villaAmenity: { createMany: vi.fn(async () => ({})) },
  villaRate: { createMany: vi.fn(async () => ({})) },
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

  it("미인증은 403", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postReq({ ...VALID_BODY });
    expect(res.status).toBe(403);
  });
});
