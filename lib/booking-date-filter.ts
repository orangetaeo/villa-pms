// /bookings 날짜별 검색 — 체크인/아웃/투숙 기준 where 빌더 (T-villa-search-expansion §B)
//
// from/to 는 "일 포함" 범위(UTC 자정 Date). 내부에서 half-open 으로 변환한다: windowEnd = to + 1일.
// 경계는 테스트로 고정(계약 §B2) — 특히 투숙중(staying)의 "from 아침 퇴실(checkOut==from)=미포함, to 입실=포함".
import type { Prisma } from "@prisma/client";
import { addUtcDays } from "@/lib/date-vn";

export type BookingDateBasis = "staying" | "checkin" | "checkout";

/** URL 파라미터 → dateBasis. 무효/미지정은 기본값 "staying"(투숙중). */
export function resolveBookingDateBasis(v: string | undefined): BookingDateBasis {
  return v === "checkin" || v === "checkout" ? v : "staying";
}

/**
 * from/to(일 포함, UTC 자정) + dateBasis → Prisma where.
 * 단일일(from==to)도 허용. 역전(from>to)·한쪽만 입력은 **호출부**가 미적용 처리(여기 도달 전 차단, 500 방지).
 *
 * windowEnd = to + 1일 (half-open):
 * - checkin : checkIn  ∈ [from, windowEnd)
 * - checkout: checkOut ∈ [from, windowEnd)
 * - staying : checkIn < windowEnd AND checkOut > from  (from 아침 퇴실 미포함, to 입실 포함)
 */
export function buildBookingDateBasisWhere(
  from: Date,
  to: Date,
  basis: BookingDateBasis
): Prisma.BookingWhereInput {
  const windowEnd = addUtcDays(to, 1);
  if (basis === "checkin") return { checkIn: { gte: from, lt: windowEnd } };
  if (basis === "checkout") return { checkOut: { gte: from, lt: windowEnd } };
  // staying — 구간과 숙박이 하루라도 겹치면 포함
  return { checkIn: { lt: windowEnd }, checkOut: { gt: from } };
}
