// 게스트 카드 요금(합계·구분별 소계) 순수 계산 테스트 (ticket-card-totals 과제)
//   - ticketGroupSubtotals: variant-person 그룹별 소계("라벨 ×N = 금액") — 서버 동형 재계산.
//   - 일반(수량 스테퍼) 카드 합계 = 단가(1개) × 수량 — resolveOrderPricing 정합 확인.
//   ★ 표시용 계산이 서버 정본(resolveOrderPricing)과 동일 결과인지 검증(참고값 오차 0).
import { describe, it, expect } from "vitest";
import {
  groupPeopleByVariant,
  resolveSelectedPeople,
  ticketGroupSubtotals,
  ticketGroupsTotalVnd,
} from "@/app/g/_components/ticket-variant-logic";
import { resolveOrderPricing, type CatalogOptions } from "@/lib/service-catalog";
import type { VariantRule } from "@/lib/ticket-variant-rules";

// 케이블카류 — 성인/어린이 가격만(규칙 없음 → 순수 수동 모드). variant가 base가 대체.
const cableOptions: CatalogOptions = {
  variants: [
    { key: "adult", labelKo: "성인", priceVnd: "1500000" },
    { key: "child", labelKo: "어린이", priceVnd: "1100000" },
  ],
};
const cableRules: VariantRule[] = [
  { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
  { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
];

describe("ticketGroupSubtotals — 구분별 소계(라벨 ×N = 금액)", () => {
  it("수동 배정 성인2·어린이1 → 그룹별 소계 + 총합 정합", () => {
    const guests = [
      { name: "A", birthDate: "1990-01-01" },
      { name: "B", birthDate: "1992-01-01" },
      { name: "C", birthDate: "2018-01-01" },
    ];
    // 순수 수동 모드: 기본 adult, C만 child로 수동 지정
    const people = resolveSelectedPeople([0, 1, 2], guests, cableRules, { 2: "child" }, {}, "2026-08-01", "adult");
    const groups = groupPeopleByVariant(people);
    const subs = ticketGroupSubtotals(groups, { priceVnd: null }, cableOptions, [], []);

    expect(subs).toEqual([
      { variantKey: "adult", count: 2, subtotalVnd: 3000000n }, // 1,500,000 × 2
      { variantKey: "child", count: 1, subtotalVnd: 1100000n }, // 1,100,000 × 1
    ]);
    // 소계 합 = 카드 총합(ticketGroupsTotalVnd)과 일치
    const sumOfSubs = subs.reduce((a, s) => a + s.subtotalVnd, 0n);
    expect(sumOfSubs).toBe(ticketGroupsTotalVnd(groups, { priceVnd: null }, cableOptions, [], []));
    expect(sumOfSubs).toBe(4100000n);
  });

  it("addon 가산이 각 구분 단가에 반영(그룹 인원수만큼 곱)", () => {
    const opts: CatalogOptions = {
      ...cableOptions,
      addons: [{ key: "photo", labelKo: "사진팩", priceVnd: "200000" }],
    };
    const guests = [
      { name: "A", birthDate: "1990-01-01" },
      { name: "C", birthDate: "2018-01-01" },
    ];
    const people = resolveSelectedPeople([0, 1], guests, cableRules, { 1: "child" }, {}, "2026-08-01", "adult");
    const groups = groupPeopleByVariant(people);
    const subs = ticketGroupSubtotals(groups, { priceVnd: null }, opts, ["photo"], []);
    expect(subs).toEqual([
      { variantKey: "adult", count: 1, subtotalVnd: 1700000n }, // (1,500,000 + 200,000) × 1
      { variantKey: "child", count: 1, subtotalVnd: 1300000n }, // (1,100,000 + 200,000) × 1
    ]);
  });

  it("빈 그룹은 빈 배열", () => {
    expect(ticketGroupSubtotals([], { priceVnd: null }, cableOptions, [], [])).toEqual([]);
  });
});

describe("일반(수량 스테퍼) 카드 합계 = 단가 × 수량", () => {
  it("단가(1개)×수량이 resolveOrderPricing 총액과 동일", () => {
    const opts: CatalogOptions = {
      variants: [{ key: "s", labelKo: "소", priceVnd: "1500000" }],
      addons: [{ key: "x", labelKo: "추가", priceVnd: "500000" }],
    };
    const base = { priceVnd: null };
    const unit = resolveOrderPricing(base, opts, { variantKey: "s", addonKeys: ["x"], quantity: 1 }).totalPriceVnd;
    expect(unit).toBe(2000000n);
    // 표시용: 단가 × 수량
    const displayTotal = unit * 3n;
    // 서버 정본: quantity=3 직접 재계산
    const serverTotal = resolveOrderPricing(base, opts, { variantKey: "s", addonKeys: ["x"], quantity: 3 }).totalPriceVnd;
    expect(displayTotal).toBe(serverTotal);
    expect(displayTotal).toBe(6000000n);
  });

  it("옵션 없는 단순 항목 — base가 × 수량", () => {
    const unit = resolveOrderPricing({ priceVnd: 30000n }, {}, { quantity: 1 }).totalPriceVnd;
    expect(unit * 4n).toBe(120000n);
  });
});
