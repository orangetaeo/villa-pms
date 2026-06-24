import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANCELLATION_POLICY,
  isValidCancellationPolicy,
  parseCancellationPolicy,
  serializeCancellationPolicy,
  cancellationTiers,
} from "./cancellation-policy";

describe("isValidCancellationPolicy — 정합성", () => {
  it("기본값은 유효", () => {
    expect(isValidCancellationPolicy(DEFAULT_CANCELLATION_POLICY)).toBe(true);
  });
  it("전액일 ≤ 부분일 역전 거부", () => {
    expect(isValidCancellationPolicy({ fullDays: 10, partialDays: 14, partialPct: 50, enabled: true })).toBe(false);
  });
  it("부분율 범위 밖 거부", () => {
    expect(isValidCancellationPolicy({ fullDays: 30, partialDays: 14, partialPct: 150, enabled: true })).toBe(false);
    expect(isValidCancellationPolicy({ fullDays: 30, partialDays: 14, partialPct: -1, enabled: true })).toBe(false);
  });
  it("음수 부분일 거부", () => {
    expect(isValidCancellationPolicy({ fullDays: 30, partialDays: -1, partialPct: 50, enabled: true })).toBe(false);
  });
  it("비정수 거부", () => {
    expect(isValidCancellationPolicy({ fullDays: 30.5, partialDays: 14, partialPct: 50, enabled: true })).toBe(false);
  });
  it("enabled 비불리언 거부", () => {
    expect(isValidCancellationPolicy({ fullDays: 30, partialDays: 14, partialPct: 50, enabled: "y" })).toBe(false);
  });
});

describe("parseCancellationPolicy — 폴백 안전성", () => {
  it("null/빈값 → 기본값", () => {
    expect(parseCancellationPolicy(null)).toEqual(DEFAULT_CANCELLATION_POLICY);
    expect(parseCancellationPolicy("")).toEqual(DEFAULT_CANCELLATION_POLICY);
  });
  it("손상 JSON → 기본값", () => {
    expect(parseCancellationPolicy("{깨진")).toEqual(DEFAULT_CANCELLATION_POLICY);
  });
  it("무효 정책 JSON → 기본값", () => {
    expect(parseCancellationPolicy('{"fullDays":5,"partialDays":7,"partialPct":50,"enabled":true}')).toEqual(
      DEFAULT_CANCELLATION_POLICY
    );
  });
  it("유효 정책 보존", () => {
    const p = parseCancellationPolicy('{"fullDays":20,"partialDays":7,"partialPct":30,"enabled":false}');
    expect(p).toEqual({ fullDays: 20, partialDays: 7, partialPct: 30, enabled: false });
  });
});

describe("serializeCancellationPolicy", () => {
  it("유효 → JSON 문자열", () => {
    expect(serializeCancellationPolicy({ fullDays: 20, partialDays: 7, partialPct: 30, enabled: true })).toBe(
      '{"fullDays":20,"partialDays":7,"partialPct":30,"enabled":true}'
    );
  });
  it("무효 → null (저장 거부)", () => {
    expect(serializeCancellationPolicy({ fullDays: 5, partialDays: 7, partialPct: 30, enabled: true })).toBeNull();
  });
});

describe("cancellationTiers — 표시 3단계", () => {
  it("full(100%)/partial(pct)/none(0%) 순서", () => {
    const t = cancellationTiers(DEFAULT_CANCELLATION_POLICY);
    expect(t.map((x) => x.kind)).toEqual(["full", "partial", "none"]);
    expect(t[0].pct).toBe(100);
    expect(t[1].pct).toBe(50);
    expect(t[2].pct).toBe(0);
    expect(t[0].days).toBe(30);
    expect(t[1].days).toBe(14);
  });
});
