import { BookingStatus, NotificationType, type PrismaClient } from "@prisma/client";
import { enqueueNotification } from "./zalo";
import { todayInVillaTimezone } from "./timeline";
import { addUtcDays, toDateOnlyString } from "./date-vn";

/**
 * D-1 체크아웃 사전 청소 알림 (T-checkout-advance-notify)
 *
 * 체크아웃이 내일(VN 타임존)인 예약의 청소 담당자(빌라 cleanerId, 없으면 공급자)에게
 * "곧 청소 예정"을 Zalo로 미리 알린다(준비용). 실제 체크아웃 완료 시점에는 기존
 * createCheckoutCleaningTask가 "이제 청소" 요청(CLEANING_REQUEST 기본)을 한 번 더 보낸다.
 *  → 사전(예정) + 완료(시작) 이중 알림.
 *
 * 날짜 정확 매칭(checkOut == today+1)이라 예약당 1회 — 멱등(cron 누락 시 미발송 허용,
 * roster-reminder와 동일 패턴). payload에 고객정보·금액·마진 절대 미포함.
 * 알림은 기존 CLEANING_REQUEST 타입 재사용 + payload.phase="upcoming"으로 텍스트 분기
 * (buildNotificationText) — 새 enum 없이 멱등.
 */

export interface CheckoutReminderSummary {
  targetCount: number;
  notificationCount: number;
  bookingIds: string[];
}

export async function runCheckoutReminders(
  db: PrismaClient,
  now: Date
): Promise<CheckoutReminderSummary> {
  // 내일 체크아웃(VN) + 아직 진행 중(확정·체크인) — 취소·만료·이미 체크아웃은 제외.
  const target = addUtcDays(todayInVillaTimezone(now), 1);
  const rows = await db.booking.findMany({
    where: {
      checkOut: target,
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
    select: {
      id: true,
      checkOut: true,
      // 청소 담당자(빌라 cleanerId) 우선, 없으면 공급자 — 청소 요청 알림과 동일 대상.
      villa: { select: { name: true, cleanerId: true, supplierId: true } },
    },
  });

  let notificationCount = 0;
  for (const b of rows) {
    const targetUserId = b.villa.cleanerId ?? b.villa.supplierId;
    await enqueueNotification({
      db,
      userId: targetUserId,
      type: NotificationType.CLEANING_REQUEST,
      payload: {
        phase: "upcoming", // 사전 알림 — buildNotificationText가 "곧 청소 예정"으로 분기
        bookingId: b.id,
        villaName: b.villa.name,
        dueDate: toDateOnlyString(b.checkOut),
      },
    });
    notificationCount += 1;
  }

  return {
    targetCount: rows.length,
    notificationCount,
    bookingIds: rows.map((b) => b.id),
  };
}
