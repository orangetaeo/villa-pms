import { describe, it, expect } from "vitest";
import { __test } from "./security-event";

const { redactMeta } = __test;

describe("security-event redactMeta — 민감값 미기록 (보안 P0-1)", () => {
  it("민감 키는 값까지 [redacted]로 치환한다", () => {
    const out = redactMeta({
      reason: "bad_password",
      password: "secret123",
      passwordHash: "$2a$...",
      credential: "x",
      authToken: "abc",
      marginValue: 20,
      salePriceKrw: 242000,
      role: "STAFF",
    });
    expect(out).toMatchObject({
      reason: "bad_password",
      password: "[redacted]",
      passwordHash: "[redacted]",
      credential: "[redacted]",
      authToken: "[redacted]",
      marginValue: "[redacted]",
      salePriceKrw: "[redacted]",
      role: "STAFF",
    });
  });

  it("긴 문자열은 300자로 컷한다(로그 플러드 방지)", () => {
    const long = "a".repeat(500);
    const out = redactMeta({ note: long })!;
    expect(String(out.note).length).toBeLessThanOrEqual(301);
    expect(String(out.note).endsWith("…")).toBe(true);
  });

  it("null/undefined는 undefined 반환", () => {
    expect(redactMeta(null)).toBeUndefined();
    expect(redactMeta(undefined)).toBeUndefined();
  });
});
