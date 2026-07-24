// GET /api/proposals/candidates — USD 자동환산 회귀 (Phase 2)
//   - USD + 환율설정 → totalSaleUsd = suggestSalePriceUsd(VND 요율표 총액, fx), usdAuto=true
//   - USD + 환율미설정 → usdAuto=false, totalSaleUsd=null(수동 입력 폴백)
//   - USD 자동환산 + VND 판매가 0 → "판매가 미책정" warning(후보 제외)
//   - 비-USD(KRW)는 usdAuto undefined, 환율조회 자체를 안 함(비-USD 동작 불변)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Currency } from "@prisma/client";

// ── auth / prisma / 의존성 목 ──
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

const villaFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { villa: { findMany: (...a: unknown[]) => villaFindMany(...a) } },
}));

const findSellableVillaIds = vi.fn();
vi.mock("@/lib/availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/availability")>();
  return { ...actual, findSellableVillaIds: (...a: unknown[]) => findSellableVillaIds(...a) };
});

// quoteStayForVilla만 목 — suggestSalePriceUsd·MissingRateError는 실제(importOriginal)
const quoteStayForVilla = vi.fn();
vi.mock("@/lib/pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pricing")>();
  return { ...actual, quoteStayForVilla: (...a: unknown[]) => quoteStayForVilla(...a) };
});

const getEffectiveFxVndPerUsd = vi.fn();
vi.mock("@/lib/fx-effective", () => ({
  getEffectiveFxVndPerUsd: (...a: unknown[]) => getEffectiveFxVndPerUsd(...a),
}));

vi.mock("@/lib/permissions", () => ({ canSetPrice: () => true }));

import { GET } from "@/app/api/proposals/candidates/route";
import { suggestSalePriceUsd } from "@/lib/pricing";

const req = (params: Record<string, string>) =>
  new Request(`http://localhost/api/proposals/candidates?${new URLSearchParams(params).toString()}`);

const DATES = { checkIn: "2026-07-01", checkOut: "2026-07-04" };

describe("GET /api/proposals/candidates — USD 자동환산", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { role: "OWNER" } });
    findSellableVillaIds.mockResolvedValue(["v1"]);
    villaFindMany.mockResolvedValue([
      {
        id: "v1",
        name: "빌라1",
        complex: null,
        bedrooms: 2,
        bathrooms: 2,
        maxGuests: 4,
        hasPool: true,
        breakfastAvailable: false,
        extraBedAvailable: false,
        qualityScore: 90,
        photos: [],
      },
    ]);
  });

  it("(a) USD+환율설정 → totalSaleUsd = suggestSalePriceUsd(VND총액, fx), usdAuto=true", async () => {
    getEffectiveFxVndPerUsd.mockResolvedValue("25400");
    quoteStayForVilla.mockResolvedValue({
      nights: 3,
      saleCurrency: Currency.VND,
      nightly: [],
      totalSaleVnd: 38_100_000n,
      totalSupplierCostVnd: 18_000_000n,
    });
    const res = await GET(req({ ...DATES, saleCurrency: "USD", channel: "DIRECT" }));
    const body = await res.json();
    expect(body.usdAuto).toBe(true);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].totalSaleUsd).toBe(suggestSalePriceUsd(38_100_000n, "25400"));
    expect(body.candidates[0].totalSaleUsd).toBe(1_500);
    // 자동환산 기준을 위해 VND로 견적(채널 tier 전달)했는지
    expect(quoteStayForVilla).toHaveBeenCalledWith(
      expect.anything(),
      "v1",
      expect.anything(),
      Currency.VND,
      "DIRECT"
    );
  });

  it("USD+환율미설정 → usdAuto=false, totalSaleUsd=null(수동 입력 폴백)", async () => {
    getEffectiveFxVndPerUsd.mockResolvedValue(null);
    quoteStayForVilla.mockResolvedValue({
      nights: 3,
      saleCurrency: Currency.VND,
      nightly: [],
      totalSaleVnd: 38_100_000n,
      totalSupplierCostVnd: 18_000_000n,
    });
    const res = await GET(req({ ...DATES, saleCurrency: "USD", channel: "DIRECT" }));
    const body = await res.json();
    expect(body.usdAuto).toBe(false);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].totalSaleUsd).toBeNull();
  });

  it("USD 자동환산 + VND 판매가 0 → 판매가 미책정 warning(후보 제외)", async () => {
    getEffectiveFxVndPerUsd.mockResolvedValue("25400");
    quoteStayForVilla.mockResolvedValue({
      nights: 3,
      saleCurrency: Currency.VND,
      nightly: [],
      totalSaleVnd: 0n,
      totalSupplierCostVnd: 18_000_000n,
    });
    const res = await GET(req({ ...DATES, saleCurrency: "USD", channel: "DIRECT" }));
    const body = await res.json();
    expect(body.candidates).toHaveLength(0);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0].reason).toContain("미책정");
  });

  it("비-USD(KRW)는 usdAuto undefined, 환율조회 안 함(동작 불변)", async () => {
    quoteStayForVilla.mockResolvedValue({
      nights: 3,
      saleCurrency: Currency.KRW,
      nightly: [],
      totalSaleKrw: 1_000_000,
      totalSupplierCostVnd: 18_000_000n,
    });
    const res = await GET(req({ ...DATES, saleCurrency: "KRW", channel: "DIRECT" }));
    const body = await res.json();
    expect(body.usdAuto).toBeUndefined();
    expect(getEffectiveFxVndPerUsd).not.toHaveBeenCalled();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].totalSaleUsd).toBeNull();
    expect(body.candidates[0].totalSaleKrw).toBe(1_000_000);
  });
});
