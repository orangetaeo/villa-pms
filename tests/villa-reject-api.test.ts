import { beforeEach, describe, expect, it, vi } from "vitest";

// auth·prisma·audit-log·cleaning mock (T1.6 패턴)
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/cleaning", () => ({ createInitialInspectionTask: vi.fn(async () => null) }));

const tx = {
  villa: { findUnique: vi.fn(), updateMany: vi.fn() },
  villaPhoto: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
  villaAmenity: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
  // ADR-0014: 요율은 VillaRatePeriod (base 1행 + 전역 비-LOW 시즌 N행). 전역 시즌 없으면 base만.
  villaRatePeriod: {
    deleteMany: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({})),
  },
  seasonPeriod: { findMany: vi.fn(async () => []) },
  notification: {
    create: vi.fn(
      async (_a: { data: { userId: string; type: string; payload: { reason: string } } }) => ({})
    ),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { PATCH, PUT } from "@/app/api/villas/[id]/route";

const patchReq = (body: unknown) =>
  PATCH(
    new Request("http://local/api/villas/v1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

const VALID_PUT_BODY = {
  name: "쏘나씨 V12",
  bedrooms: 2,
  bathrooms: 1,
  maxGuests: 4,
  hasPool: false,
  breakfastAvailable: false,
  photos: [],
  amenities: [],
  rates: { LOW: "1500000", HIGH: "2500000", PEAK: "4000000" },
};
const putReq = (body: unknown) =>
  PUT(
    new Request("http://local/api/villas/v1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

describe("PATCH /api/villas/[id] — REJECT (T1.2b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.villa.findUnique.mockResolvedValue({
      id: "v1", status: "PENDING_REVIEW", supplierId: "sup1", name: "쏘나씨 V12",
    });
    tx.villa.updateMany.mockResolvedValue({ count: 1 });
  });

  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await patchReq({ action: "REJECT", reason: "사진 부족" })).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await patchReq({ action: "REJECT", reason: "사진 부족" })).status).toBe(403);
  });

  it("사유 미입력(빈 문자열) 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect((await patchReq({ action: "REJECT", reason: "   " })).status).toBe(400);
    expect((await patchReq({ action: "REJECT" })).status).toBe(400);
  });

  it("미존재 빌라 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    tx.villa.findUnique.mockResolvedValue(null);
    expect((await patchReq({ action: "REJECT", reason: "사진 부족" })).status).toBe(404);
  });

  it("PENDING_REVIEW 아님(가드 count 0) 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    tx.villa.findUnique.mockResolvedValue({
      id: "v1", status: "ACTIVE", supplierId: "sup1", name: "V12",
    });
    tx.villa.updateMany.mockResolvedValue({ count: 0 });
    expect((await patchReq({ action: "REJECT", reason: "사진 부족" })).status).toBe(409);
  });

  it("성공: REJECTED 전이 + rejectionReason + Notification(VILLA_REJECTED) + AuditLog", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await patchReq({ action: "REJECT", reason: "침실 사진 어두움" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("REJECTED");
    // updateMany 가드: status PENDING_REVIEW + rejectionReason 저장
    expect(tx.villa.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v1", status: "PENDING_REVIEW" },
        data: expect.objectContaining({ status: "REJECTED", rejectionReason: "침실 사진 어두움" }),
      })
    );
    // 공급자 알림 (마진·금액 미포함)
    const notif = tx.notification.create.mock.calls[0]![0].data;
    expect(notif.userId).toBe("sup1");
    expect(notif.type).toBe("VILLA_REJECTED");
    expect(notif.payload.reason).toBe("침실 사진 어두움");
    expect(JSON.stringify(notif.payload)).not.toMatch(/margin|salePrice|krw/i);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });

  it("APPROVE는 rejectionReason 클리어(null)로 전이 — 회귀", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await patchReq({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(tx.villa.updateMany.mock.calls[0][0].data.rejectionReason).toBeNull();
  });
});

describe("PUT /api/villas/[id] — 재제출 (T1.2b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "sup1", status: "REJECTED" });
    tx.villa.updateMany.mockResolvedValue({ count: 1 });
  });

  it("비로그인 401 / ADMIN·CLEANER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(VALID_PUT_BODY)).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect((await putReq(VALID_PUT_BODY)).status).toBe(403);
  });

  it("타인 빌라 404 (존재 비노출)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other", role: "SUPPLIER" } });
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "sup1", status: "REJECTED" });
    expect((await putReq(VALID_PUT_BODY)).status).toBe(404);
  });

  it("비REJECTED(ACTIVE·PENDING_REVIEW) 빌라 409 — 마진 리셋 차단 (QA 조건 3)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup1", role: "SUPPLIER" } });
    tx.villa.findUnique.mockResolvedValue({ id: "v1", supplierId: "sup1", status: "ACTIVE" });
    tx.villa.updateMany.mockResolvedValue({ count: 0 }); // 가드 status REJECTED 불일치
    const res = await putReq(VALID_PUT_BODY);
    expect(res.status).toBe(409);
    // rate deleteMany가 호출되지 않아야 함 (마진 보존)
    expect(tx.villaRatePeriod.deleteMany).not.toHaveBeenCalled();
  });

  it("zod 검증 실패(원가 누락) 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup1", role: "SUPPLIER" } });
    const { rates, ...noRates } = VALID_PUT_BODY;
    void rates;
    expect((await putReq(noRates)).status).toBe(400);
  });

  it("성공: REJECTED→PENDING_REVIEW + rejectionReason null + 전체 교체 + AuditLog", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sup1", role: "SUPPLIER" } });
    const res = await putReq(VALID_PUT_BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("PENDING_REVIEW");
    expect(tx.villa.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v1", supplierId: "sup1", status: "REJECTED" },
        data: expect.objectContaining({ status: "PENDING_REVIEW", rejectionReason: null }),
      })
    );
    expect(tx.villaPhoto.deleteMany).toHaveBeenCalled();
    // base 1행은 항상 create. 전역 비-LOW 시즌이 있을 때만 createMany(여기선 빈 시즌 → create만).
    expect(tx.villaRatePeriod.deleteMany).toHaveBeenCalled();
    expect(tx.villaRatePeriod.create).toHaveBeenCalled();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });
});
