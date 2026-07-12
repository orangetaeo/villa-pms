// 빌라별 지역 지정 업체 (ADR-0037) — 해석기 매트릭스 + 지정/해제 API 권한·검증·감사로그.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ───────────────────────────────────────────────────────────────
// 1. resolveOrderVendorId 순수 매트릭스 — 주입 db 스텁으로 조회 여부까지 검증(prisma mock 불필요).
// ───────────────────────────────────────────────────────────────
import { resolveOrderVendorId, isRegionalType, REGIONAL_VENDOR_TYPES } from "@/lib/regional-vendor";
import type { ServiceType } from "@prisma/client";

function makeDb(mapping: { vendorId: string } | null) {
  const findUnique = vi.fn(async () => mapping);
  return {
    db: { villaServiceVendor: { findUnique } },
    findUnique,
  };
}

describe("REGIONAL_VENDOR_TYPES / isRegionalType", () => {
  it("마사지·이발만 지역 타입", () => {
    expect([...REGIONAL_VENDOR_TYPES]).toEqual(["MASSAGE", "BARBER"]);
    expect(isRegionalType("MASSAGE")).toBe(true);
    expect(isRegionalType("BARBER")).toBe(true);
    expect(isRegionalType("BBQ")).toBe(false);
    expect(isRegionalType("TICKET")).toBe(false);
  });
});

describe("resolveOrderVendorId", () => {
  it("지역 타입 + 매핑 있음 → 지정 업체로 오버라이드", async () => {
    const { db, findUnique } = makeDb({ vendorId: "v-regional" });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-regional");
    expect(findUnique).toHaveBeenCalledWith({
      where: { villaId_serviceType: { villaId: "villa-1", serviceType: "MASSAGE" } },
      select: { vendorId: true },
    });
  });

  it("지역 타입 + 매핑 없음 → 카탈로그 기본 폴백", async () => {
    const { db, findUnique } = makeDb(null);
    const out = await resolveOrderVendorId(
      { itemType: "BARBER" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(findUnique).toHaveBeenCalledOnce();
  });

  it("지역 타입 + 카탈로그 벤더 없음 + 매핑 있음 → 매핑 업체(카탈로그 무벤더 보완)", async () => {
    const { db } = makeDb({ vendorId: "v-regional" });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: null, villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-regional");
  });

  it("비지역 타입 → 조회 생략, 카탈로그 기본 그대로", async () => {
    const { db, findUnique } = makeDb({ vendorId: "v-regional" });
    const out = await resolveOrderVendorId(
      { itemType: "BBQ" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("villaId 없음 → 조회 생략, 카탈로그 기본 그대로", async () => {
    const { db, findUnique } = makeDb({ vendorId: "v-regional" });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: null },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(findUnique).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────
// 2. PUT /api/villas/[id]/service-vendors — 권한·타입 검증·해제·감사로그.
// ───────────────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));

const villaFindUnique = vi.fn();
const vsvFindUnique = vi.fn();
const vsvUpsert = vi.fn();
const vsvDelete = vi.fn();
const vendorFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    villa: { findUnique: (...a: unknown[]) => villaFindUnique(...a) },
    villaServiceVendor: {
      findUnique: (...a: unknown[]) => vsvFindUnique(...a),
      upsert: (...a: unknown[]) => vsvUpsert(...a),
      delete: (...a: unknown[]) => vsvDelete(...a),
    },
    serviceVendor: { findFirst: (...a: unknown[]) => vendorFindFirst(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

import { PUT } from "@/app/api/villas/[id]/service-vendors/route";

const putReq = (body: unknown) =>
  PUT(
    new Request("http://local/api/villas/villa-1/service-vendors", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "villa-1" }) },
  );

const OPERATOR = { user: { id: "op-1", role: "ADMIN" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(OPERATOR);
  villaFindUnique.mockResolvedValue({ id: "villa-1" });
  vendorFindFirst.mockResolvedValue({ id: "v-1" });
  vsvUpsert.mockResolvedValue({ id: "vsv-1", vendorId: "v-1" });
  vsvFindUnique.mockResolvedValue({ id: "vsv-1", vendorId: "v-1" });
  vsvDelete.mockResolvedValue({ id: "vsv-1" });
});

describe("PUT /api/villas/[id]/service-vendors — 권한", () => {
  it("비로그인 401 + DB 미접근", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await putReq({ serviceType: "MASSAGE", vendorId: "v-1" });
    expect(res.status).toBe(401);
    expect(villaFindUnique).not.toHaveBeenCalled();
  });

  it("비운영자(SUPPLIER) 403 + DB 미접근", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s-1", role: "SUPPLIER" } });
    const res = await putReq({ serviceType: "MASSAGE", vendorId: "v-1" });
    expect(res.status).toBe(403);
    expect(villaFindUnique).not.toHaveBeenCalled();
  });
});

describe("PUT /api/villas/[id]/service-vendors — 검증", () => {
  it("비지역 타입(BBQ)은 400 — REGIONAL_VENDOR_TYPES만 허용", async () => {
    const res = await putReq({ serviceType: "BBQ", vendorId: "v-1" });
    expect(res.status).toBe(400);
    expect(vsvUpsert).not.toHaveBeenCalled();
  });

  it("미존재 빌라 404", async () => {
    villaFindUnique.mockResolvedValue(null);
    const res = await putReq({ serviceType: "MASSAGE", vendorId: "v-1" });
    expect(res.status).toBe(404);
    expect(vsvUpsert).not.toHaveBeenCalled();
  });

  it("미승인·비활성 벤더는 400(INVALID_VENDOR)", async () => {
    vendorFindFirst.mockResolvedValue(null);
    const res = await putReq({ serviceType: "MASSAGE", vendorId: "v-x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_VENDOR");
    expect(vsvUpsert).not.toHaveBeenCalled();
  });
});

describe("PUT /api/villas/[id]/service-vendors — 지정·해제·감사", () => {
  it("지정: upsert + AuditLog(VillaServiceVendor UPDATE) + 응답에 vendorId만", async () => {
    const res = await putReq({ serviceType: "MASSAGE", vendorId: "v-1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ serviceType: "MASSAGE", vendorId: "v-1" });
    // 누수: bankInfo·판매가·마진 없음
    expect(JSON.stringify(json)).not.toMatch(/bank|margin|salePrice|cost/i);
    expect(vsvUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { villaId_serviceType: { villaId: "villa-1", serviceType: "MASSAGE" } },
        create: { villaId: "villa-1", serviceType: "MASSAGE", vendorId: "v-1" },
        update: { vendorId: "v-1" },
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "VillaServiceVendor", action: "UPDATE" }),
    );
  });

  it("해제(null): 기존 매핑 delete + AuditLog(DELETE)", async () => {
    const res = await putReq({ serviceType: "BARBER", vendorId: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ serviceType: "BARBER", vendorId: null });
    expect(vsvDelete).toHaveBeenCalledWith({ where: { id: "vsv-1" } });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "VillaServiceVendor", action: "DELETE" }),
    );
    // 해제 경로는 벤더 승인 검증 조회 생략
    expect(vendorFindFirst).not.toHaveBeenCalled();
  });

  it("해제(null): 기존 매핑 없으면 멱등(no delete·no log)", async () => {
    vsvFindUnique.mockResolvedValue(null);
    const res = await putReq({ serviceType: "MASSAGE", vendorId: null });
    expect(res.status).toBe(200);
    expect(vsvDelete).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
