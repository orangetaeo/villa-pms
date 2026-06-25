// lib/service-display.ts — 서비스 카탈로그 표시 헬퍼 (클라이언트 안전 — 서버 전용 import 없음).
//   pickI18n: ko + i18n 맵에서 표시 언어 선택. priceKrwCeil: VND→게스트 KRW(1000원 올림).
//   서버/클라 양쪽에서 사용. (Gemini 번역 translateFields는 서버 전용 lib/service-i18n.ts)

/** ko 원문 + i18n 맵에서 표시 언어 선택. ko이거나 번역 없으면 ko 폴백. 순수. */
export function pickI18n(ko: string, i18n: unknown, lang: string): string {
  if (lang === "ko" || !i18n || typeof i18n !== "object") return ko;
  const v = (i18n as Record<string, unknown>)[lang];
  return typeof v === "string" && v.trim() ? v : ko;
}

/** VND 판매가 → 게스트 표시 KRW(1000원 올림). fxVndPerKrw = 1 KRW당 VND. 순수·클라 안전. */
export function priceKrwCeil(priceVnd: bigint, fxVndPerKrw: string): number {
  const fx = Number(fxVndPerKrw);
  if (!Number.isFinite(fx) || fx <= 0) return 0;
  const krw = Number(priceVnd) / fx;
  return Math.ceil(krw / 1000) * 1000;
}
