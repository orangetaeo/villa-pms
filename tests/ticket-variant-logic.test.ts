// 티켓 인원별 구분 배정·그룹 분리 순수 로직 테스트 (ADR-0036 개정)
//   resolveSelectedPeople(자동/수동 판정) + groupPeopleByVariant(variant별 그룹 = 그룹당 1 주문).
import { describe, it, expect } from "vitest";
import {
  resolveSelectedPeople,
  groupPeopleByVariant,
} from "@/app/g/_components/ticket-variant-logic";
import type { VariantRule } from "@/lib/ticket-variant-rules";

const on = "2026-08-01";
// 빈사파리류 규칙 — senior(출생<1966)·free(<100)·child(<140)·adult(기본)
const safari: VariantRule[] = [
  { key: "senior", bornBeforeYear: 1966, ageMin: null, ageMax: null, heightMaxCm: null },
  { key: "free", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 100 },
  { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 },
  { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
];
// 규칙 없는 다품목(케이블카 성인/어린이 가격만) — 순수 수동 모드
const manualOnly: VariantRule[] = [
  { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
  { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
];

const guests = [
  { name: "A SENIOR", birthDate: "1960-01-01" }, // idx0
  { name: "B ADULT", birthDate: "1990-01-01" }, // idx1
  { name: "C CHILD", birthDate: "2018-01-01" }, // idx2 (신장 신고로 child)
];

describe("resolveSelectedPeople — 자동 판정", () => {
  it("생년월일·신장으로 자동 배정(auto=true) — senior/adult/child", () => {
    const people = resolveSelectedPeople(
      [0, 1, 2],
      guests,
      safari,
      {},
      { 2: 130 }, // C는 신장 130 신고 → child
      on,
      "adult"
    );
    expect(people.map((p) => [p.key, p.auto])).toEqual([
      ["senior", true],
      ["adult", true],
      ["child", true],
    ]);
    expect(people[2].heightCm).toBe(130);
  });

  it("신장 미신고 어린이는 기본 adult로 떨어짐(자동)", () => {
    const people = resolveSelectedPeople([2], guests, safari, {}, {}, on, "adult");
    expect(people[0].key).toBe("adult");
    expect(people[0].auto).toBe(true);
  });

  it("자동 판정 실패(기본 없음·매칭 없음) → key null, 수동값 있으면 채움", () => {
    const noDefault: VariantRule[] = [{ key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 }];
    const unresolved = resolveSelectedPeople([1], guests, noDefault, {}, {}, on, null);
    expect(unresolved[0].key).toBeNull();
    const manual = resolveSelectedPeople([1], guests, noDefault, { 1: "child" }, {}, on, null);
    expect(manual[0].key).toBe("child");
    expect(manual[0].auto).toBe(false);
  });
});

describe("resolveSelectedPeople — 순수 수동 모드(규칙 전무)", () => {
  it("수동값 없으면 기본(첫 variant), 있으면 그 값(auto=false)", () => {
    const people = resolveSelectedPeople([0, 1], guests, manualOnly, { 1: "child" }, {}, on, "adult");
    expect(people.map((p) => [p.key, p.auto])).toEqual([
      ["adult", false], // 기본
      ["child", false], // 수동
    ]);
  });
});

describe("groupPeopleByVariant — variant별 그룹(그룹당 1 주문)", () => {
  it("같은 구분끼리 묶고 첫 등장 순서 유지, heightCm 보존", () => {
    const people = resolveSelectedPeople(
      [0, 1, 2],
      [
        { name: "A", birthDate: "1990-01-01" },
        { name: "B", birthDate: "1991-01-01" },
        { name: "C", birthDate: "2018-01-01" },
      ],
      safari,
      {},
      { 2: 120 },
      on,
      "adult"
    );
    const groups = groupPeopleByVariant(people);
    expect(groups).toEqual([
      { variantKey: "adult", guests: [{ name: "A", birthDate: "1990-01-01" }, { name: "B", birthDate: "1991-01-01" }] },
      { variantKey: "child", guests: [{ name: "C", birthDate: "2018-01-01", heightCm: 120 }] },
    ]);
  });

  it("key null(미배정) 인원은 그룹에서 제외", () => {
    const noDefault: VariantRule[] = [{ key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 }];
    const people = resolveSelectedPeople([1], guests, noDefault, {}, {}, on, null);
    expect(groupPeopleByVariant(people)).toEqual([]);
  });
});
