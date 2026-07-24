// lib/webchat-villa-share.ts — 웹챗 빌라 공유 캡션 빌더 (T-webchat-villa-share)
//
// 웹챗(홈페이지 방문자·비로그인) 빌라 공유 카드의 ko 캡션을 만든다.
//   ★URL은 캡션에 넣지 않는다 — 카드가 payload.url로 렌더하고, Gemini 번역이 URL을 훼손하는 것을 피한다.
//   ★누수 불변식(ADR-0031·마진 비공개): from에는 판매가(소비자 VND 대표가)만. 원가·마진 없음.
//   ★실명 비공개(원칙 1 — 비로그인 외부인): displayName은 호출자가 공개 라벨(publicLabel)이나
//     지역·규모 조합 등 **공개 안전 라벨**로 해소해 넘긴다. 이 빌더는 받은 문자열을 그대로 표시만 한다.
import { formatVnd } from "@/lib/format";

/** 캡션 입력 — 금액 무관 메타 + 공개 안전 표시명(호출자 해소). */
export interface WebchatVillaCaptionInput {
  /** 공개 안전 표시명(publicLabel 등) — 고유 실명(name/nameVi)을 그대로 넣지 말 것. */
  displayName: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
}

/**
 * 웹챗 빌라 공유 ko 캡션 — 간단정보(침실·욕실·인원·특징) + 대표 "부터" 가격(₫ / 박).
 * from은 pickLowestSalePrice(…, "CONSUMER") 산출값(소비자 VND 대표가). vnd가 null이면 가격 줄 생략.
 * ★URL 미포함(payload.url로만) — 방문자 언어 번역 시 URL 훼손 회피.
 */
export function buildWebchatVillaCaption(
  villa: WebchatVillaCaptionInput,
  from: { krw: number | null; vnd: bigint | null } | null
): string {
  const lines: string[] = [];
  lines.push(`🏠 ${villa.displayName}`);
  lines.push(`침실 ${villa.bedrooms} · 욕실 ${villa.bathrooms} · 최대 ${villa.maxGuests}인`);
  const features: string[] = [];
  if (villa.hasPool) features.push("수영장");
  if (villa.breakfastAvailable) features.push("조식 가능");
  if (features.length) lines.push(features.join(" · "));
  // 웹챗 빌라 공유는 항상 VND(소비자 대표가). from.vnd만 사용.
  if (from?.vnd != null) {
    lines.push(`${formatVnd(from.vnd)} ~ / 박`);
  }
  return lines.join("\n");
}
