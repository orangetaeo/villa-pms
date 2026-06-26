// lib/service-display.ts — 서비스 카탈로그 표시 헬퍼 (클라이언트 안전 — 서버 전용 import 없음).
//   pickI18n: ko + i18n 맵에서 표시 언어 선택. priceKrwCeil: VND→게스트 KRW(1000원 올림).
//   서버/클라 양쪽에서 사용. (Gemini 번역 translateFields는 서버 전용 lib/service-i18n.ts)

/** ko 원문 + i18n 맵에서 표시 언어 선택. ko이거나 번역 없으면 ko 폴백. 순수. */
export function pickI18n(ko: string, i18n: unknown, lang: string): string {
  if (lang === "ko" || !i18n || typeof i18n !== "object") return ko;
  const v = (i18n as Record<string, unknown>)[lang];
  return typeof v === "string" && v.trim() ? v : ko;
}

/**
 * 주문 selectedOptions 스냅샷 → 표시용 옵션 라벨 배열. 순수·클라 안전.
 *   variant→addon→modifier 순으로 정렬, 로케일별 라벨 선택(pickI18n).
 *   ★ 가격(priceVnd)은 절대 포함하지 않는다 — 공급자/외부 노출 경계에서 안전(원칙2 마진 비공개).
 *   스냅샷이 아니거나 비면 빈 배열.
 */
export function selectedOptionLabels(selectedOptions: unknown, locale: string): string[] {
  if (!Array.isArray(selectedOptions)) return [];
  const groupOrder: Record<string, number> = { variant: 0, addon: 1, modifier: 2 };
  return [...selectedOptions]
    .filter(
      (o): o is { group?: string; labelKo?: string; labelI18n?: unknown } =>
        !!o && typeof o === "object"
    )
    .sort((a, b) => (groupOrder[a.group ?? ""] ?? 9) - (groupOrder[b.group ?? ""] ?? 9))
    .map((o) => pickI18n(typeof o.labelKo === "string" ? o.labelKo : "", o.labelI18n, locale))
    .filter((s) => s.trim().length > 0);
}

/** VND 판매가 → 게스트 표시 KRW(1000원 올림). fxVndPerKrw = 1 KRW당 VND. 순수·클라 안전. */
export function priceKrwCeil(priceVnd: bigint, fxVndPerKrw: string): number {
  const fx = Number(fxVndPerKrw);
  if (!Number.isFinite(fx) || fx <= 0) return 0;
  const krw = Number(priceVnd) / fx;
  return Math.ceil(krw / 1000) * 1000;
}
