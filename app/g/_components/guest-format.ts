// app/g/_components/guest-format.ts — 게스트 화면 금액·날짜 표기 (ADR-0019 v2)
//   ★마진 비공개: 판매가만 표기(원가·마진 없음). 가격은 VND 단일통화 저장 → KRW는 표시 시점 환율 올림 파생.
//   fx(1 KRW당 VND) 있으면 KRW(450,000원/₩) 우선 표기, 없으면 VND(15,000₫). 환율은 priceKrwCeil로 1000원 올림.
import { formatThousands } from "@/lib/format";
import { guestKrwSuffix } from "@/lib/guest-i18n";
import { priceKrwCeil } from "@/lib/service-display";
import { formatPublicDateShort, type PublicLang } from "@/lib/public-i18n";

/** 옵션/카탈로그 판매가 표기(VND 기준) — fx 있으면 KRW 올림 표기, 없으면 VND. 가격 없으면 "—". */
export function guestPrice(
  priceVndStr: string | null | undefined,
  fxVndPerKrw: string | null,
  lang: PublicLang
): string {
  if (priceVndStr == null || priceVndStr === "") return "—";
  if (fxVndPerKrw) {
    const krw = priceKrwCeil(BigInt(priceVndStr), fxVndPerKrw);
    if (krw > 0) return `${formatThousands(krw)}${guestKrwSuffix(lang)}`;
  }
  return `${formatThousands(priceVndStr)}₫`;
}

/** 가산 옵션 부호 표기(VND 기준) — fx 있으면 "+250,000원", 없으면 "+15,000₫". 음수 가능. */
export function guestPriceDelta(
  priceVndStr: string | null | undefined,
  fxVndPerKrw: string | null,
  lang: PublicLang
): string {
  if (priceVndStr == null || priceVndStr === "") return "";
  const neg = priceVndStr.startsWith("-");
  if (fxVndPerKrw) {
    const abs = neg ? priceVndStr.slice(1) : priceVndStr;
    const krw = priceKrwCeil(BigInt(abs || "0"), fxVndPerKrw);
    if (krw > 0) return `${neg ? "−" : "+"}${formatThousands(krw)}${guestKrwSuffix(lang)}`;
  }
  const sign = neg ? "" : "+";
  return `${sign}${formatThousands(priceVndStr)}₫`;
}

/** KRW 정수 합계 표기(이미 산출된 priceKrw 스냅샷 표기용 — 주문 내역 등). */
export function guestKrw(krw: number, lang: PublicLang): string {
  return `${formatThousands(krw)}${guestKrwSuffix(lang)}`;
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
