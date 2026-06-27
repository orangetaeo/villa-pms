import { Currency } from "@prisma/client";
import { formatThousands } from "@/lib/format";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/**
 * 공개 제안 페이지 금액 표기 (#5 — 5개 언어). KRW는 언어별 접미사(ko "원", 그 외 "₩"),
 * VND는 "₫" 공통. 날짜·만료 배지 표기는 lib/public-i18n(formatPublicDateLong/Short·expiryBadge)로 이전.
 */
export function formatPublicAmount(
  currency: Currency,
  krw: number | null,
  vnd: bigint | null,
  lang: PublicLang = "ko",
  usd?: number | null
): string {
  // 듀얼 컬럼 정합 위반(해당 통화 금액 부재)은 "0원"으로 은폐하지 않는다 (QA L2)
  if (currency === Currency.KRW) {
    if (krw == null) {
      console.error("[public-format] KRW 거래에 totalKrw 부재 — 데이터 정합 위반");
      return "—";
    }
    return `${formatThousands(krw)}${PUBLIC_LABELS[lang].krwSuffix}`;
  }
  // Phase 2 USD: 내부 기록용 판매통화. 구매자가 볼 제안가($)는 표시 허용(원가·마진·fx는 비노출).
  if (currency === Currency.USD) {
    if (usd == null) {
      console.error("[public-format] USD 거래에 totalUsd 부재 — 데이터 정합 위반");
      return "—";
    }
    return `$${formatThousands(usd)}`;
  }
  if (vnd == null) {
    console.error("[public-format] VND 거래에 totalVnd 부재 — 데이터 정합 위반");
    return "—";
  }
  return `${formatThousands(vnd)}₫`;
}

/** 예약번호 칩: "B-2611" 형식 — booking.id 끝 4자 대문자 (언어 무관) */
export function bookingShortCode(bookingId: string): string {
  return `B-${bookingId.slice(-4).toUpperCase()}`;
}
