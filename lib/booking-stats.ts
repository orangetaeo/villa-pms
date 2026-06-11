import { BookingStatus } from "@prisma/client";
import { overlapsHalfOpen } from "@/lib/availability";

/**
 * 예약 목록 화면 보조 계산 (T2.5, 계약: docs/contracts/T2.5-bookings.md)
 * 순수 함수만 — DB 무관, 단위 테스트 대상.
 * (계약은 lib/format.ts 추가로 선언했으나 공유 파일 무수정을 위해 신규 파일로 분리 —
 *  카운트다운은 i18n 키 매핑을 위해 문자열 대신 구조를 반환한다)
 */

/** HOLD 만료 카운트다운 — 화면이 i18n 키로 라벨링 */
export type HoldCountdown =
  | { kind: "expired" } // 경과 — "만료 처리 대기" (cron 처리 전)
  | { kind: "hours"; hours: number } // 1시간 이상 — "N시간 남음"
  | { kind: "minutes"; minutes: number }; // 1시간 미만 — "N분 남음"

/** holdExpiresAt null(스키마상 optional)이면 null — 카운트다운 미표기 (QA 합의 조건 2) */
export function formatRemainingHours(
  expiresAt: Date | null,
  now: Date
): HoldCountdown | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return { kind: "expired" };
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return { kind: "hours", hours };
  return { kind: "minutes", minutes: Math.max(1, Math.floor(ms / 60_000)) };
}

/**
 * 가동률 점유 상태 집합 (QA 합의 조건 1):
 * NO_SHOW 포함(날짜 점유 보상 — SPEC F3), HOLD(미확정)·CANCELLED·EXPIRED 제외.
 * 재고 가용성 판정(OCCUPYING_BOOKING_STATUSES)과는 목적이 다른 별도 집합이다.
 */
export const OCCUPANCY_STAY_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.CHECKED_OUT,
  BookingStatus.NO_SHOW,
] as const;

export interface OccupancyBookingRange {
  status: BookingStatus;
  checkIn: Date;
  checkOut: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * 선택 월 가동률(%) — 점유박 / (ACTIVE 빌라 수 × 월 일수), 소수 1자리.
 * half-open [checkIn, checkOut), 월 경계 [monthStart, monthEnd) 클리핑.
 * 분모는 현재 ACTIVE 빌라 수 기준 근사(월 중 승인 시점 무시 — 계약 선언).
 */
export function computeOccupancyRate(
  bookings: OccupancyBookingRange[],
  activeVillaCount: number,
  monthStart: Date,
  monthEnd: Date
): number {
  if (activeVillaCount <= 0) return 0;
  const monthDays = Math.round(
    (monthEnd.getTime() - monthStart.getTime()) / MS_PER_DAY
  );
  if (monthDays <= 0) return 0;

  const occupying = new Set<BookingStatus>(OCCUPANCY_STAY_STATUSES);
  let occupiedNights = 0;
  for (const b of bookings) {
    if (!occupying.has(b.status)) continue;
    if (!overlapsHalfOpen(b.checkIn, b.checkOut, monthStart, monthEnd)) continue;
    const start = Math.max(b.checkIn.getTime(), monthStart.getTime());
    const end = Math.min(b.checkOut.getTime(), monthEnd.getTime());
    occupiedNights += Math.round((end - start) / MS_PER_DAY);
  }

  const rate = (occupiedNights / (activeVillaCount * monthDays)) * 100;
  return Math.round(Math.min(rate, 100) * 10) / 10;
}
