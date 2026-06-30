// lib/villa-name.ts — 빌라명 베트남어 병기 표기 (ADR-0020)
//
// 빌라명(Villa.name)은 한국어 음역으로 저장된다(예: "쏘나씨 V11"). 베트남 공급자·외부는
// 한국어를 못 읽으므로, 비운영자 화면·문서·메시지에는 한국어명 + 베트남어/라틴명을 병기한다.
// 운영자(ADMIN) 화면은 한국어 원문(name)을 그대로 쓴다 — 이 헬퍼를 쓰지 않는다.

/** 빌라명 병기 입력 — name(필수) + nameVi(선택, ADMIN 확정값) */
export interface VillaNameParts {
  name: string;
  nameVi?: string | null;
}

/**
 * 비운영자용 빌라 표시명. nameVi가 있고 name과 다르면 `name (nameVi)` 병기, 아니면 name만.
 * 순수 함수 — 폴백(미확정 빌라는 한국어만)·중복 방지(name===nameVi면 병기 안 함).
 */
export function formatVillaName(villa: VillaNameParts): string {
  const name = villa.name;
  const vi = villa.nameVi?.trim();
  if (!vi || vi === name) return name;
  return `${name} (${vi})`;
}

/**
 * 베트남어 전용 표시명 — nameVi 우선, 없으면 name 폴백.
 * 청소직원(CLEANER) 등 한국어를 노출하지 않아야 하는 화면 전용(병기 대신 단일 표기).
 */
export function villaNameViOnly(villa: VillaNameParts): string {
  return villa.nameVi?.trim() || villa.name;
}
