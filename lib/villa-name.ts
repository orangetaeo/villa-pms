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

/**
 * 비로그인 제안 링크 전용 익명 코드명 (2026-07-24).
 *
 * 제안 링크는 여행사·여행객에게 그대로 전달된다. 실명(예: "M villa M1")을 노출하면 지도를 뭉개도
 * 이름 검색으로 공급자를 특정해 우회예약(중개 이탈)이 가능하다(사업 원칙1). 그래서 제안 단계에서는
 * 실명 대신 안정적 코드명만 보여주고, 실명·정확 위치는 예약 확정(입금) 후 운영자가 안내한다.
 *
 * ★ 운영자(ADMIN) 화면·정산·확정 후 안내에는 이 함수를 쓰지 않는다 — 거기선 실명 그대로.
 * villaId(cuid) 기반 결정적 파생이라 같은 빌라는 항상 같은 코드(운영자도 식별 가능). 실명·위치는
 * 코드에서 역산 불가.
 */
export function publicVillaCode(villaId: string): string {
  const alnum = villaId.replace(/[^a-zA-Z0-9]/g, "");
  const tail = (alnum.slice(-4) || "0000").toUpperCase();
  return `Villa Go #${tail}`;
}
