import { describe, expect, it } from "vitest";
import { BookingStatus, VillaStatus } from "@prisma/client";
import {
  OCCUPYING_BOOKING_STATUSES,
  assertValidStayRange,
  evaluateAvailability,
  overlapsHalfOpen,
} from "./availability";

/** @db.Date 규약과 동일하게 UTC 자정 Date 생성 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("overlapsHalfOpen — [start, end) half-open 겹침", () => {
  it("완전 분리 구간은 겹치지 않는다", () => {
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-10"), d("2026-07-15"))).toBe(false);
    expect(overlapsHalfOpen(d("2026-07-10"), d("2026-07-15"), d("2026-07-01"), d("2026-07-05"))).toBe(false);
  });

  it("체크아웃일 = 다음 체크인일이면 겹치지 않는다 (back-to-back 허용)", () => {
    // 기존 예약 7/1~7/5(체크아웃), 신규 7/5 체크인 — 같은 날 교대 가능해야 함
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-05"), d("2026-07-08"))).toBe(false);
    expect(overlapsHalfOpen(d("2026-07-05"), d("2026-07-08"), d("2026-07-01"), d("2026-07-05"))).toBe(false);
  });

  it("하루라도 숙박일이 겹치면 겹침", () => {
    // 기존 7/1~7/5, 신규 7/4~7/6 — 7/4 밤이 겹침
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-04"), d("2026-07-06"))).toBe(true);
  });

  it("포함 관계·동일 구간은 겹침", () => {
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-10"), d("2026-07-03"), d("2026-07-04"))).toBe(true);
    expect(overlapsHalfOpen(d("2026-07-03"), d("2026-07-04"), d("2026-07-01"), d("2026-07-10"))).toBe(true);
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-01"), d("2026-07-05"))).toBe(true);
  });

  it("시즌 경계(연말연시)를 걸친 구간도 정상 판정", () => {
    expect(overlapsHalfOpen(d("2026-12-30"), d("2027-01-02"), d("2027-01-01"), d("2027-01-03"))).toBe(true);
    expect(overlapsHalfOpen(d("2026-12-30"), d("2027-01-01"), d("2027-01-01"), d("2027-01-03"))).toBe(false);
  });
});

describe("assertValidStayRange", () => {
  it("checkIn < checkOut 이면 통과", () => {
    expect(() => assertValidStayRange({ checkIn: d("2026-07-01"), checkOut: d("2026-07-02") })).not.toThrow();
  });

  it("0박(동일 날짜)은 거부", () => {
    expect(() => assertValidStayRange({ checkIn: d("2026-07-01"), checkOut: d("2026-07-01") })).toThrow(RangeError);
  });

  it("역전 구간은 거부", () => {
    expect(() => assertValidStayRange({ checkIn: d("2026-07-05"), checkOut: d("2026-07-01") })).toThrow(RangeError);
  });
});

describe("evaluateAvailability — SPEC F2 판정식", () => {
  const base = {
    villaStatus: VillaStatus.ACTIVE,
    isSellable: true,
    overlappingBookingCount: 0,
    overlappingBlockCount: 0,
  };

  it("ACTIVE + 겹침 없음 + 검수 통과 → available·sellable", () => {
    expect(evaluateAvailability(base)).toEqual({ available: true, sellable: true, reasons: [] });
  });

  it("예약 겹침 → 불가 (BOOKING_OVERLAP)", () => {
    const r = evaluateAvailability({ ...base, overlappingBookingCount: 1 });
    expect(r.available).toBe(false);
    expect(r.sellable).toBe(false);
    expect(r.reasons).toContain("BOOKING_OVERLAP");
  });

  it("차단 겹침 → 불가 (BLOCK_OVERLAP)", () => {
    const r = evaluateAvailability({ ...base, overlappingBlockCount: 2 });
    expect(r.available).toBe(false);
    expect(r.reasons).toContain("BLOCK_OVERLAP");
  });

  it.each([VillaStatus.DRAFT, VillaStatus.PENDING_REVIEW, VillaStatus.INACTIVE])(
    "villa.status=%s → 불가 (VILLA_NOT_ACTIVE)",
    (status) => {
      const r = evaluateAvailability({ ...base, villaStatus: status });
      expect(r.available).toBe(false);
      expect(r.sellable).toBe(false);
      expect(r.reasons).toContain("VILLA_NOT_ACTIVE");
    }
  );

  it("검수 게이트: available이어도 isSellable=false면 sellable=false", () => {
    const r = evaluateAvailability({ ...base, isSellable: false });
    expect(r.available).toBe(true); // 재고 자체는 비어 있음 (ADMIN 조망용)
    expect(r.sellable).toBe(false); // 판매는 검수 승인 전 금지
    expect(r.reasons).toEqual(["NOT_SELLABLE"]);
  });

  it("복합 사유는 모두 수집된다", () => {
    const r = evaluateAvailability({
      villaStatus: VillaStatus.INACTIVE,
      isSellable: false,
      overlappingBookingCount: 1,
      overlappingBlockCount: 1,
    });
    expect(r.reasons).toEqual(
      expect.arrayContaining(["VILLA_NOT_ACTIVE", "BOOKING_OVERLAP", "BLOCK_OVERLAP", "NOT_SELLABLE"])
    );
    expect(r.available).toBe(false);
    expect(r.sellable).toBe(false);
  });
});

describe("OCCUPYING_BOOKING_STATUSES — 점유 상태 정의", () => {
  it("HOLD·CONFIRMED·CHECKED_IN만 점유", () => {
    expect([...OCCUPYING_BOOKING_STATUSES].sort()).toEqual(
      [BookingStatus.HOLD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN].sort()
    );
  });

  it("EXPIRED·CANCELLED·CHECKED_OUT·NO_SHOW는 점유가 아니다 (재고 복귀)", () => {
    const occupying = OCCUPYING_BOOKING_STATUSES as readonly BookingStatus[];
    for (const s of [
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
      BookingStatus.CHECKED_OUT,
      BookingStatus.NO_SHOW,
    ]) {
      expect(occupying).not.toContain(s);
    }
  });
});
