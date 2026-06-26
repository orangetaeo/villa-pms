// lib/minibar.ts — 미니바 회사표준(MinibarItem, #2b ADR-0016) 공유 모듈.
//
// MinibarItem은 전 빌라 공통 1세트다(villaId 없음). unitPriceVnd = 우리 회사 고객 청구 단가(판매가).
//   ★ 공급자·공개(/p) 라우트에서 절대 조회 금지 — 마진 비공개 원칙2. 이 모듈은 운영자 화면 전용 헬퍼만 제공한다.
//
// 표시명: 운영자는 nameKo(한국어)만 입력한다. nameVi는 저장 시 Gemini로 자동 생성(autoTranslateNameVi).
//   소비자(게스트 vi) 화면은 자동번역된 nameVi를 본다(운영자 입력 최소화 — 테오 결정 2026-06-26).
//   5개 언어 인쇄(ko/vi/en/zh/ru)에서는 vi/ko로 폴백.

/** 표시명 입력 (BigInt 직렬화 회피 위해 가격은 별도 문자열로 다룸) */
export interface MinibarItemName {
  nameKo: string;
  nameVi: string | null;
}

/** 로케일별 표시명 — vi면 nameVi 우선(없으면 nameKo), 그 외 언어는 nameKo. */
export function minibarItemName(item: MinibarItemName, locale: string): string {
  if (locale === "vi") return item.nameVi?.trim() || item.nameKo;
  return item.nameKo;
}

/** VND 동 단위 비음수 정수 문자열(최대 15자리) — BigInt는 JSON 직렬화 불가하므로 문자열 수신. */
export const MINIBAR_VND_DIGITS = /^\d{1,15}$/;

/** 자동생성 itemKey — 표시명 변경과 무관한 안정 식별 코드. 시간·인덱스 기반(충돌 회피). */
export function generateMinibarItemKey(seed: number): string {
  return `mb_${seed.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 한국어 품목명 → 베트남어 자동번역(소비자 화면 표시용).
 *   운영자는 한국어만 입력하고(입력 최소화), 게스트(vi) 화면은 자동번역된 nameVi를 본다.
 *   Gemini 키 미설정·API 실패 시 null 반환(vi 폴백이 nameKo라 화면 안 깨짐 — 번역 누락 무해).
 *   ⚠️ 서버 전용. 라우트 핸들러에서 await로 사용(gemini는 동적 import로 클라 번들 유입 차단).
 */
export async function autoTranslateNameVi(nameKo: string): Promise<string | null> {
  const trimmed = nameKo.trim();
  if (trimmed.length === 0) return null;
  try {
    const { translateText } = await import("./gemini");
    const vi = (await translateText(trimmed, "vi")).trim();
    return vi.length > 0 ? vi.slice(0, 60) : null;
  } catch {
    return null;
  }
}
