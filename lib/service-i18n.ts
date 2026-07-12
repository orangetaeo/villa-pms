// lib/service-i18n.ts — 서비스 카탈로그 다국어·환율 표시 헬퍼 (ADR-0019 v2 #6)
//
// 관리자는 한국어만 입력 → 저장 시 Gemini로 en/vi/zh/ru 자동번역해 i18n 맵에 보관(translateFields).
// 게스트 화면은 언어전환으로 pickI18n으로 선택 표시. 가격은 VND만 저장, KRW는 표시 시점 환율 올림(priceKrwCeil).
import { translateBatch, type TranslateTarget } from "./gemini";

// 표시 헬퍼는 클라 안전 모듈에서 재export(서버 전용 gemini import 분리)
export { pickI18n, priceKrwCeil } from "./service-display";

export const SERVICE_I18N_TARGETS: TranslateTarget[] = ["en", "vi", "zh", "ru"];

export interface I18nMap {
  en: string;
  vi: string;
  zh: string;
  ru: string;
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

// ── 카탈로그 항목 자동번역(저장용) ────────────────────────────────────────────
//   nameKo + (descKo) + 각 옵션 labelKo를 한 번에 번역 → nameI18n/descI18n/옵션 labelI18n로 채워 반환.
//   ★ best-effort: 호출측이 try/catch로 감싸 실패 시 i18n 없이(ko 폴백) 저장한다.

/** 자동번역 대상 옵션 — labelKo(+선택 descKo)만 입력, i18n은 채워서 반환. costVnd는 운영자 전용 패스스루. */
export interface TranslatableOption {
  key: string;
  labelKo: string;
  priceVnd?: string | null;
  descKo?: string | null;
  costVnd?: string | null;
  // TICKET 구분 자동판정 규칙(ADR-0036) — 번역 대상 아님, 패스스루 보존.
  bornBeforeYear?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  heightMaxCm?: number | null;
}
export interface TranslatedOption extends TranslatableOption {
  labelI18n: I18nMap;
  descI18n: I18nMap | null;
}
export interface TranslatableOptions {
  variants?: TranslatableOption[];
  addons?: TranslatableOption[];
  modifiers?: TranslatableOption[];
}
export interface TranslatedOptions {
  variants: TranslatedOption[];
  addons: TranslatedOption[];
  modifiers: TranslatedOption[];
}
export interface CatalogTranslations {
  nameI18n: I18nMap;
  descI18n: I18nMap | null;
  options: TranslatedOptions;
}

/**
 * 카탈로그 항목의 한국어 텍스트 전체(이름·설명·옵션 라벨)를 1회 번역해 i18n 맵으로 매핑.
 * descKo가 없으면 descI18n=null. 옵션이 없으면 빈 배열. 언어당 1회(translateFields) 호출.
 * GEMINI 미설정/실패 시 throw — 호출측이 best-effort 처리(i18n 없이 저장).
 */
export async function translateCatalogItem(input: {
  nameKo: string;
  descKo?: string | null;
  options?: TranslatableOptions | null;
}): Promise<CatalogTranslations> {
  const hasDesc = input.descKo != null && input.descKo !== "";
  const variants = input.options?.variants ?? [];
  const addons = input.options?.addons ?? [];
  const modifiers = input.options?.modifiers ?? [];
  const optAll = [...variants, ...addons, ...modifiers];
  // 설명이 있는 옵션의 optAll 인덱스(번역 후 되돌리기 위함)
  const optDescIdx: number[] = [];
  optAll.forEach((o, i) => {
    if (o.descKo != null && o.descKo !== "") optDescIdx.push(i);
  });

  // 번역 입력 배열 순서: [nameKo, (descKo?), ...옵션 labelKo, ...설명있는 옵션 descKo]
  const koTexts = [
    input.nameKo,
    ...(hasDesc ? [input.descKo as string] : []),
    ...optAll.map((o) => o.labelKo),
    ...optDescIdx.map((i) => optAll[i].descKo as string),
  ];
  const maps = await translateFields(koTexts);

  let cursor = 0;
  const nameI18n = maps[cursor++];
  const descI18n = hasDesc ? maps[cursor++] : null;
  const labelMaps = maps.slice(cursor, cursor + optAll.length);
  cursor += optAll.length;
  const descMaps = maps.slice(cursor); // 길이 == optDescIdx.length
  const optDescI18n = new Map<number, I18nMap>();
  optDescIdx.forEach((optIdx, k) => optDescI18n.set(optIdx, descMaps[k]));

  let oi = 0;
  const take = (arr: TranslatableOption[]): TranslatedOption[] =>
    arr.map((o) => {
      const idx = oi++;
      return { ...o, labelI18n: labelMaps[idx], descI18n: optDescI18n.get(idx) ?? null };
    });

  return {
    nameI18n,
    descI18n,
    options: { variants: take(variants), addons: take(addons), modifiers: take(modifiers) },
  };
}

/** DB 저장용 옵션 1개 — labelKo + (번역되면)labelI18n + priceVnd + (선택)descKo/descI18n/costVnd. */
export interface PersistableOption {
  key: string;
  labelKo: string;
  labelI18n?: I18nMap;
  priceVnd?: string | null;
  descKo?: string | null;
  descI18n?: I18nMap | null;
  costVnd?: string | null;
  // TICKET 구분 자동판정 규칙(ADR-0036) — 저장 시 보존(번역 안 함).
  bornBeforeYear?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  heightMaxCm?: number | null;
}
export interface PersistableOptions {
  variants: PersistableOption[];
  addons: PersistableOption[];
  modifiers: PersistableOption[];
}
export interface CatalogI18nResult {
  nameI18n: I18nMap | null;
  descI18n: I18nMap | null;
  /** 옵션 입력이 있었으면 labelI18n 채운 옵션 묶음(없으면 null → options 미변경/미저장 대상). */
  options: PersistableOptions | null;
}

/**
 * 저장 직전 best-effort 자동번역 래퍼 — 절대 throw하지 않는다(GEMINI 미설정/실패 시 i18n 없이 ko 폴백).
 *   options가 입력되면 항상 PersistableOptions를 반환(번역 실패해도 labelKo+priceVnd는 보존).
 */
export async function buildCatalogI18n(input: {
  nameKo: string;
  descKo?: string | null;
  options?: TranslatableOptions | null;
}): Promise<CatalogI18nResult> {
  const hasOptions = input.options != null;
  // TICKET 구분 규칙(선택 필드) 패스스루 — 값 없으면 키 미포함(옵션 shape 최소 유지).
  const ruleFields = (o: TranslatableOption): Partial<PersistableOption> => ({
    ...(o.bornBeforeYear != null ? { bornBeforeYear: o.bornBeforeYear } : {}),
    ...(o.ageMin != null ? { ageMin: o.ageMin } : {}),
    ...(o.ageMax != null ? { ageMax: o.ageMax } : {}),
    ...(o.heightMaxCm != null ? { heightMaxCm: o.heightMaxCm } : {}),
  });
  // 번역 결과를 PersistableOption으로 정규화(라벨·설명 i18n + 원가·구분규칙 패스스루)
  const persist = (o: TranslatedOption): PersistableOption => ({
    key: o.key,
    labelKo: o.labelKo,
    labelI18n: o.labelI18n,
    priceVnd: o.priceVnd ?? null,
    descKo: o.descKo ?? null,
    descI18n: o.descI18n ?? null,
    costVnd: o.costVnd ?? null,
    ...ruleFields(o),
  });
  // 번역 실패 시 i18n 없이 ko 폴백 — descKo/costVnd/구분규칙은 그대로 보존
  const passthroughOpt = (o: TranslatableOption): PersistableOption => ({
    key: o.key,
    labelKo: o.labelKo,
    priceVnd: o.priceVnd ?? null,
    descKo: o.descKo ?? null,
    costVnd: o.costVnd ?? null,
    ...ruleFields(o),
  });
  const passthrough = (): PersistableOptions | null =>
    hasOptions
      ? {
          variants: (input.options?.variants ?? []).map(passthroughOpt),
          addons: (input.options?.addons ?? []).map(passthroughOpt),
          modifiers: (input.options?.modifiers ?? []).map(passthroughOpt),
        }
      : null;
  try {
    const t = await translateCatalogItem(input);
    return {
      nameI18n: t.nameI18n,
      descI18n: t.descI18n,
      options: hasOptions
        ? {
            variants: t.options.variants.map(persist),
            addons: t.options.addons.map(persist),
            modifiers: t.options.modifiers.map(persist),
          }
        : null,
    };
  } catch {
    // GEMINI 미설정/실패 — i18n 없이 ko 폴백 저장
    return { nameI18n: null, descI18n: null, options: passthrough() };
  }
}
