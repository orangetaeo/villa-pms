// lib/ticket-variant-rules.ts — 티켓 연령/신장 구분(variant) 자동 판정 순수 로직 (ADR-0036 개정)
//   판매자가 variant마다 규칙 필드를 저장하고, 이용자별로 자동 분류한다.
//   ★ 카테고리(무료/어린이/노인/성인)를 코드에 하드코딩하지 않는다 — 존재하는 규칙 필드만 순서대로 평가하고,
//     화면 표시는 매칭된 variant의 라벨을 그대로 쓴다(노인 없는 품목·무료 없는 품목 모두 정상).
//   평가 순서(사람별): bornBeforeYear(여권 출생년도 자동) → [ageMin/ageMax 이용일 만나이, 있으면]
//                    → heightMaxCm(소비자 신장 입력, 낮은 임계 먼저) → 규칙 없는 기본 variant(성인).
//   ★타임존 함정: 날짜는 "YYYY-MM-DD" 문자열 숫자 비교만(Date 로컬 변환 금지 — @db.Date UTC 자정 기준).

export interface VariantRule {
  key: string;
  /** 출생년도 < 값이면 매칭(고정 컷오프, 여권 birthDate 자동 — 날짜 흘러도 불변). 예: 1966 = 1965년 이전 출생 노인. */
  bornBeforeYear: number | null;
  /** 이용일 기준 만 나이 ≥ (선택 규칙 — 일부 시설 나이 기준 대비). */
  ageMin: number | null;
  /** 이용일 기준 만 나이 ≤ (선택 규칙). */
  ageMax: number | null;
  /** 소비자 입력 신장(cm) < 값이면 매칭. 예: 100 = 무료, 140 = 어린이(여권에 없어 소비자 자가신고). */
  heightMaxCm: number | null;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
function ymd(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = YMD.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** 이용일(onDate) 기준 만 나이. 생일이 아직 안 지났으면 -1(표준 만나이).
 *  birthDate·onDate 불량이거나 미래 생년월일이면 null. 문자열 비교(로컬 타임존 변환 없음). */
export function ageOnDate(birthDate: string | null | undefined, onDate: string | null | undefined): number | null {
  const b = ymd(birthDate);
  const o = ymd(onDate);
  if (!b || !o) return null;
  let age = o.y - b.y;
  // 이용일의 (월,일)이 생일보다 앞서면 아직 생일 전 → -1. 윤년 2/29생은 비윤년 2/28까지는 생일 전으로 본다(보수적 표준).
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age -= 1;
  return age < 0 ? null : age;
}

/** 여권 birthDate → 출생 연도(정수). 불량이면 null. */
export function birthYear(birthDate: string | null | undefined): number | null {
  const b = ymd(birthDate);
  return b ? b.y : null;
}

const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x)
    ? Math.trunc(x)
    : typeof x === "string" && /^\d{1,4}$/.test(x)
      ? parseInt(x, 10)
      : null;

/** CatalogOptionDef류(규칙 필드 임의 타입) → 정규화된 VariantRule. 값 없으면 null. 순수. */
export function readVariantRule(v: {
  key: string;
  bornBeforeYear?: unknown;
  ageMin?: unknown;
  ageMax?: unknown;
  heightMaxCm?: unknown;
}): VariantRule {
  return {
    key: v.key,
    bornBeforeYear: num(v.bornBeforeYear),
    ageMin: num(v.ageMin),
    ageMax: num(v.ageMax),
    heightMaxCm: num(v.heightMaxCm),
  };
}

/** 이 variant에 자동판정 규칙이 하나라도 있는가. */
export function ruleHasAny(r: VariantRule): boolean {
  return r.bornBeforeYear != null || r.ageMin != null || r.ageMax != null || r.heightMaxCm != null;
}
/** 품목 variant 중 규칙이 하나라도 있으면 true → 자동 판정 모드. 전무면 순수 수동 선택 모드. */
export function anyVariantHasRule(rules: VariantRule[]): boolean {
  return rules.some(ruleHasAny);
}
/** 품목에 신장 규칙 variant가 있으면 true → 게스트 폼에 신장 입력칸 노출. */
export function anyVariantHasHeightRule(rules: VariantRule[]): boolean {
  return rules.some((r) => r.heightMaxCm != null);
}

/**
 * 이용자 1명 자동 분류 → 매칭 variant key, 매칭 없으면 null(수동 폴백/차단).
 *   순서: 출생년도 컷오프 → 이용일 만나이 → 신장 상한(낮은 임계 먼저: 무료 100 → 어린이 140) → 규칙 없는 기본(성인).
 *   ★ 카테고리 하드코딩 없음 — variant 배열의 규칙 필드만 평가한다. 순수.
 */
export function classifyVariant(
  rules: VariantRule[],
  input: { birthDate: string | null; heightCm: number | null; serviceDate: string }
): string | null {
  // 1) 출생년도 컷오프 — 여권 자동. 여러 개면 배열 순서상 첫 매칭.
  const by = birthYear(input.birthDate);
  if (by != null) {
    for (const r of rules) {
      if (r.bornBeforeYear != null && by < r.bornBeforeYear) return r.key;
    }
  }
  // 2) 이용일 만 나이 범위(선택 규칙).
  const age = ageOnDate(input.birthDate, input.serviceDate);
  if (age != null) {
    for (const r of rules) {
      if (
        (r.ageMin != null || r.ageMax != null) &&
        (r.ageMin == null || age >= r.ageMin) &&
        (r.ageMax == null || age <= r.ageMax)
      ) {
        return r.key;
      }
    }
  }
  // 3) 신장 상한 — 소비자 입력. 낮은 임계 먼저(무료 → 어린이).
  if (input.heightCm != null) {
    const hv = rules
      .filter((r) => r.heightMaxCm != null)
      .sort((a, b) => (a.heightMaxCm as number) - (b.heightMaxCm as number));
    for (const r of hv) {
      if (input.heightCm < (r.heightMaxCm as number)) return r.key;
    }
  }
  // 4) 규칙 없는 기본(성인) variant.
  const def = rules.find((r) => !ruleHasAny(r));
  return def ? def.key : null;
}

/**
 * 서버 검증 — 제출된 variantKey 규칙에 이용자가 맞는지(가격 조작 방지). 순수.
 *   - bornBeforeYear: 출생년도 < 컷오프여야. birthDate null(여권 미인식)은 통과 허용(자가신고 폴백).
 *   - ageMin/ageMax: 만 나이 범위. birthDate null은 통과 허용.
 *   - heightMaxCm: 신장 필수 + 상한 미만. 하한은 비강제(자가신고·현장 검표가 정본).
 *   - 규칙 없는 기본 variant: 항상 통과(성인).
 */
export function validateGuestForVariant(
  rule: VariantRule,
  input: { birthDate: string | null; heightCm: number | null; serviceDate: string }
): boolean {
  if (rule.bornBeforeYear != null) {
    const by = birthYear(input.birthDate);
    if (by != null && !(by < rule.bornBeforeYear)) return false;
  }
  if (rule.ageMin != null || rule.ageMax != null) {
    const age = ageOnDate(input.birthDate, input.serviceDate);
    if (age != null) {
      if (rule.ageMin != null && age < rule.ageMin) return false;
      if (rule.ageMax != null && age > rule.ageMax) return false;
    }
  }
  if (rule.heightMaxCm != null) {
    if (input.heightCm == null) return false; // 신장 필수
    if (!(input.heightCm < rule.heightMaxCm)) return false; // 상한 미만
  }
  return true;
}
