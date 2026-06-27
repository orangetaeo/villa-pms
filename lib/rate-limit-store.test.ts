import { describe, it, expect, afterEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  clearAllRateLimits,
  setRateLimitStore,
  MemoryRateLimitStore,
  type RateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rate-limit";

// 테스트 종료 시 기본 메모리 스토어로 복원(타 테스트 격리).
afterEach(() => {
  setRateLimitStore(new MemoryRateLimitStore());
});

describe("MemoryRateLimitStore (보안 P1-S4 추상화)", () => {
  it("기존 동작 보존 — 한도 내 allowed, 초과 시 차단", () => {
    const s = new MemoryRateLimitStore();
    const opts: RateLimitOptions = { max: 2, windowMs: 1000, now: 1000 };
    expect(s.check("k", opts).allowed).toBe(true);
    expect(s.check("k", opts).allowed).toBe(true);
    const blocked = s.check("k", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("reset/clear 동작", () => {
    const s = new MemoryRateLimitStore();
    s.check("k", { max: 1, windowMs: 1000, now: 0 });
    expect(s.check("k", { max: 1, windowMs: 1000, now: 0 }).allowed).toBe(false);
    s.reset("k");
    expect(s.check("k", { max: 1, windowMs: 1000, now: 0 }).allowed).toBe(true);
    s.clear();
    expect(s.check("k", { max: 1, windowMs: 1000, now: 0 }).allowed).toBe(true);
  });
});

describe("setRateLimitStore — 백엔드 주입(후속 Redis 교체점)", () => {
  it("주입한 스토어로 모든 호출이 위임된다", () => {
    const calls: string[] = [];
    const fake: RateLimitStore = {
      check: (key): RateLimitResult => {
        calls.push(`check:${key}`);
        return { allowed: false, remaining: 0, retryAfterMs: 42 };
      },
      reset: (key) => calls.push(`reset:${key}`),
      clear: () => calls.push("clear"),
    };
    setRateLimitStore(fake);

    const r = checkRateLimit("login:phone:123", { max: 5, windowMs: 1000 });
    expect(r).toEqual({ allowed: false, remaining: 0, retryAfterMs: 42 });
    resetRateLimit("login:phone:123");
    clearAllRateLimits();

    expect(calls).toEqual(["check:login:phone:123", "reset:login:phone:123", "clear"]);
  });
});
