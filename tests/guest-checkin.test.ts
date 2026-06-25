import { describe, it, expect } from "vitest";
import {
  generateGuestToken,
  guestTokenState,
  isGuestTokenUsable,
  defaultGuestTokenExpiry,
} from "@/lib/guest-checkin";

const NOW = new Date("2026-07-16T10:00:00Z");

describe("generateGuestToken", () => {
  it("URL-safe·충분한 길이·매번 다름", () => {
    const a = generateGuestToken();
    const b = generateGuestToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(30);
  });
});

describe("guestTokenState", () => {
  it("회수가 최우선(만료보다 먼저)", () => {
    expect(
      guestTokenState({ expiresAt: new Date("2026-07-20T00:00:00Z"), revokedAt: NOW }, NOW)
    ).toBe("REVOKED");
    // 만료됐어도 회수면 REVOKED
    expect(
      guestTokenState({ expiresAt: new Date("2026-07-01T00:00:00Z"), revokedAt: NOW }, NOW)
    ).toBe("REVOKED");
  });
  it("만료 경계 — expiresAt<=now면 EXPIRED", () => {
    expect(guestTokenState({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("EXPIRED");
    expect(
      guestTokenState({ expiresAt: new Date("2026-07-15T00:00:00Z"), revokedAt: null }, NOW)
    ).toBe("EXPIRED");
  });
  it("미만료·미회수면 OK", () => {
    expect(
      guestTokenState({ expiresAt: new Date("2026-07-20T00:00:00Z"), revokedAt: null }, NOW)
    ).toBe("OK");
    expect(
      isGuestTokenUsable({ expiresAt: new Date("2026-07-20T00:00:00Z"), revokedAt: null }, NOW)
    ).toBe(true);
  });
});

describe("defaultGuestTokenExpiry", () => {
  it("체크아웃 +1일", () => {
    const checkout = new Date("2026-07-18T00:00:00Z");
    expect(defaultGuestTokenExpiry(checkout).toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });
});
