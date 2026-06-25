// app/g/_components/guest-format.ts — 게스트 화면 금액·날짜 표기 (ADR-0019 S3)
//   ★마진 비공개: 판매가만 표기. 원가·마진 입력 없음. KRW=쉼표(450,000원/₩), VND=쉼표(15,000₫).
import { formatThousands } from "@/lib/format";
import { guestKrwSuffix } from "@/lib/guest-i18n";
import { formatPublicDateShort, type PublicLang } from "@/lib/public-i18n";

/** 옵션/카탈로그 판매가 표기 — KRW 우선(있으면), 없으면 VND. 둘 다 없으면 "—". */
export function guestPrice(
  priceKrw: number | null,
  priceVndStr: string | null,
  lang: PublicLang
): string {
  if (priceKrw != null) return `${formatThousands(priceKrw)}${guestKrwSuffix(lang)}`;
  if (priceVndStr != null && priceVndStr !== "") return `${formatThousands(priceVndStr)}₫`;
  return "—";
}

/** 가산 옵션 부호 표기 — "+250,000원" / "+15,000₫" (음수 가능: 건식 −50,000원). */
export function guestPriceDelta(
  priceKrw: number | null | undefined,
  priceVndStr: string | null | undefined,
  lang: PublicLang
): string {
  if (priceKrw != null && priceKrw !== 0) {
    const sign = priceKrw > 0 ? "+" : "";
    return `${sign}${formatThousands(priceKrw)}${guestKrwSuffix(lang)}`;
  }
  if (priceVndStr != null && priceVndStr !== "") {
    const sign = priceVndStr.startsWith("-") ? "" : "+";
    return `${sign}${formatThousands(priceVndStr)}₫`;
  }
  return "";
}

/** VND 동 단위 합계 표기 (미니바 등) — 항상 ₫ */
export function guestVnd(vndStr: string): string {
  return `${formatThousands(vndStr)}₫`;
}

/** 날짜 범위 "YYYY.MM.DD (요일) ~ YYYY.MM.DD (요일)" — @db.Date(UTC 자정) 기준. */
export function guestDateRange(checkInIso: string, checkOutIso: string, lang: PublicLang): string {
  const ci = new Date(checkInIso);
  const co = new Date(checkOutIso);
  return `${fmtDot(ci, lang)} ~ ${fmtDot(co, lang)}`;
}

/** YYYY.MM.DD (요일) — 점 표기 + 요일(공개 i18n 요일 재사용). */
export function fmtDot(date: Date, lang: PublicLang): string {
  const y = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  // formatPublicDateShort → "MM.DD (요일)" 에서 요일만 추출
  const wd = formatPublicDateShort(date, lang).match(/\((.+)\)/)?.[1] ?? "";
  return `${y}.${mm}.${dd}${wd ? ` (${wd})` : ""}`;
}
