// lib/marketing/public-name.ts — 공개 마케팅 표시명 **단일 소스** (원칙 1 교정, 2026-07-24)
//
// ★ 왜 이 파일이 필요한가: 마케팅 산출물(YT 쇼츠 음성·화면, IG 캡션·헤드라인, SEO 블로그, slug)에
//   빌라 **고유 실명**(villa.name·nameVi)이 그대로 박혀 있었다. 한국 여행객이 실명으로 검색하면
//   빌라의 직접 예약 페이지(Airbnb/Agoda)나 공급자를 찾아 **테오를 우회한 직거래**가 가능하다
//   → 원칙 1(재고 비공개)·원칙 2(마진 비공개) 동시 붕괴.
//
// ★ 규칙(테오 2026-07-24):
//   ⑴ 공개 명칭 = **지역·특징 자동 문구**. 고유 실명(name/nameVi)은 어떤 공개 경로에도 넣지 않는다.
//   ⑵ 단지명(complex)은 노출 OK — "푸꾸옥 {단지} {N}베드 프라이빗 풀빌라".
//   ⑶ **결정형**(무작위 금지) — 같은 빌라는 항상 같은 라벨(SEO title·JSON-LD 일관성).
//
// ★ 내부(운영자) 화면은 실명을 그대로 쓴다 — 이 헬퍼는 공개 경계 전용이다.

export interface PublicNameFacts {
  complex?: string | null;
  /** 한글 단지 병기(쏘나씨 등). 있으면 우선 — 한국어 검색·표시 타깃이므로. */
  areaNameKo?: string | null;
  bedrooms?: number | null;
  hasPool?: boolean;
}

/**
 * 공개 마케팅 표시명 — 고유 빌라 실명 절대 미사용. 지역/단지 + 특징 조합.
 *
 * 규칙:
 *   - 기본형: `푸꾸옥 {단지} {N}베드 프라이빗 풀빌라` (단지 = areaNameKo ?? complex)
 *   - 단지 없음: `푸꾸옥 {N}베드 프라이빗 풀빌라`
 *   - 침실 수 없음: `{N}베드` 토큰 생략
 *   - 풀 없음(hasPool === false): "프라이빗 풀빌라" → "빌라"
 *
 * 예) publicVillaLabel({complex:"Sonasea", areaNameKo:"쏘나씨", bedrooms:3, hasPool:true})
 *       === "푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라"
 */
export function publicVillaLabel(v: PublicNameFacts): string {
  const area = (v.areaNameKo ?? v.complex ?? "").trim();
  const bed = v.bedrooms && v.bedrooms > 0 ? `${v.bedrooms}베드` : "";
  // hasPool을 명시적으로 false로 준 경우에만 "빌라". 미지정·true는 브랜드 기본 "프라이빗 풀빌라".
  const villaWord = v.hasPool === false ? "빌라" : "프라이빗 풀빌라";
  return ["푸꾸옥", area, bed, villaWord].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}
