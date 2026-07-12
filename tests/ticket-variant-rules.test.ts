// 티켓 연령/신장 구분(variant) 자동 판정 순수 로직 테스트 (ADR-0036 개정)
//   ★ 카테고리 하드코딩 없음 — 규칙 필드만 순서대로 평가(bornBeforeYear → 만나이 → heightMaxCm → 기본).
//   기준표(테오 실측): 빈사파리·빈원더스(신장), 혼똔 케이블카(단순), 노인(출생년도).
import { describe, it, expect } from "vitest";
import {
  ageOnDate,
  birthYear,
  readVariantRule,
  ruleHasAny,
  anyVariantHasRule,
  anyVariantHasHeightRule,
  classifyVariant,
  validateGuestForVariant,
  type VariantRule,
} from "@/lib/ticket-variant-rules";

describe("ageOnDate — 이용일 기준 만 나이(문자열 비교)", () => {
  it("생일 지난 경우 정수 나이", () => {
    expect(ageOnDate("2000-01-01", "2026-08-01")).toBe(26);
  });
  it("생일 당일이면 만 나이 그대로", () => {
    expect(ageOnDate("2000-08-01", "2026-08-01")).toBe(26);
  });
  it("생일 아직 안 지났으면 -1", () => {
    expect(ageOnDate("2000-08-02", "2026-08-01")).toBe(25);
  });
  it("윤년 2/29생 — 비윤년 2/28까지는 생일 전(보수적)", () => {
    expect(ageOnDate("2000-02-29", "2025-02-28")).toBe(24);
    expect(ageOnDate("2000-02-29", "2025-03-01")).toBe(25);
  });
  it("불량 입력·미래 생년월일이면 null", () => {
    expect(ageOnDate(null, "2026-08-01")).toBeNull();
    expect(ageOnDate("bad", "2026-08-01")).toBeNull();
    expect(ageOnDate("2030-01-01", "2026-08-01")).toBeNull();
  });
});

describe("birthYear / readVariantRule / 규칙 유무", () => {
  it("birthYear 추출", () => {
    expect(birthYear("1965-12-31")).toBe(1965);
    expect(birthYear(null)).toBeNull();
  });
  it("readVariantRule — 숫자·숫자문자열 정규화, 그 외 null", () => {
    expect(readVariantRule({ key: "a", bornBeforeYear: 1966, heightMaxCm: "140" })).toEqual({
      key: "a",
      bornBeforeYear: 1966,
      ageMin: null,
      ageMax: null,
      heightMaxCm: 140,
    });
    expect(readVariantRule({ key: "b", bornBeforeYear: "x" }).bornBeforeYear).toBeNull();
  });
  it("ruleHasAny / anyVariantHasRule / anyVariantHasHeightRule", () => {
    const adult: VariantRule = { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null };
    const child: VariantRule = { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 };
    expect(ruleHasAny(adult)).toBe(false);
    expect(ruleHasAny(child)).toBe(true);
    expect(anyVariantHasRule([adult])).toBe(false);
    expect(anyVariantHasRule([adult, child])).toBe(true);
    expect(anyVariantHasHeightRule([adult])).toBe(false);
    expect(anyVariantHasHeightRule([adult, child])).toBe(true);
  });
});

// 빈사파리류 — 무료(신장<100)·어린이(신장<140)·성인(기본)·노인(1966 이전 출생)
const safari: VariantRule[] = [
  { key: "senior", bornBeforeYear: 1966, ageMin: null, ageMax: null, heightMaxCm: null },
  { key: "free", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 100 },
  { key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 },
  { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
];

describe("classifyVariant — 자동 분류(순서: 출생년도 → 만나이 → 신장 → 기본)", () => {
  const on = "2026-08-01";
  it("출생년도 컷오프 우선 — 1965생은 senior(신장 무관)", () => {
    expect(classifyVariant(safari, { birthDate: "1965-03-03", heightCm: 130, serviceDate: on })).toBe("senior");
  });
  it("신장 낮은 임계 먼저 — 95cm는 free", () => {
    expect(classifyVariant(safari, { birthDate: "2022-01-01", heightCm: 95, serviceDate: on })).toBe("free");
  });
  it("신장 130cm는 child(<140, ≥100)", () => {
    expect(classifyVariant(safari, { birthDate: "2018-01-01", heightCm: 130, serviceDate: on })).toBe("child");
  });
  it("신장 미신고 성인 생년월일 → 기본 adult", () => {
    expect(classifyVariant(safari, { birthDate: "1990-01-01", heightCm: null, serviceDate: on })).toBe("adult");
  });
  it("신장 150cm → 어느 신장 규칙도 미달 → 기본 adult", () => {
    expect(classifyVariant(safari, { birthDate: "2010-01-01", heightCm: 150, serviceDate: on })).toBe("adult");
  });

  it("만 나이 규칙(선택) — ageMax=11이면 12세 미만 child_age", () => {
    const ageRules: VariantRule[] = [
      { key: "child_age", bornBeforeYear: null, ageMin: null, ageMax: 11, heightMaxCm: null },
      { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
    ];
    expect(classifyVariant(ageRules, { birthDate: "2016-01-01", heightCm: null, serviceDate: on })).toBe("child_age"); // 만10세
    expect(classifyVariant(ageRules, { birthDate: "2010-01-01", heightCm: null, serviceDate: on })).toBe("adult"); // 만16세
  });

  it("기본 variant 없고 매칭도 없으면 null(수동 폴백)", () => {
    const noDefault: VariantRule[] = [{ key: "child", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: 140 }];
    expect(classifyVariant(noDefault, { birthDate: "1990-01-01", heightCm: 170, serviceDate: on })).toBeNull();
  });

  it("이용일이 흐르면 만나이 재판정 — 경계일 전후로 결과가 바뀐다", () => {
    const ageRules: VariantRule[] = [
      { key: "child_age", bornBeforeYear: null, ageMin: null, ageMax: 11, heightMaxCm: null },
      { key: "adult", bornBeforeYear: null, ageMin: null, ageMax: null, heightMaxCm: null },
    ];
    // 2014-09-01생: 2026-08-31엔 만11세(child), 2026-09-01엔 만12세(adult)
    expect(classifyVariant(ageRules, { birthDate: "2014-09-01", heightCm: null, serviceDate: "2026-08-31" })).toBe("child_age");
    expect(classifyVariant(ageRules, { birthDate: "2014-09-01", heightCm: null, serviceDate: "2026-09-01" })).toBe("adult");
  });
});

describe("validateGuestForVariant — 서버 재검증(가격 조작 방지)", () => {
  const on = "2026-08-01";
  const senior = safari[0];
  const free = safari[1];
  const adult = safari[3];

  it("출생년도 규칙 — 1965생 senior 통과, 1990생 senior 위반", () => {
    expect(validateGuestForVariant(senior, { birthDate: "1965-01-01", heightCm: null, serviceDate: on })).toBe(true);
    expect(validateGuestForVariant(senior, { birthDate: "1990-01-01", heightCm: null, serviceDate: on })).toBe(false);
  });
  it("생년월일 null은 출생/나이 규칙 통과(자가신고 폴백)", () => {
    expect(validateGuestForVariant(senior, { birthDate: null, heightCm: null, serviceDate: on })).toBe(true);
  });
  it("신장 규칙 — 미신고 위반, 상한 미만 통과, 상한 이상 위반", () => {
    expect(validateGuestForVariant(free, { birthDate: null, heightCm: null, serviceDate: on })).toBe(false);
    expect(validateGuestForVariant(free, { birthDate: null, heightCm: 95, serviceDate: on })).toBe(true);
    expect(validateGuestForVariant(free, { birthDate: null, heightCm: 100, serviceDate: on })).toBe(false);
  });
  it("규칙 없는 기본(성인)은 항상 통과", () => {
    expect(validateGuestForVariant(adult, { birthDate: "2020-01-01", heightCm: 80, serviceDate: on })).toBe(true);
  });
});
