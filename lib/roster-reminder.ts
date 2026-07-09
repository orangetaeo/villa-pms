import { BookingStatus, NotificationType, type PrismaClient } from "@prisma/client";
import { enqueueNotification } from "./zalo";
import { todayInVillaTimezone } from "./timeline";
import { addUtcDays, toDateOnlyString } from "./date-vn";

/**
 * D-3 투숙객 명단 미입력 리마인더 (T-roster-reminder-cron)
 *
 * 체크인이 3일 앞인데(VN 타임존) 명단(guestRoster)이 비어있는 CONFIRMED 예약을
 * 운영자(zaloUserId 연결)에게 Zalo로 알린다. 여행사는 비로그인이라 운영자가 챙긴다.
 * 날짜 정확 매칭(checkIn == today+3)이라 예약당 1회 — 멱등(cron 누락 시 미발송 허용).
 * payload에 판매가·마진 절대 미포함 (마진 비공개).
 */

/** 리마인더 대상 운영자 역할 — 명단 후속은 운영 실무라 STAFF 포함 */
const OPERATOR_ROLES = ["OWNER", "MANAGER", "STAFF", "ADMIN"] as const;

export interface RosterReminderTarget {
  bookingId: string;
  villaName: string;
  checkIn: Date;
  guestName: string;
  guestCount: number;
  token: string | null;
  /** 판매 채널(파트너명·연락처) — 운영자가 독촉 연락할 곳. 직접판매면 null */
  partnerName: string | null;
  partnerPhone: string | null;
}

/** 체크인 D-3·CONFIRMED·명단 미입력 예약 조회 (VN 타임존 기준) */
export async function findRosterReminderTargets(
  db: PrismaClient,
  now: Date
): Promise<RosterReminderTarget[]> {
  const target = addUtcDays(todayInVillaTimezone(now), 3);
  const rows = await db.booking.findMany({
    where: {
      status: BookingStatus.CONFIRMED,
      checkIn: target,
      guestRoster: null,
    },
    select: {
      id: true,
      checkIn: true,
      guestName: true,
      guestCount: true,
      agencyName: true, // dual-read 폴백 — Partner 승격 전 텍스트 (ADR-0022)
      villa: { select: { name: true } },
      partner: { select: { name: true, contactPhone: true } },
      proposalItem: { select: { proposal: { select: { token: true } } } },
    },
  });
  return rows.map((b) => ({
    bookingId: b.id,
    villaName: b.villa.name,
    checkIn: b.checkIn,
    guestName: b.guestName,
    guestCount: b.guestCount,
    token: b.proposalItem?.proposal.token ?? null,
    partnerName: b.partner?.name ?? b.agencyName ?? null,
    partnerPhone: b.partner?.contactPhone ?? null,
  }));
}

export interface RosterReminderSummary {
  targetCount: number;
  notificationCount: number;
  bookingIds: string[];
}

/**
 * D-3 리마인더 실행 — 대상 예약마다 zaloUserId 연결된 활성 운영자 전원에게 enqueue.
 * 운영자 0명(미연결)이면 알림 0건이지만 정상 종료(다음 연결 후 재가동).
 */
export async function runRosterReminders(
  db: PrismaClient,
  now: Date
): Promise<RosterReminderSummary> {
  const targets = await findRosterReminderTargets(db, now);
  if (targets.length === 0) {
    return { targetCount: 0, notificationCount: 0, bookingIds: [] };
  }

  const operators = await db.user.findMany({
    where: {
      role: { in: [...OPERATOR_ROLES] },
      isActive: true,
      zaloUserId: { not: null },
    },
    select: { id: true },
  });

  let notificationCount = 0;
  for (const t of targets) {
    for (const op of operators) {
      await enqueueNotification({
        db,
        userId: op.id,
        type: NotificationType.ROSTER_REMINDER,
        payload: {
          bookingId: t.bookingId,
          villaName: t.villaName,
          checkIn: toDateOnlyString(t.checkIn),
          guestName: t.guestName,
          guestCount: t.guestCount,
          token: t.token,
          partnerName: t.partnerName,
          partnerPhone: t.partnerPhone,
        },
      });
      notificationCount += 1;
    }
  }

  return {
    targetCount: targets.length,
    notificationCount,
    bookingIds: targets.map((t) => t.bookingId),
  };
}
