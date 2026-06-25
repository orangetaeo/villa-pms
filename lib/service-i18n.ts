// lib/service-i18n.ts — 서비스 카탈로그 다국어·환율 표시 헬퍼 (ADR-0019 v2 #6)
//
// 관리자는 한국어만 입력 → 저장 시 Gemini로 en/vi/zh/ru 자동번역해 i18n 맵에 보관(translateFields).
// 게스트 화면은 언어전환으로 pickI18n으로 선택 표시. 가격은 VND만 저장, KRW는 표시 시점 환율 올림(priceKrwCeil).
import { translateBatch, type TranslateTarget } from "./gemini";
import { suggestSalePriceKrw } from "./pricing";

export const SERVICE_I18N_TARGETS: TranslateTarget[] = ["en", "vi", "zh", "ru"];

export interface I18nMap {
  en: string;
  vi: string;
  zh: string;
  ru: string;
}

/** ko 원문 + i18n 맵에서 표시 언어 선택. ko이거나 번역 없으면 ko 폴백. 순수. */
export function pickI18n(ko: string, i18n: unknown, lang: string): string {
  if (lang === "ko" || !i18n || typeof i18n !== "object") return ko;
  const v = (i18n as Record<string, unknown>)[lang];
  return typeof v === "string" && v.trim() ? v : ko;
}

/** VND 판매가 → 게스트 표시 KRW(1000원 올림). 환율(FX_VND_PER_KRW) 문자열. 순수. */
export function priceKrwCeil(priceVnd: bigint, fxVndPerKrw: string): number {
  let krw: number;
  try {
    krw = suggestSalePriceKrw(priceVnd, fxVndPerKrw); // 정본 환산(half-up)
  } catch {
    return 0;
  }
  return Math.ceil(krw / 1000) * 1000;
}

/**
 * 한국어 문자열 배열 → 각 항목의 {en,vi,zh,ru} 맵 배열(정렬 동일). 언어당 1회 호출(4회).
 * 번역 실패는 원문 폴백(translateBatch가 처리). GEMINI 미설정이면 throw — 호출측이 best-effort 처리.
 */
export async function translateFields(koTexts: string[]): Promise<I18nMap[]> {
  if (koTexts.length === 0) return [];
  const [en, vi, zh, ru] = await Promise.all(
    SERVICE_I18N_TARGETS.map((t) => translateBatch(koTexts, t))
  );
  return koTexts.map((_, i) => ({ en: en[i], vi: vi[i], zh: zh[i], ru: ru[i] }));
}
