import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));

import { guestRateLimit, GUEST_RL_UPLOAD } from "./guest-rate-limit";
import { clearAllRateLimits } from "./rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";

const mockRecord = vi.mocked(recordSecurityEvent);

function req(ip = "9.9.9.9") {
  return new Request("https://app.test/api/g/x/service-orders", { headers: { "x-forwarded-for": ip } });
}

beforeEach(() => {
  clearAllRateLimits();
  mockRecord.mockClear();
});

describe("guestRateLimit (보안 P0-3)", () => {
  it("기본 한도(토큰 30) 내에서는 null(통과)", async () => {
    for (let i = 0; i < 30; i++) {
      const r = await guestRateLimit("g-service-orders", "tokA", req());
      expect(r).toBeNull();
    }
  });

  it("토큰 한도 초과 시 429 + RATE_LIMIT 기록", async () => {
    for (let i = 0; i < 30; i++) await guestRateLimit("g-service-orders", "tokB", req());
    const r = await guestRateLimit("g-service-orders", "tokB", req());
    expect(r).not.toBeNull();
    expect(r!.status).toBe(429);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ type: "RATE_LIMIT", meta: { scope: "g-service-orders", by: "token" } }));
  });

  it("업로드 한도는 더 낮다(토큰 10)", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await guestRateLimit("g-passport", "tokC", req(), GUEST_RL_UPLOAD);
      expect(r).toBeNull();
    }
    const blocked = await guestRateLimit("g-passport", "tokC", req(), GUEST_RL_UPLOAD);
    expect(blocked!.status).toBe(429);
  });

  it("스코프가 다르면 카운터 격리(주문 한도가 여권에 영향 없음)", async () => {
    for (let i = 0; i < 30; i++) await guestRateLimit("g-service-orders", "tokD", req());
    // 같은 토큰이라도 다른 스코프는 별도 버킷
    const r = await guestRateLimit("g-agreement", "tokD", req());
    expect(r).toBeNull();
  });
});
