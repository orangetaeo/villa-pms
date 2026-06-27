import { describe, it, expect, beforeEach } from "vitest";
import { evaluateRequest, __config } from "./ddos-guard";
import { clearAllRateLimits } from "./rate-limit";

beforeEach(() => clearAllRateLimits());

const NOW = 1_000_000;

describe("evaluateRequest — L7 플러드/본문 가드 (보안 P1-S11)", () => {
  it("한도 내 요청은 통과(null)", () => {
    for (let i = 0; i < 50; i++) {
      expect(evaluateRequest({ pathname: "/dashboard", ip: "1.1.1.1", contentLength: null, now: NOW })).toBeNull();
    }
  });

  it("전역 IP 한도 초과 시 429 + retryAfterMs", () => {
    const max = __config.GLOBAL_MAX;
    for (let i = 0; i < max; i++) {
      evaluateRequest({ pathname: "/api/x", ip: "2.2.2.2", contentLength: null, now: NOW });
    }
    const blocked = evaluateRequest({ pathname: "/api/x", ip: "2.2.2.2", contentLength: null, now: NOW });
    expect(blocked?.status).toBe(429);
    expect(blocked?.reason).toBe("rate_limited");
    expect(blocked?.retryAfterMs).toBeGreaterThan(0);
  });

  it("IP별 카운터 격리 — 한 IP 차단이 다른 IP에 영향 없음", () => {
    const max = __config.GLOBAL_MAX;
    for (let i = 0; i < max + 5; i++) {
      evaluateRequest({ pathname: "/api/x", ip: "3.3.3.3", contentLength: null, now: NOW });
    }
    expect(evaluateRequest({ pathname: "/api/x", ip: "4.4.4.4", contentLength: null, now: NOW })).toBeNull();
  });

  it("본문 크기 상한 초과 시 413(킬스위치·IP 무관 항상 적용)", () => {
    const over = __config.MAX_BODY_BYTES + 1;
    const d = evaluateRequest({ pathname: "/api/uploads", ip: null, contentLength: over, now: NOW });
    expect(d?.status).toBe(413);
    expect(d?.reason).toBe("body_too_large");
  });

  it("정상 크기 본문은 통과", () => {
    const ok = __config.MAX_BODY_BYTES - 1;
    expect(evaluateRequest({ pathname: "/api/uploads", ip: "5.5.5.5", contentLength: ok, now: NOW })).toBeNull();
  });

  it("SSE 스트림 경로는 플러드·본문 검사 제외", () => {
    const max = __config.GLOBAL_MAX;
    for (let i = 0; i < max + 100; i++) {
      expect(evaluateRequest({ pathname: "/api/zalo/stream", ip: "6.6.6.6", contentLength: null, now: NOW })).toBeNull();
    }
  });

  it("IP 미상이면 플러드 검사 생략(본문 검사는 유지)", () => {
    // IP null → 플러드 검사 안 함(통과)
    expect(evaluateRequest({ pathname: "/api/x", ip: null, contentLength: null, now: NOW })).toBeNull();
  });
});
