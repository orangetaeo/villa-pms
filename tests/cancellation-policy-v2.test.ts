import { describe, it, expect } from "vitest";
import {
  DEFAULT_CANCELLATION_POLICY,
  SUPPLIER_ALIGNED_TIERS,
  cancellationTierLabel,
  cancellationTierParts,
  cancellationTiers,
  isValidCancellationPolicy,
  parseCancellationPolicy,
  promoteLegacyPolicy,
  refundPctFor,
  serializeCancellationPolicy,
  supplierPayPctFor,
  type CancellationPolicy,
} from "@/lib/cancellation-policy";
import { DEFAULT_CANCEL_TIERS } from "@/lib/cancel-tiers";
import { PUBLIC_LABELS, PUBLIC_LANGS } from "@/lib/public-i18n";

const V1_LIVE = JSON.stringify({ fullDays: 30, partialDays: 14, partialPct: 50, enabled: true });

describe("★ v1(라이브 운영값) 하위호환", () => {
  it("v1 JSON을 3단계로 자동 승격 — 라이브 AppSetting 무변경으로 동작", () => {
    const p = parseCancellationPolicy(V1_LIVE);
    expect(p.enabled).toBe(true);
    expect(p.tiers).toEqual([
      { fromDays: 30, refundPct: 100 },
      { fromDays: 14, refundPct: 50 },
      { fromDays: -1, refundPct: 0 },
    ]);
  });

  it("승격 결과의 판정이 v1 의미와 일치한다", () => {
    const { tiers } = parseCancellationPolicy(V1_LIVE);
    expect(refundPctFor(tiers, 40)).toBe(100); // 30일 이전
    expect(refundPctFor(tiers, 30)).toBe(100); // 경계 포함
    expect(refundPctFor(tiers, 29)).toBe(50); // 30 미만 → 부분
    expect(refundPctFor(tiers, 14)).toBe(50); // 경계 포함
    expect(refundPctFor(tiers, 13)).toBe(0); // 14 미만 → 불가
    expect(refundPctFor(tiers, 0)).toBe(0); // 당일
    expect(refundPctFor(tiers, -1)).toBe(0); // 노쇼
  });

  it("승격된 정책의 공개 문구가 종전과 동일하다", () => {
    const rows = cancellationTiers(parseCancellationPolicy(V1_LIVE));
    const labels = rows.map((r) => cancellationTierLabel(r, PUBLIC_LABELS.ko.sales));
    expect(labels).toEqual([
      "체크인 30일 전까지 취소 시 100% 환불",
      "체크인 14일 전까지 취소 시 50% 환불",
      "체크인 14일 이내 취소 시 환불 불가",
    ]);
  });

  it("기본값도 현행 운영값(30/14/50) 그대로 — S3가 정책을 바꾸지 않는다", () => {
    expect(parseCancellationPolicy(null)).toEqual(DEFAULT_CANCELLATION_POLICY);
    expect(DEFAULT_CANCELLATION_POLICY.tiers[0]).toEqual({ fromDays: 30, refundPct: 100 });
  });

  it("손상 JSON·형식 불일치는 기본값 폴백(공개 표시가 깨지지 않게)", () => {
    expect(parseCancellationPolicy("{{{")).toEqual(DEFAULT_CANCELLATION_POLICY);
    expect(parseCancellationPolicy(JSON.stringify({ tiers: [], enabled: true }))).toEqual(
      DEFAULT_CANCELLATION_POLICY,
    );
  });

  it("promoteLegacyPolicy는 enabled=false도 보존", () => {
    expect(promoteLegacyPolicy({ fullDays: 20, partialDays: 5, partialPct: 30, enabled: false }).enabled).toBe(
      false,
    );
  });
});

describe("v2 검증", () => {
  const ok = (tiers: { fromDays: number; refundPct: number }[]): CancellationPolicy => ({
    tiers,
    enabled: true,
  });

  it("공급자 정합 프리셋(5단계)은 유효", () => {
    expect(isValidCancellationPolicy(ok(SUPPLIER_ALIGNED_TIERS))).toBe(true);
  });

  it("마지막 행이 노쇼(-1)가 아니면 거부", () => {
    expect(isValidCancellationPolicy(ok([{ fromDays: 30, refundPct: 100 }, { fromDays: 14, refundPct: 50 }]))).toBe(
      false,
    );
  });

  it("일수 내림차순·환불률 비증가 위반 거부", () => {
    expect(
      isValidCancellationPolicy(
        ok([
          { fromDays: 10, refundPct: 100 },
          { fromDays: 20, refundPct: 50 },
          { fromDays: -1, refundPct: 0 },
        ]),
      ),
    ).toBe(false);
    expect(
      isValidCancellationPolicy(
        ok([
          { fromDays: 30, refundPct: 50 },
          { fromDays: 14, refundPct: 80 }, // 환불률 증가
          { fromDays: -1, refundPct: 0 },
        ]),
      ),
    ).toBe(false);
  });

  it("직렬화는 v2 형태로만 저장하고 부적합은 null", () => {
    const s = serializeCancellationPolicy(ok(SUPPLIER_ALIGNED_TIERS));
    expect(s).not.toBeNull();
    expect(JSON.parse(s!)).toHaveProperty("tiers");
    expect(JSON.parse(s!)).not.toHaveProperty("fullDays");
    expect(serializeCancellationPolicy({ tiers: [], enabled: true })).toBeNull();
  });
});

describe("공급자 계약과 back-to-back", () => {
  it("정합 프리셋의 환불률 = 100 − 공급자 지급률 (모든 단계)", () => {
    SUPPLIER_ALIGNED_TIERS.forEach((t, i) => {
      expect(t.fromDays).toBe(DEFAULT_CANCEL_TIERS[i].fromDays);
      expect(t.refundPct).toBe(100 - DEFAULT_CANCEL_TIERS[i].supplierPayPct);
    });
  });

  it("같은 시점에서 위약금률과 지급률이 정확히 일치 → 회사 손실 0", () => {
    for (const d of [30, 14, 13, 8, 7, 1, 0, -1]) {
      const refund = refundPctFor(SUPPLIER_ALIGNED_TIERS, d);
      const pay = supplierPayPctFor(DEFAULT_CANCEL_TIERS, d);
      expect(pay).toBe(100 - refund);
    }
  });
});

describe("표시 라벨 — N단계·5개국어", () => {
  it("5단계 정책의 ko 문구(당일·노쇼 포함)", () => {
    const rows = cancellationTiers({ tiers: SUPPLIER_ALIGNED_TIERS, enabled: true });
    const labels = rows.map((r) => cancellationTierLabel(r, PUBLIC_LABELS.ko.sales));
    expect(labels).toEqual([
      "체크인 14일 전까지 취소 시 100% 환불",
      "체크인 8일 전까지 취소 시 80% 환불",
      "체크인 1일 전까지 취소 시 50% 환불",
      "체크인 당일 취소 시 20% 환불",
      "노쇼 또는 체크인 후 취소 시 환불 불가",
    ]);
  });

  it("5개국어 모두 조각이 채워져 있고 비-ko 로케일에 한국어가 남지 않는다", () => {
    const rows = cancellationTiers({ tiers: SUPPLIER_ALIGNED_TIERS, enabled: true });
    for (const lang of PUBLIC_LANGS) {
      const sales = PUBLIC_LABELS[lang].sales;
      expect(sales.cancelSameDay.length).toBeGreaterThan(0);
      expect(sales.cancelNoShow.length).toBeGreaterThan(0);
      const joined = rows.map((r) => cancellationTierLabel(r, sales)).join(" ");
      expect(joined).not.toContain("undefined");
      if (lang !== "ko") expect(joined).not.toMatch(/[가-힣]/);
    }
  });

  it("당일 단계가 없으면 마지막 행은 'N일 이내' 문구를 쓴다(종전 동작)", () => {
    const rows = cancellationTiers(parseCancellationPolicy(V1_LIVE));
    expect(rows[2]).toEqual({ kind: "withinNone", days: 14, pct: 0 });
  });
});

describe("★ 표시 강조 회귀 방지 (고지문 숫자 강조)", () => {
  // 2026-07-22 회귀: 중복 제거하며 문장을 통짜 문자열로 만들어 일수·% 굵게 표시가 사라졌다.
  // 조각(parts) API가 숫자·"환불 불가"를 별도 kind로 내보내는지 고정한다.
  const f = PUBLIC_LABELS.ko.sales;

  it("range 행 — 일수(days)·환불률(pct)이 강조 조각으로 분리된다", () => {
    const rows = cancellationTiers(parseCancellationPolicy(V1_LIVE));
    const parts = cancellationTierParts(rows[0], f);
    expect(parts.filter((p) => p.kind === "days").map((p) => p.text)).toEqual(["30"]);
    expect(parts.filter((p) => p.kind === "pct").map((p) => p.text)).toEqual(["100"]);
  });

  it("환불 불가 행 — noRefund 조각이 분리된다", () => {
    const rows = cancellationTiers(parseCancellationPolicy(V1_LIVE));
    const parts = cancellationTierParts(rows[2], f);
    expect(parts.some((p) => p.kind === "noRefund")).toBe(true);
    expect(parts.filter((p) => p.kind === "days").map((p) => p.text)).toEqual(["14"]);
  });

  it("조각을 이어붙이면 평문 라벨과 동일 — 텍스트 회귀 없음", () => {
    for (const row of cancellationTiers({ tiers: SUPPLIER_ALIGNED_TIERS, enabled: true })) {
      expect(cancellationTierParts(row, f).map((p) => p.text).join("")).toBe(
        cancellationTierLabel(row, f),
      );
    }
  });
});
