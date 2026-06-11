import { Currency } from "@prisma/client";
import { formatThousands } from "@/lib/format";

/**
 * 공개 제안 페이지(ko) 금액·날짜 표기 — c1/c1-vnd/c3 디자인 표기 규칙
 * KRW "1,350,000원" / VND "25,500,000₫" (둘 다 쉼표 — DESIGN.md C절 VND 변형 주석)
 */
export function formatPublicAmount(
  currency: Currency,
  krw: number | null,
  vnd: bigint | null
): string {
  // 듀얼 컬럼 정합 위반(해당 통화 금액 부재)은 "0원"으로 은폐하지 않는다 (QA L2)
  if (currency === Currency.KRW) {
    if (krw == null) {
      console.error("[public-format] KRW 거래에 totalKrw 부재 — 데이터 정합 위반");
      return "—";
    }
    return `${formatThousands(krw)}원`;
  }
  if (vnd == null) {
    console.error("[public-format] VND 거래에 totalVnd 부재 — 데이터 정합 위반");
    return "—";
  }
  return `${formatThousands(vnd)}₫`;
}

const KO_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** c1 요약 행: "7월 15일 (수)" — @db.Date(UTC 자정)는 UTC 기준으로 그대로 표기 */
export function formatKoDateLong(date: Date): string {
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${KO_WEEKDAYS[date.getUTCDay()]})`;
}

/** c3 요약 카드: "12.20 (금)" */
export function formatKoDateShort(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}.${dd} (${KO_WEEKDAYS[date.getUTCDay()]})`;
}

/** c1 만료 배지: "47시간 후 만료" (1시간 미만은 "곧 만료") */
export function formatExpiryBadge(expiresAt: Date, now: Date): string {
  const hours = Math.floor((expiresAt.getTime() - now.getTime()) / 3_600_000);
  return hours >= 1 ? `${hours}시간 후 만료` : "곧 만료";
}

/** 예약번호 칩: "B-2611" 형식 — booking.id 끝 4자 대문자 */
export function bookingShortCode(bookingId: string): string {
  return `B-${bookingId.slice(-4).toUpperCase()}`;
}
