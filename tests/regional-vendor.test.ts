// 빌라별 지역 지정 업체 (ADR-0037) — 해석기 매트릭스 + 지정/해제 API 권한·검증·감사로그.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ───────────────────────────────────────────────────────────────
// 1. resolveOrderVendorId 순수 매트릭스 — 주입 db 스텁으로 조회 여부까지 검증(prisma mock 불필요).
// ───────────────────────────────────────────────────────────────
import { resolveOrderVendorId, isRegionalType, REGIONAL_VENDOR_TYPES } from "@/lib/regional-vendor";
import type { ServiceType } from "@prisma/client";

// 해석기 3단계 주입 스텁 (ADR-0038): ① 빌라별 수동 지정 → ② 지역(complex) 커버리지 → ③ 카탈로그 폴백.
function makeDb(
  opts: {
    mapping?: { vendorId: string } | null;
    complex?: string | null;
    regionMatches?: { vendorId: string }[];
  } = {},
) {
  const mapping = opts.mapping ?? null;
  const complex = opts.complex ?? null;
  const regionMatches = opts.regionMatches ?? [];
  const vsvFindUnique = vi.fn(async () => mapping);
  const villaFindUnique = vi.fn(async () => ({ complex }));
  const svrFindMany = vi.fn(async () => regionMatches);
  return {
    db: {
      villaServiceVendor: { findUnique: vsvFindUnique },
      villa: { findUnique: villaFindUnique },
      serviceVendorRegion: { findMany: svrFindMany },
    },
    vsvFindUnique,
    villaFindUnique,
    svrFindMany,
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

describe("resolveOrderVendorId — 3단계 해석 (ADR-0038)", () => {
  it("(a) 수동 지정이 지역 매칭을 이긴다 — 지역 조회 자체를 생략", async () => {
    const { db, vsvFindUnique, villaFindUnique, svrFindMany } = makeDb({
      mapping: { vendorId: "v-manual" },
      complex: "쏘나씨",
      regionMatches: [{ vendorId: "v-region" }],
    });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-manual");
    expect(vsvFindUnique).toHaveBeenCalledWith({
      where: { villaId_serviceType: { villaId: "villa-1", serviceType: "MASSAGE" } },
      select: { vendorId: true },
    });
    // 1단계에서 반환 — 지역 단계 조회 없음
    expect(villaFindUnique).not.toHaveBeenCalled();
    expect(svrFindMany).not.toHaveBeenCalled();
  });

  it("(b) 수동 없음 + 지역 매칭 1곳 → 자동 지정", async () => {
    const { db, villaFindUnique, svrFindMany } = makeDb({
      mapping: null,
      complex: "쏘나씨",
      regionMatches: [{ vendorId: "v-region" }],
    });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-region");
    expect(villaFindUnique).toHaveBeenCalledWith({
      where: { id: "villa-1" },
      select: { complex: true },
    });
    // 지역 매칭 필터는 활성·승인 업체만
    expect(svrFindMany).toHaveBeenCalledWith({
      where: {
        serviceType: "MASSAGE",
        region: "쏘나씨",
        vendor: { active: true, approvalStatus: "APPROVED" },
      },
      select: { vendorId: true },
    });
  });

  it("(c) 매칭 0곳 → 카탈로그 기본 폴백", async () => {
    const { db, svrFindMany } = makeDb({ mapping: null, complex: "쏘나씨", regionMatches: [] });
    const out = await resolveOrderVendorId(
      { itemType: "BARBER" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(svrFindMany).toHaveBeenCalledOnce();
  });

  it("(d) 매칭 2곳 이상 → 자동 지정 금지, 카탈로그 기본 폴백", async () => {
    const { db } = makeDb({
      mapping: null,
      complex: "쏘나씨",
      regionMatches: [{ vendorId: "v-a" }, { vendorId: "v-b" }],
    });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
  });

  it("(e) 비활성/미승인 벤더는 매칭에서 제외(where 필터) → 폴백", async () => {
    // 비활성·미승인은 where(vendor active&APPROVED)로 제외되어 regionMatches가 비게 됨
    const { db, svrFindMany } = makeDb({ mapping: null, complex: "쏘나씨", regionMatches: [] });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(svrFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendor: { active: true, approvalStatus: "APPROVED" },
        }),
      }),
    );
  });

  it("(f) complex null → 지역 조회 없이 폴백", async () => {
    const { db, villaFindUnique, svrFindMany } = makeDb({ mapping: null, complex: null });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(villaFindUnique).toHaveBeenCalledOnce();
    expect(svrFindMany).not.toHaveBeenCalled();
  });

  it("(g) 비지역 타입 → 어떤 조회도 없음, 카탈로그 기본 그대로", async () => {
    const { db, vsvFindUnique, villaFindUnique, svrFindMany } = makeDb({
      mapping: { vendorId: "v-region" },
      complex: "쏘나씨",
      regionMatches: [{ vendorId: "v-region" }],
    });
    const out = await resolveOrderVendorId(
      { itemType: "BBQ" as ServiceType, itemVendorId: "v-catalog", villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(vsvFindUnique).not.toHaveBeenCalled();
    expect(villaFindUnique).not.toHaveBeenCalled();
    expect(svrFindMany).not.toHaveBeenCalled();
  });

  it("villaId 없음 → 조회 생략, 카탈로그 기본 그대로", async () => {
    const { db, vsvFindUnique } = makeDb({ mapping: { vendorId: "v-region" } });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: "v-catalog", villaId: null },
      db,
    );
    expect(out).toBe("v-catalog");
    expect(vsvFindUnique).not.toHaveBeenCalled();
  });

  it("카탈로그 벤더 없음 + 지역 매칭 1곳 → 지역 업체(무벤더 보완)", async () => {
    const { db } = makeDb({ mapping: null, complex: "쏘나씨", regionMatches: [{ vendorId: "v-region" }] });
    const out = await resolveOrderVendorId(
      { itemType: "MASSAGE" as ServiceType, itemVendorId: null, villaId: "villa-1" },
      db,
    );
    expect(out).toBe("v-region");
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
const vendorFindUnique = vi.fn();
const svrDeleteMany = vi.fn();
const svrCreateMany = vi.fn();
const txRun = vi.fn(async (...a: unknown[]) => {
  const ops = a[0];
  return Array.isArray(ops) ? Promise.all(ops) : ops;
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: unknown[]) => txRun(...a),
    villa: { findUnique: (...a: unknown[]) => villaFindUnique(...a) },
    villaServiceVendor: {
      findUnique: (...a: unknown[]) => vsvFindUnique(...a),
      upsert: (...a: unknown[]) => vsvUpsert(...a),
      delete: (...a: unknown[]) => vsvDelete(...a),
    },
    serviceVendor: {
      findFirst: (...a: unknown[]) => vendorFindFirst(...a),
      findUnique: (...a: unknown[]) => vendorFindUnique(...a),
    },
    serviceVendorRegion: {
      deleteMany: (...a: unknown[]) => svrDeleteMany(...a),
      createMany: (...a: unknown[]) => svrCreateMany(...a),
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

import { PUT } from "@/app/api/villas/[id]/service-vendors/route";
import { PUT as PUT_REGIONS } from "@/app/api/vendors/[id]/regions/route";

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
  vendorFindUnique.mockResolvedValue({ id: "v-1" });
  svrDeleteMany.mockResolvedValue({ count: 0 });
  svrCreateMany.mockResolvedValue({ count: 0 });
});

// ───────────────────────────────────────────────────────────────
// 3. PUT /api/vendors/[id]/regions — 업체 담당 지역 커버리지 replace-set (ADR-0038).
// ───────────────────────────────────────────────────────────────
const regionsReq = (body: unknown) =>
  PUT_REGIONS(
    new Request("http://local/api/vendors/v-1/regions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v-1" }) },
  );

describe("PUT /api/vendors/[id]/regions — 권한·검증", () => {
  it("비로그인 401 + DB 미접근", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await regionsReq({ coverage: [{ serviceType: "MASSAGE", regions: ["쏘나씨"] }] });
    expect(res.status).toBe(401);
    expect(vendorFindUnique).not.toHaveBeenCalled();
  });

  it("비운영자(SUPPLIER) 403 + DB 미접근", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s-1", role: "SUPPLIER" } });
    const res = await regionsReq({ coverage: [{ serviceType: "MASSAGE", regions: ["쏘나씨"] }] });
    expect(res.status).toBe(403);
    expect(vendorFindUnique).not.toHaveBeenCalled();
  });

  it("비지역 타입(BBQ)은 400 — REGIONAL_VENDOR_TYPES만 허용", async () => {
    const res = await regionsReq({ coverage: [{ serviceType: "BBQ", regions: ["쏘나씨"] }] });
    expect(res.status).toBe(400);
    expect(svrDeleteMany).not.toHaveBeenCalled();
  });

  it("미존재 벤더 404", async () => {
    vendorFindUnique.mockResolvedValue(null);
    const res = await regionsReq({ coverage: [{ serviceType: "MASSAGE", regions: ["쏘나씨"] }] });
    expect(res.status).toBe(404);
    expect(svrDeleteMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/vendors/[id]/regions — replace-set·정규화·감사·누수", () => {
  it("타입별 replace-set: deleteMany→createMany + 정규화(trim·빈값·중복 제거)", async () => {
    const res = await regionsReq({
      coverage: [{ serviceType: "MASSAGE", regions: ["쏘나씨", " 썬셋 ", "", "쏘나씨"] }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ coverage: [{ serviceType: "MASSAGE", regions: ["쏘나씨", "썬셋"] }] });
    expect(svrDeleteMany).toHaveBeenCalledWith({ where: { vendorId: "v-1", serviceType: "MASSAGE" } });
    expect(svrCreateMany).toHaveBeenCalledWith({
      data: [
        { vendorId: "v-1", serviceType: "MASSAGE", region: "쏘나씨" },
        { vendorId: "v-1", serviceType: "MASSAGE", region: "썬셋" },
      ],
      skipDuplicates: true,
    });
    // 누수: bankInfo·판매가·마진·원가 없음
    expect(JSON.stringify(json)).not.toMatch(/bank|margin|salePrice|cost/i);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "ServiceVendorRegion", action: "UPDATE" }),
    );
  });

  it("빈 regions = 해당 타입 커버리지 전부 해제(deleteMany + createMany 빈 배열)", async () => {
    const res = await regionsReq({ coverage: [{ serviceType: "BARBER", regions: [] }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ coverage: [{ serviceType: "BARBER", regions: [] }] });
    expect(svrDeleteMany).toHaveBeenCalledWith({ where: { vendorId: "v-1", serviceType: "BARBER" } });
    expect(svrCreateMany).toHaveBeenCalledWith({ data: [], skipDuplicates: true });
  });
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
