import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/partners/options — 경량 파트너 목록 (PARTNER-qa-polish)
 * 누수 가드(canViewFinance 외 차단) + type 필터 + light shape 검증.
 */
const mockAuth = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { partner: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

import { GET } from "../app/api/partners/options/route";

const req = (qs = "") =>
  GET(new Request(`http://local/api/partners/options${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([
    { id: "p1", name: "A여행사", nameVi: null, type: "TRAVEL_AGENCY", creditTier: "B", status: "ACTIVE" },
  ]);
});

describe("GET /api/partners/options", () => {
  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await req()).status).toBe(403);
  });
  it("SUPPLIER → 403 (누수 차단)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s", role: "SUPPLIER" } });
    expect((await req()).status).toBe(403);
  });
  it("비로그인 → 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req()).status).toBe(401);
  });
  it("ADMIN → 200 + light shape(미수·Aging 미포함)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    const res = await req();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partners[0]).toEqual({
      id: "p1",
      name: "A여행사",
      nameVi: null,
      type: "TRAVEL_AGENCY",
      creditTier: "B",
      status: "ACTIVE",
    });
    expect(body.partners[0]).not.toHaveProperty("outstandingVnd");
  });
  it("?type=LAND_AGENCY → where 필터 전달", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    await req("?type=LAND_AGENCY");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: "LAND_AGENCY" } })
    );
  });
  it("잘못된 type → 필터 없이 전체(where undefined)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    await req("?type=BOGUS");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });
});
