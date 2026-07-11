import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyCronAuth } from "./cron-auth";

const ORIGINAL = process.env.CRON_SECRET;

function req(auth?: string) {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers["authorization"] = auth;
  return new Request("https://app.villa.test/api/cron/expire-holds", { method: "POST", headers });
}

beforeEach(() => {
  // 콘솔 소음 억제 (미설정 500 경로 로그)
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
  vi.restoreAllMocks();
});

describe("verifyCronAuth (cron Bearer 상수시간 검증)", () => {
  it("CRON_SECRET 미설정 → 500 + 기존 body", () => {
    delete process.env.CRON_SECRET;
    const r = verifyCronAuth(req("Bearer whatever"), "expire-holds");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: "CRON_SECRET이 설정되지 않았습니다" });
    }
  });

  it("미설정 경로는 태그로 로그를 남긴다", () => {
    delete process.env.CRON_SECRET;
    const spy = console.error as unknown as ReturnType<typeof vi.fn>;
    verifyCronAuth(req(), "ical-sync");
    expect(spy).toHaveBeenCalledWith("[cron/ical-sync] CRON_SECRET 미설정");
  });

  it("헤더 불일치 → 401 + unauthorized", () => {
    process.env.CRON_SECRET = "s3cr3t-value";
    const r = verifyCronAuth(req("Bearer wrong-value00"), "notifications");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: "unauthorized" });
    }
  });

  it("Authorization 헤더 부재 → 401", () => {
    process.env.CRON_SECRET = "s3cr3t-value";
    const r = verifyCronAuth(req(), "notifications");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("길이가 다른 토큰 → 401 (조기 반환·예외 없음)", () => {
    process.env.CRON_SECRET = "s3cr3t-value";
    const r = verifyCronAuth(req("Bearer x"), "notifications");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("정확히 일치하는 Bearer 토큰 → 통과", () => {
    process.env.CRON_SECRET = "s3cr3t-value";
    const r = verifyCronAuth(req("Bearer s3cr3t-value"), "expire-holds");
    expect(r.ok).toBe(true);
  });

  it("접두사만 맞고 값이 다르면(길이 동일) → 401", () => {
    process.env.CRON_SECRET = "abcdef";
    // 같은 길이의 잘못된 값 — timingSafeEqual 경로 검증
    const r = verifyCronAuth(req("Bearer ghijkl"), "expire-holds");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
});
