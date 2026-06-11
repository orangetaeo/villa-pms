import { describe, expect, it } from "vitest";
import { BookingStatus } from "@prisma/client";
import {
  computeOccupancyRate,
  formatRemainingHours,
  OCCUPANCY_STAY_STATUSES,
} from "@/lib/booking-stats";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-07-10T12:00:00.000Z");

describe("formatRemainingHours — HOLD 카운트다운 (계약 경계)", () => {
  it("25시간 후 만료 → hours 25", () => {
    const at = new Date(NOW.getTime() + 25 * 3_600_000 + 1);
    expect(formatRemainingHours(at, NOW)).toEqual({ kind: "hours", hours: 25 });
  });

  it("정확히 1시간 → hours 1", () => {
    const at = new Date(NOW.getTime() + 3_600_000);
    expect(formatRemainingHours(at, NOW)).toEqual({ kind: "hours", hours: 1 });
  });

  it("59분 → minutes 59", () => {
    const at = new Date(NOW.getTime() + 59 * 60_000);
    expect(formatRemainingHours(at, NOW)).toEqual({ kind: "minutes", minutes: 59 });
  });

  it("30초 남음 → 최소 1분 표기", () => {
    const at = new Date(NOW.getTime() + 30_000);
    expect(formatRemainingHours(at, NOW)).toEqual({ kind: "minutes", minutes: 1 });
  });

  it("경과 → expired (만료 처리 대기 — cron 처리 전)", () => {
    const at = new Date(NOW.getTime() - 1);
    expect(formatRemainingHours(at, NOW)).toEqual({ kind: "expired" });
    expect(formatRemainingHours(NOW, NOW)).toEqual({ kind: "expired" });
  });

  it("holdExpiresAt null → null (미표기 — QA 합의 조건 2)", () => {
    expect(formatRemainingHours(null, NOW)).toBeNull();
  });
});

describe("computeOccupancyRate — 가동률 (계약 QA 조건 1)", () => {
  const JULY = { start: d("2026-07-01"), end: d("2026-08-01") }; // 31일

  it("점유 집합: CONFIRMED·CHECKED_IN·CHECKED_OUT·NO_SHOW 포함, HOLD·CANCELLED·EXPIRED 제외", () => {
    expect([...OCCUPANCY_STAY_STATUSES]).toEqual([
      BookingStatus.CONFIRMED,
      BookingStatus.CHECKED_IN,
      BookingStatus.CHECKED_OUT,
      BookingStatus.NO_SHOW,
    ]);
    // 같은 3박을 상태만 바꿔 검증 — 빌라 1대 × 31일 분모
    const stay = { checkIn: d("2026-07-10"), checkOut: d("2026-07-13") };
    const rateOf = (status: BookingStatus) =>
      computeOccupancyRate([{ status, ...stay }], 1, JULY.start, JULY.end);
    const occupiedRate = Math.round((3 / 31) * 1000) / 10;
    expect(rateOf(BookingStatus.NO_SHOW)).toBe(occupiedRate); // 날짜 점유 보상 — 포함
    expect(rateOf(BookingStatus.CONFIRMED)).toBe(occupiedRate);
    expect(rateOf(BookingStatus.HOLD)).toBe(0); // 미확정 — 제외
    expect(rateOf(BookingStatus.CANCELLED)).toBe(0);
    expect(rateOf(BookingStatus.EXPIRED)).toBe(0);
  });

  it("월 경계 클리핑: 6/28~7/3 예약은 7월에 2박만 기여 (half-open)", () => {
    const rate = computeOccupancyRate(
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-06-28"), checkOut: d("2026-07-03") }],
      1,
      JULY.start,
      JULY.end
    );
    expect(rate).toBe(Math.round((2 / 31) * 1000) / 10);
  });

  it("월말 경계: 7/30~8/2 예약은 7월에 2박만 기여", () => {
    const rate = computeOccupancyRate(
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-07-30"), checkOut: d("2026-08-02") }],
      1,
      JULY.start,
      JULY.end
    );
    expect(rate).toBe(Math.round((2 / 31) * 1000) / 10);
  });

  it("half-open: 체크아웃일은 비점유 — 7/1~7/2는 1박", () => {
    const rate = computeOccupancyRate(
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-07-01"), checkOut: d("2026-07-02") }],
      1,
      JULY.start,
      JULY.end
    );
    expect(rate).toBe(Math.round((1 / 31) * 1000) / 10);
  });

  it("빌라 0대 → 0% (division guard)", () => {
    const rate = computeOccupancyRate(
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-07-01"), checkOut: d("2026-07-05") }],
      0,
      JULY.start,
      JULY.end
    );
    expect(rate).toBe(0);
  });

  it("만실 → 100% 상한", () => {
    const rate = computeOccupancyRate(
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-06-01"), checkOut: d("2026-09-01") }],
      1,
      JULY.start,
      JULY.end
    );
    expect(rate).toBe(100);
  });
});
