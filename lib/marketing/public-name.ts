// lib/marketing/public-name.ts — 공개 마케팅 표시명 **단일 소스** (원칙 1 교정, 2026-07-24)
//                                 + 로케일화(ADR-0050 Phase 2, 2026-07-24)
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
// ★ 로케일화(ADR-0050): 옵셔널 locale(기본 "ko")로 5개 언어 라벨을 만든다. **새 데이터 0** —
//   비-ko 지역명은 ComplexArea.name(라틴 정본, 예: Sonasea)을 음차 없이 그대로 쓴다(고유명사 라틴 표기는
//   전 언어 표준 관행). 기존 호출부(마케팅·slug·ko 화면)는 기본값 ko라 **전부 무수정**.
//
// ★ 내부(운영자) 화면은 실명을 그대로 쓴다 — 이 헬퍼는 공개 경계 전용이다.
import type { PublicLocale } from "@/lib/seo/public-i18n";

export interface PublicNameFacts {
  complex?: string | null;
  /** 한글 단지 병기(쏘나씨 등). ko에서 우선 — 한국어 검색·표시 타깃이므로. */
  areaNameKo?: string | null;
  /** 라틴 정본 단지명(ComplexArea.name, 예: Sonasea). 비-ko에서 우선 사용(음차 없이 그대로). */
  areaName?: string | null;
  bedrooms?: number | null;
  hasPool?: boolean;
}

interface LabelParts {
  area: string;
  bedrooms?: number | null;
  hasPool?: boolean;
}

/** 로케일별 라벨 조립기 — 어순·수사는 언어별로 다르되 항상 결정형. filter(Boolean)로 빈 토큰 생략. */
const BUILDERS: Record<PublicLocale, (p: LabelParts) => string> = {
  ko: ({ area, bedrooms, hasPool }) => {
    const bed = bedrooms && bedrooms > 0 ? `${bedrooms}베드` : "";
    const villaWord = hasPool === false ? "빌라" : "프라이빗 풀빌라";
    return ["푸꾸옥", area, bed, villaWord].filter(Boolean).join(" ");
  },
  en: ({ area, bedrooms, hasPool }) => {
    const bed = bedrooms && bedrooms > 0 ? `${bedrooms}-Bedroom` : "";
    const villaWord = hasPool === false ? "Villa" : "Private Pool Villa";
    return ["Phu Quoc", area, bed, villaWord].filter(Boolean).join(" ");
  },
  vi: ({ area, bedrooms, hasPool }) => {
    const villaWord = hasPool === false ? "Biệt thự" : "Biệt thự hồ bơi riêng";
    const bed = bedrooms && bedrooms > 0 ? `${bedrooms} phòng ngủ` : "";
    return [villaWord, bed, area, "Phú Quốc"].filter(Boolean).join(" ");
  },
  ru: ({ area, bedrooms, hasPool }) => {
    const villaWord = hasPool === false ? "Вилла" : "Вилла с бассейном";
    const bed = bedrooms && bedrooms > 0 ? `${bedrooms}-спальная` : "";
    // 러시아어는 형용사(N-спальная)가 명사 앞에 와야 자연스럽다(LOC 감수 [1]).
    return [bed, villaWord, area, "Фукуок"].filter(Boolean).join(" ");
  },
  zh: ({ area, bedrooms, hasPool }) => {
    const villaWord = hasPool === false ? "别墅" : "私人泳池别墅";
    const bed = bedrooms && bedrooms > 0 ? `${bedrooms}卧` : "";
    return ["富国岛", area, bed, villaWord].filter(Boolean).join(" ");
  },
};

/**
 * 공개 마케팅 표시명 — 고유 빌라 실명 절대 미사용. 지역/단지 + 특징 조합.
 *
 * 규칙:
 *   - 지역 토큰: ko = areaNameKo ?? complex / 비-ko = areaName ?? complex (라틴 정본 그대로)
 *   - 침실 수 없음: 베드 토큰 생략
 *   - 풀 없음(hasPool === false): "프라이빗 풀빌라" → "빌라"(언어별 대응어)
 *   - locale 기본 "ko" — 기존 단일인자 호출부는 전부 무수정.
 *
 * 예) publicVillaLabel({complex:"Sonasea", areaNameKo:"쏘나씨", bedrooms:3, hasPool:true})
 *       === "푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라"
 *     publicVillaLabel({complex:"Sonasea", areaName:"Sonasea", bedrooms:3, hasPool:true}, "en")
 *       === "Phu Quoc Sonasea 3-Bedroom Private Pool Villa"
 */
export function publicVillaLabel(v: PublicNameFacts, locale: PublicLocale = "ko"): string {
  const area =
    locale === "ko"
      ? (v.areaNameKo ?? v.complex ?? "").trim()
      : (v.areaName ?? v.complex ?? "").trim();
  const build = BUILDERS[locale] ?? BUILDERS.ko;
  return build({ area, bedrooms: v.bedrooms, hasPool: v.hasPool })
    .replace(/\s{2,}/g, " ")
    .trim();
}
