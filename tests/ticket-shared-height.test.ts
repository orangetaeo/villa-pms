// 공유 신장(폼 전역 1회 입력) → 서로 다른 variants 품목의 판정 일관성 테스트 (guest-ticket-ux-consolidation)
//   "티켓 이용자 정보" 카드에서 신장을 1회 입력하면(사람 idx→cm) 모든 TICKET 품목이 같은 맵을 공유한다.
//   품목마다 신장 임계(heightMaxCm)가 다르면 판정 결과는 품목별로 달라지되, 같은 신장 입력에 대해 결정적(일관)이어야 한다.
//   ★ 순수 함수(resolveSelectedPeople) 레벨에서만 검증 — UI 상태 리프트의 정합성 근거.
import { describe, it, expect } from "vitest";
import {
  resolveSelectedPeople,
  groupPeopleByVariant,
} from "@/app/g/_components/ticket-variant-logic";
import type { VariantRule } from "@/lib/ticket-variant-rules";

const on = "2026-08-01";

// 키스쇼 — free(<100)·child(<140)·adult(기본)
const kissShow: VariantRule[] = [
  { key: "free", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 100 },
  { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 },
  { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
];
// 심포니 — child(<130)·adult(기본). 어린이 임계가 더 낮다.
const symphony: VariantRule[] = [
  { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 130 },
  { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
];

// 성인 1명 + 아이 1명. 생년월일은 성인 기준(신장 규칙으로만 판정되게).
const guests = [
  { name: "PARENT", birthDate: "1990-01-01" }, // idx0
  { name: "KID", birthDate: "1988-01-01" }, // idx1 — 생년월일은 성인이라 신장으로만 갈림
];

// 폼 전역 공유 신장 — 1회 입력. 아이 135cm.
const sharedHeights = { 1: 135 };

describe("공유 신장 1회 입력 → 품목별 variants 판정 일관성", () => {
  it("동일 공유 신장(135)이 임계가 다른 두 품목에 각각 결정적으로 적용", () => {
    // 키스쇼: 135 < 140 → child
    const kiss = resolveSelectedPeople([0, 1], guests, kissShow, {}, sharedHeights, on, "adult");
    expect(kiss.map((p) => p.key)).toEqual(["adult", "child"]);
    expect(kiss[1].heightCm).toBe(135);

    // 심포니: 135 는 130 미만 아님 → adult(기본)
    const sym = resolveSelectedPeople([0, 1], guests, symphony, {}, sharedHeights, on, "adult");
    expect(sym.map((p) => p.key)).toEqual(["adult", "adult"]);
    expect(sym[1].heightCm).toBe(135);
  });

  it("두 품목이 서로 다른 인원 수를 선택해도 같은 공유 신장으로 판정(품목별 인원 상이)", () => {
    // 키스쇼는 2명, 심포니는 아이만 1명 선택 — 신장 원천은 동일 맵.
    const kiss = groupPeopleByVariant(
      resolveSelectedPeople([0, 1], guests, kissShow, {}, sharedHeights, on, "adult")
    );
    const sym = groupPeopleByVariant(
      resolveSelectedPeople([1], guests, symphony, {}, sharedHeights, on, "adult")
    );
    expect(kiss).toEqual([
      { variantKey: "adult", guests: [{ name: "PARENT", birthDate: "1990-01-01" }] },
      { variantKey: "child", guests: [{ name: "KID", birthDate: "1988-01-01", heightCm: 135 }] },
    ]);
    expect(sym).toEqual([
      { variantKey: "adult", guests: [{ name: "KID", birthDate: "1988-01-01", heightCm: 135 }] },
    ]);
  });

  it("신장 입력 전(빈 맵)이면 신장 규칙 품목은 기본(adult)로 결정적", () => {
    const kiss = resolveSelectedPeople([1], guests, kissShow, {}, {}, on, "adult");
    expect(kiss[0].key).toBe("adult");
    expect(kiss[0].heightCm).toBeNull();
  });
});
