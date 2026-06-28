import { describe, it, expect } from "vitest";
import {
  evaluateSecurityTriggers,
  applyCooldown,
  SECURITY_ALERT_THRESHOLDS,
  type SecurityEventLite,
  type SecurityTrigger,
} from "./security-alerts";

const ev = (type: string, o: Partial<SecurityEventLite> = {}): SecurityEventLite => ({
  type,
  actorUserId: o.actorUserId ?? null,
  actorPhone: o.actorPhone ?? null,
  ip: o.ip ?? null,
});
const many = (n: number, type: string, o: Partial<SecurityEventLite> = {}) =>
  Array.from({ length: n }, () => ev(type, o));

const T = SECURITY_ALERT_THRESHOLDS;

describe("evaluateSecurityTriggers — 임계치 (보안 P3-S3)", () => {
  it("빈 입력 → 트리거 없음", () => {
    expect(evaluateSecurityTriggers([])).toEqual([]);
  });

  it("LOGIN_FAIL: 한 phone이 임계 이상이면 LOGIN_FAIL_SPIKE + top=phone", () => {
    const out = evaluateSecurityTriggers(many(T.loginFailPerActor, "LOGIN_FAIL", { actorPhone: "0900" }));
    expect(out).toEqual([{ category: "LOGIN_FAIL_SPIKE", count: T.loginFailPerActor, top: "0900" }]);
  });

  it("LOGIN_FAIL: 임계 미만이면 무발화 (여러 actor에 분산되면 그룹별로 셈)", () => {
    const half = Math.floor(T.loginFailPerActor / 2);
    const events = [
      ...many(half, "LOGIN_FAIL", { actorPhone: "A" }),
      ...many(half, "LOGIN_FAIL", { actorPhone: "B" }),
    ];
    expect(evaluateSecurityTriggers(events)).toEqual([]);
  });

  it("LOGIN_FAIL: phone 없으면 ip로 그룹", () => {
    const out = evaluateSecurityTriggers(many(T.loginFailPerActor, "LOGIN_FAIL", { ip: "1.2.3.4" }));
    expect(out[0]).toMatchObject({ category: "LOGIN_FAIL_SPIKE", top: "1.2.3.4" });
  });

  it("AUTHZ_DENY: 한 userId가 임계 이상이면 AUTHZ_DENY_SPIKE", () => {
    const out = evaluateSecurityTriggers(many(T.authzDenyPerUser, "AUTHZ_DENY", { actorUserId: "u1" }));
    expect(out).toEqual([{ category: "AUTHZ_DENY_SPIKE", count: T.authzDenyPerUser, top: "u1" }]);
  });

  it("CRED_DECRYPT_FAIL·SSRF_BLOCK: 1건이면 즉시 발화", () => {
    const out = evaluateSecurityTriggers([ev("CRED_DECRYPT_FAIL"), ev("SSRF_BLOCK", { ip: "10.0.0.1" })]);
    expect(out).toContainEqual({ category: "CRED_DECRYPT_FAIL", count: 1, top: null });
    expect(out).toContainEqual({ category: "SSRF_BLOCK", count: 1, top: "10.0.0.1" });
  });

  it("RATE_LIMIT: 총량이 임계 이상이면 RATE_LIMIT_FLOOD", () => {
    const out = evaluateSecurityTriggers(many(T.rateLimitTotal, "RATE_LIMIT", { ip: "x" }));
    expect(out).toContainEqual({ category: "RATE_LIMIT_FLOOD", count: T.rateLimitTotal, top: null });
  });

  it("RATE_LIMIT: 임계 미만이면 무발화", () => {
    expect(evaluateSecurityTriggers(many(T.rateLimitTotal - 1, "RATE_LIMIT"))).toEqual([]);
  });

  it("여러 트리거 동시 발화", () => {
    const out = evaluateSecurityTriggers([
      ...many(T.loginFailPerActor, "LOGIN_FAIL", { actorPhone: "p" }),
      ...many(T.authzDenyPerUser, "AUTHZ_DENY", { actorUserId: "u" }),
    ]);
    expect(out.map((t) => t.category).sort()).toEqual(["AUTHZ_DENY_SPIKE", "LOGIN_FAIL_SPIKE"]);
  });
});

describe("applyCooldown — 최근 경보 category 제외", () => {
  const triggers: SecurityTrigger[] = [
    { category: "LOGIN_FAIL_SPIKE", count: 30, top: "p" },
    { category: "SSRF_BLOCK", count: 1, top: null },
  ];

  it("쿨다운 없는 category는 fresh", () => {
    const { fresh, skipped } = applyCooldown(triggers, new Set());
    expect(fresh).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("최근 경보된 category는 skip", () => {
    const { fresh, skipped } = applyCooldown(triggers, new Set(["LOGIN_FAIL_SPIKE"]));
    expect(fresh.map((t) => t.category)).toEqual(["SSRF_BLOCK"]);
    expect(skipped).toBe(1);
  });

  it("전부 쿨다운이면 fresh 0", () => {
    const { fresh, skipped } = applyCooldown(triggers, new Set(["LOGIN_FAIL_SPIKE", "SSRF_BLOCK"]));
    expect(fresh).toEqual([]);
    expect(skipped).toBe(2);
  });
});
