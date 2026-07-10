// /bookings 날짜별 검색 where 빌더 경계 테스트 (T-villa-search-expansion §B, 완료기준 4)
import { describe, it, expect } from "vitest";
import {
  resolveBookingDateBasis,
  buildBookingDateBasisWhere,
  type BookingDateBasis,
} from "./booking-date-filter";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("resolveBookingDateBasis", () => {
  it("checkin·checkout 는 그대로, 그 외/미지정은 staying(기본)", () => {
    expect(resolveBookingDateBasis("checkin")).toBe("checkin");
    expect(resolveBookingDateBasis("checkout")).toBe("checkout");
    expect(resolveBookingDateBasis("staying")).toBe("staying");
    expect(resolveBookingDateBasis(undefined)).toBe("staying");
    expect(resolveBookingDateBasis("garbage")).toBe("staying");
  });
});

describe("buildBookingDateBasisWhere — half-open windowEnd=to+1일", () => {
  it("checkin: checkIn ∈ [from, to+1일)", () => {
    const w = buildBookingDateBasisWhere(d("2026-07-01"), d("2026-07-10"), "checkin");
    expect(w).toEqual({ checkIn: { gte: d("2026-07-01"), lt: d("2026-07-11") } });
  });

  it("checkout: checkOut ∈ [from, to+1일)", () => {
    const w = buildBookingDateBasisWhere(d("2026-07-01"), d("2026-07-10"), "checkout");
    expect(w).toEqual({ checkOut: { gte: d("2026-07-01"), lt: d("2026-07-11") } });
  });

  it("staying: checkIn < to+1일 AND checkOut > from", () => {
    const w = buildBookingDateBasisWhere(d("2026-07-01"), d("2026-07-10"), "staying");
    expect(w).toEqual({ checkIn: { lt: d("2026-07-11") }, checkOut: { gt: d("2026-07-01") } });
  });

  it("단일일(from==to)도 windowEnd=to+1일 로 구성", () => {
    const w = buildBookingDateBasisWhere(d("2026-07-05"), d("2026-07-05"), "checkin");
    expect(w).toEqual({ checkIn: { gte: d("2026-07-05"), lt: d("2026-07-06") } });
  });
});

// 경계를 실제 예약에 적용해 포함/제외를 검증하는 순수 판정기 (Prisma 없이 where 의미를 재현)
function matches(
  booking: { checkIn: Date; checkOut: Date },
  from: string,
  to: string,
  basis: BookingDateBasis
): boolean {
  const w = buildBookingDateBasisWhere(d(from), d(to), basis);
  if (basis === "checkin") {
    const c = w.checkIn as { gte: Date; lt: Date };
    return booking.checkIn >= c.gte && booking.checkIn < c.lt;
  }
  if (basis === "checkout") {
    const c = w.checkOut as { gte: Date; lt: Date };
    return booking.checkOut >= c.gte && booking.checkOut < c.lt;
  }
  const ci = w.checkIn as { lt: Date };
  const co = w.checkOut as { gt: Date };
  return booking.checkIn < ci.lt && booking.checkOut > co.gt;
}

describe("staying 경계 하드 케이스 (계약 §B2 필수 2건)", () => {
  it("from 아침 퇴실(checkOut == from) = 미포함", () => {
    // 6/28 입실 → 7/1 아침 퇴실. 검색 [7/1, 7/10] 투숙중 → 미포함
    const b = { checkIn: d("2026-06-28"), checkOut: d("2026-07-01") };
    expect(matches(b, "2026-07-01", "2026-07-10", "staying")).toBe(false);
  });

  it("to 입실(checkIn == to) = 포함", () => {
    // 7/10 입실 → 7/12 퇴실. 검색 [7/1, 7/10] 투숙중 → 포함(to 당일 입실)
    const b = { checkIn: d("2026-07-10"), checkOut: d("2026-07-12") };
    expect(matches(b, "2026-07-01", "2026-07-10", "staying")).toBe(true);
  });

  it("구간 완전 이전/이후 숙박은 제외", () => {
    const before = { checkIn: d("2026-06-20"), checkOut: d("2026-06-25") };
    const after = { checkIn: d("2026-07-15"), checkOut: d("2026-07-18") };
    expect(matches(before, "2026-07-01", "2026-07-10", "staying")).toBe(false);
    expect(matches(after, "2026-07-01", "2026-07-10", "staying")).toBe(false);
  });

  it("구간을 완전히 감싸는 장기 숙박은 포함", () => {
    const b = { checkIn: d("2026-06-01"), checkOut: d("2026-08-01") };
    expect(matches(b, "2026-07-01", "2026-07-10", "staying")).toBe(true);
  });
});

describe("checkin/checkout 경계", () => {
  it("checkin: to 당일 입실 포함, to+1일 입실 제외", () => {
    expect(matches({ checkIn: d("2026-07-10"), checkOut: d("2026-07-12") }, "2026-07-01", "2026-07-10", "checkin")).toBe(true);
    expect(matches({ checkIn: d("2026-07-11"), checkOut: d("2026-07-12") }, "2026-07-01", "2026-07-10", "checkin")).toBe(false);
    // from 이전 입실은 제외
    expect(matches({ checkIn: d("2026-06-30"), checkOut: d("2026-07-12") }, "2026-07-01", "2026-07-10", "checkin")).toBe(false);
  });

  it("checkout: to 당일 퇴실 포함, from 당일 퇴실도 포함(퇴실 기준은 from 경계 포함)", () => {
    expect(matches({ checkIn: d("2026-06-28"), checkOut: d("2026-07-10") }, "2026-07-01", "2026-07-10", "checkout")).toBe(true);
    expect(matches({ checkIn: d("2026-06-28"), checkOut: d("2026-07-01") }, "2026-07-01", "2026-07-10", "checkout")).toBe(true);
    // to+1일 퇴실은 제외
    expect(matches({ checkIn: d("2026-06-28"), checkOut: d("2026-07-11") }, "2026-07-01", "2026-07-10", "checkout")).toBe(false);
  });
});
