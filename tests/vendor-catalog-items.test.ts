// /api/vendor/catalog-items GET — 품목 필터 셀렉트 소스 테스트 (vendor-board-item-filter)
//   - 본인 vendorId 스코프 품목만(where.vendorId), sortOrder 순
//   - 응답 원소 = { id, name }만 — ★priceVnd·costVnd·audiences 절대 미포함(누수 차단)
//   - 비벤더 403, 미인증 401
import { describe, it, expect, vi, beforeEach } from "vitest";

const catalogFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) } },
}));

const authFn = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => authFn(...a) }));
vi.mock("@/lib/permissions", () => ({ isVendor: (r?: string) => r === "VENDOR" }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a) }));

vi.mock("@/lib/locale", () => ({ getSupplierLocale: vi.fn(async () => "vi") }));
// pickI18n은 실제 로직(ko/i18n)을 흉내 — vi면 nameI18n.vi, 없으면 nameKo.
vi.mock("@/lib/service-display", () => ({
  pickI18n: (ko: string, i18n: unknown, lang: string) => {
    if (lang === "ko" || !i18n || typeof i18n !== "object") return ko;
    const v = (i18n as Record<string, unknown>)[lang];
    return typeof v === "string" && v.trim() ? v : ko;
  },
}));

import { GET } from "@/app/api/vendor/catalog-items/route";

beforeEach(() => {
  vi.clearAllMocks();
  authFn.mockResolvedValue({ user: { id: "vu-1", role: "VENDOR", locale: "vi" } });
  getVendorIdForUser.mockResolvedValue("vd-1");
  catalogFindMany.mockResolvedValue([]);
});

describe("vendor catalog-items GET", () => {
  it("본인 vendorId 스코프 품목만 조회(where.vendorId), sortOrder 순", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const arg = catalogFindMany.mock.calls[0][0] as { where: Record<string, unknown>; orderBy: unknown };
    expect(arg.where.vendorId).toBe("vd-1");
    expect(arg.orderBy).toEqual({ sortOrder: "asc" });
  });

  it("응답 원소 = { id, name }만 — 가격·원가·audiences 미포함", async () => {
    catalogFindMany.mockResolvedValueOnce([
      { id: "ci-1", nameKo: "빈사파리", nameI18n: { vi: "Vinsafari" } },
      { id: "ci-2", nameKo: "키스쇼", nameI18n: null },
    ]);
    const res = await GET();
    const json = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(json.items).toHaveLength(2);
    // vi 현지화 확인
    expect(json.items[0]).toEqual({ id: "ci-1", name: "Vinsafari" });
    expect(json.items[1]).toEqual({ id: "ci-2", name: "키스쇼" }); // i18n 없으면 nameKo 폴백
    // ★누수 방지 — 판매가·원가·마진·audiences 필드 없어야 함
    for (const it of json.items) {
      expect(it).not.toHaveProperty("priceVnd");
      expect(it).not.toHaveProperty("costVnd");
      expect(it).not.toHaveProperty("priceKrw");
      expect(it).not.toHaveProperty("audiences");
    }
  });

  it("비벤더(ADMIN 등) role은 403", async () => {
    authFn.mockResolvedValueOnce({ user: { id: "u-2", role: "ADMIN", locale: "ko" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("미인증은 401", async () => {
    authFn.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("VENDOR지만 연결된 vendor 없으면 403(NOT_A_VENDOR)", async () => {
    getVendorIdForUser.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
