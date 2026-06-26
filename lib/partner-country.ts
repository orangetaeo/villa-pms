// lib/partner-country.ts — 파트너(여행사·랜드사) 국가 정보 + 청구서 PDF 언어 매핑.
//
// 파트너는 ISO 3166-1 alpha-2 국가 코드를 저장(Partner.country). 청구서 PDF는 이 국가로
// 출력 언어를 자동 결정한다(한국 파트너=한국어, 베트남=베트남어, 그 외=영어).
// PDF 라벨이 완비된 언어만 지원: ko / vi / en. 미지정(null)·미지원 국가는 안전한 폴백.

/** 청구서 PDF가 라벨을 제공하는 언어 (lib/partner-invoice-pdf.tsx의 L 사전과 일치) */
export type InvoiceLocale = "vi" | "ko" | "en";

/** 폼 드롭다운에 노출할 국가 코드 — 푸꾸옥 B2B 거래처 기준 큐레이션. i18n 라벨=adminPartners.countries.<코드> */
export const PARTNER_COUNTRIES = [
  "VN", // 베트남
  "KR", // 한국
  "CN", // 중국
  "RU", // 러시아
  "US", // 미국/영어권
  "JP", // 일본
  "TH", // 태국
] as const;

export type PartnerCountry = (typeof PARTNER_COUNTRIES)[number];

/** zod·검증용 — 허용 국가 코드 집합 */
export function isPartnerCountry(v: unknown): v is PartnerCountry {
  return typeof v === "string" && (PARTNER_COUNTRIES as readonly string[]).includes(v);
}

/**
 * 파트너 국가 → 청구서 PDF 출력 언어.
 * - KR → ko, VN → vi
 * - 미지정(null/"") → vi (국가 정보 도입 이전 파트너의 기존 동작 보존)
 * - 그 외 국가(중국·러시아 등) → en (국제 청구서, 라틴 글리프로 안전 렌더)
 */
export function partnerInvoiceLocale(country?: string | null): InvoiceLocale {
  switch (country) {
    case "KR":
      return "ko";
    case "VN":
    case null:
    case undefined:
    case "":
      return "vi";
    default:
      return "en";
  }
}
