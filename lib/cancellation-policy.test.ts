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
  it("★ v1 형태는 저장 대상 아님 — isValid(v2)는 false (parse만 승격 허용)", () => {
    expect(isValidCancellationPolicy({ fullDays: 30, partialDays: 14, partialPct: 50, enabled: true })).toBe(false);
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
  it("유효 v1 정책은 v2 3단계로 승격 보존 (S3 하위호환)", () => {
    const p = parseCancellationPolicy('{"fullDays":20,"partialDays":7,"partialPct":30,"enabled":false}');
    expect(p).toEqual({
      tiers: [
        { fromDays: 20, refundPct: 100 },
        { fromDays: 7, refundPct: 30 },
        { fromDays: -1, refundPct: 0 },
      ],
      enabled: false,
    });
  });
});

describe("serializeCancellationPolicy", () => {
  it("유효 → v2 JSON 문자열", () => {
    expect(
      serializeCancellationPolicy({
        tiers: [
          { fromDays: 20, refundPct: 100 },
          { fromDays: 7, refundPct: 30 },
          { fromDays: -1, refundPct: 0 },
        ],
        enabled: true,
      })
    ).toBe(
      '{"tiers":[{"fromDays":20,"refundPct":100},{"fromDays":7,"refundPct":30},{"fromDays":-1,"refundPct":0}],"enabled":true}'
    );
  });
  it("무효(v1 형태 직접 저장 포함) → null (저장 거부)", () => {
    expect(serializeCancellationPolicy({ fullDays: 5, partialDays: 7, partialPct: 30, enabled: true })).toBeNull();
  });
});

describe("cancellationTiers — 표시(기본값 3단계)", () => {
  it("range/range/withinNone 순서 — 마지막은 직전 하한(14일) 이내", () => {
    const t = cancellationTiers(DEFAULT_CANCELLATION_POLICY);
    expect(t.map((x) => x.kind)).toEqual(["range", "range", "withinNone"]);
    expect(t[0]).toEqual({ kind: "range", days: 30, pct: 100 });
    expect(t[1]).toEqual({ kind: "range", days: 14, pct: 50 });
    expect(t[2]).toEqual({ kind: "withinNone", days: 14, pct: 0 });
  });
});
