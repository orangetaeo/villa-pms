// lib/rate-limit 테스트 (T-sec-auth-ratelimit) — now 주입으로 결정적
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  clearAllRateLimits,
  clientIp,
} from "./rate-limit";

beforeEach(() => clearAllRateLimits());

const OPTS = { max: 3, windowMs: 10_000 };

describe("checkRateLimit — 슬라이딩 윈도우", () => {
  it("max까지 허용, 초과부터 차단", () => {
    const t0 = 1_000_000;
    expect(checkRateLimit("k", { ...OPTS, now: t0 }).allowed).toBe(true); // 1
    expect(checkRateLimit("k", { ...OPTS, now: t0 + 1 }).allowed).toBe(true); // 2
    const third = checkRateLimit("k", { ...OPTS, now: t0 + 2 });
    expect(third.allowed).toBe(true); // 3
    expect(third.remaining).toBe(0);
    const fourth = checkRateLimit("k", { ...OPTS, now: t0 + 3 });
    expect(fourth.allowed).toBe(false); // 4 → 차단
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("차단은 카운트를 증가시키지 않음 (이미 기록된 hit만으로 판정)", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("k", { ...OPTS, now: t0 + i });
    // 여러 번 차단 시도해도 윈도우 경과 후 정확히 회복돼야 함
    checkRateLimit("k", { ...OPTS, now: t0 + 5 });
    checkRateLimit("k", { ...OPTS, now: t0 + 6 });
    // 가장 오래된 hit(t0)이 만료되는 시점 = t0 + windowMs + 1
    const after = checkRateLimit("k", { ...OPTS, now: t0 + 10_001 });
    expect(after.allowed).toBe(true);
  });

  it("윈도우 경과 후 회복 (만료 hit 제거)", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("k", { ...OPTS, now: t0 + i }).allowed).toBe(true);
    }
    expect(checkRateLimit("k", { ...OPTS, now: t0 + 100 }).allowed).toBe(false);
    // windowMs 완전 경과 → 전부 만료 → 다시 허용
    expect(checkRateLimit("k", { ...OPTS, now: t0 + 10_101 }).allowed).toBe(true);
  });

  it("retryAfterMs = 가장 오래된 hit 만료까지 남은 시간", () => {
    const t0 = 4_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("k", { ...OPTS, now: t0 });
    const blocked = checkRateLimit("k", { ...OPTS, now: t0 + 4_000 });
    // oldest(t0) + window(10_000) - now(t0+4000) = 6_000
    expect(blocked.retryAfterMs).toBe(6_000);
  });

  it("키 격리 — 다른 키는 독립 카운트", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", { ...OPTS, now: t0 });
    expect(checkRateLimit("a", { ...OPTS, now: t0 }).allowed).toBe(false);
    expect(checkRateLimit("b", { ...OPTS, now: t0 }).allowed).toBe(true);
  });
});

describe("resetRateLimit", () => {
  it("리셋 후 카운트 0 (로그인 성공 시 잠금 해제)", () => {
    const t0 = 6_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("k", { ...OPTS, now: t0 });
    expect(checkRateLimit("k", { ...OPTS, now: t0 }).allowed).toBe(false);
    resetRateLimit("k");
    expect(checkRateLimit("k", { ...OPTS, now: t0 }).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  const h = (entries: Record<string, string>) => new Headers(entries);
  it("x-forwarded-for 첫 IP", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("x-real-ip 폴백", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });
  it("헤더 없음/null → null", () => {
    expect(clientIp(h({}))).toBeNull();
    expect(clientIp(null)).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});
