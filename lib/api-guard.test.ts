import { describe, it, expect, vi, beforeEach } from "vitest";

// auth()·recordSecurityEvent를 모킹 (DB·NextAuth 비의존 단위 테스트)
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));

import { auth } from "@/auth";
import { recordSecurityEvent } from "@/lib/security-event";
import { requireAuth, requireCapability, notFoundIfMissing } from "./api-guard";
import { canViewFinance } from "./permissions";

const mockAuth = vi.mocked(auth);
const mockRecord = vi.mocked(recordSecurityEvent);

function reqWith(path = "https://app.test/api/x") {
  return new Request(path, { headers: { "x-forwarded-for": "1.2.3.4" } });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockRecord.mockClear();
});

describe("requireAuth (보안 P0-6)", () => {
  it("미인증이면 401 GuardFail", async () => {
    mockAuth.mockResolvedValue(null as never);
    const g = await requireAuth(reqWith());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
  });

  it("인증되면 userId·role 좁힘", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "OWNER" } } as never);
    const g = await requireAuth(reqWith());
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.userId).toBe("u1");
      expect(g.role).toBe("OWNER");
    }
  });
});

describe("requireCapability", () => {
  it("권한 부족이면 403 + AUTHZ_DENY 기록", async () => {
    mockAuth.mockResolvedValue({ user: { id: "staff1", role: "STAFF" } } as never);
    const g = await requireCapability(canViewFinance, "canViewFinance", reqWith());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(403);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      type: "AUTHZ_DENY",
      actorUserId: "staff1",
      meta: { capability: "canViewFinance", role: "STAFF" },
    });
  });

  it("권한 있으면 통과·기록 없음", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner1", role: "OWNER" } } as never);
    const g = await requireCapability(canViewFinance, "canViewFinance", reqWith());
    expect(g.ok).toBe(true);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("미인증이면 401(기록 없음 — AUTHZ_DENY는 인증 후 권한부족만)", async () => {
    mockAuth.mockResolvedValue(null as never);
    const g = await requireCapability(canViewFinance, "canViewFinance", reqWith());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("notFoundIfMissing — 타인 리소스 404 비노출", () => {
  it("null이면 404", () => {
    const r = notFoundIfMissing(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(404);
  });
  it("있으면 resource 반환", () => {
    const r = notFoundIfMissing({ id: "v1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resource.id).toBe("v1");
  });
});
