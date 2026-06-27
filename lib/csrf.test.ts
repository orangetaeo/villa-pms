import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));

import { assertSameOrigin } from "./csrf";
import { recordSecurityEvent } from "@/lib/security-event";

const mockRecord = vi.mocked(recordSecurityEvent);

function req(headers: Record<string, string>) {
  return new Request("https://app.villa.test/api/g/x/agreement", { method: "POST", headers });
}

beforeEach(() => mockRecord.mockClear());

describe("assertSameOrigin (보안 P1-S9 CSRF)", () => {
  it("Origin 없으면 통과(서버간 호출·null Origin) — 파괴적 미차단 아님", async () => {
    const r = await assertSameOrigin(req({ host: "app.villa.test" }), "g-agreement");
    expect(r).toBeNull();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("동일 출처 Origin은 통과", async () => {
    const r = await assertSameOrigin(req({ origin: "https://app.villa.test", host: "app.villa.test" }), "g-agreement");
    expect(r).toBeNull();
  });

  it("교차 출처 Origin은 403 + CSRF_BLOCK 기록", async () => {
    const r = await assertSameOrigin(req({ origin: "https://evil.example.com", host: "app.villa.test" }), "g-agreement");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CSRF_BLOCK", meta: expect.objectContaining({ originHost: "evil.example.com", host: "app.villa.test" }) }),
    );
  });

  it("X-Forwarded-Host(프록시) 기준으로도 동일 출처 인식", async () => {
    const r = await assertSameOrigin(
      req({ origin: "https://app.villa.test", "x-forwarded-host": "app.villa.test", host: "internal:3000" }),
      "p-hold",
    );
    expect(r).toBeNull();
  });

  it("깨진 Origin 값은 403", async () => {
    const r = await assertSameOrigin(req({ origin: "not-a-url", host: "app.villa.test" }), "g-passport");
    expect(r!.status).toBe(403);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ type: "CSRF_BLOCK", meta: expect.objectContaining({ reason: "bad_origin" }) }));
  });

  it("포트 다른 동일 호스트는 교차 출처로 본다(host 비교)", async () => {
    const r = await assertSameOrigin(req({ origin: "https://app.villa.test:8443", host: "app.villa.test" }), "g-agreement");
    expect(r!.status).toBe(403);
  });
});
