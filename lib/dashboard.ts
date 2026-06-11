import {
  BookingStatus,
  CleaningStatus,
  type PrismaClient,
} from "@prisma/client";
import { parseUtcDateOnly, todayVnDateString } from "./date-vn";

/**
 * 대시보드 데이터 단일 소스 (T2.6, SPEC F7 — b1 스탯 4종·활동 피드·오늘 리스트)
 * ADMIN 화면 전제 — 전체 재고·예약을 조망하므로 (admin) 레이아웃 가드 아래에서만 사용.
 * 피드에는 여권·판매가·마진·원가를 절대 싣지 않는다 (개인정보·마진 비공개).
 */

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** 가예약 "최근 만료 N시간 후" 배지 — 올림, 과거면 0 */
export function hoursUntil(now: Date, at: Date): number {
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 3_600_000));
}

export type RelativeTime =
  | { key: "justNow" }
  | { key: "minutesAgo"; n: number }
  | { key: "hoursAgo"; n: number }
  | { key: "date"; date: string };

/** 타임스탬프 → VN(Asia/Ho_Chi_Minh) 기준 YYYY.MM.DD (표시 규약 — QA D-3) */
export function vnDateLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
    .format(at)
    .replaceAll("-", ".");
}

/** 피드 상대 시간 — 1분 미만/분/시간/그 외 VN 날짜(YYYY.MM.DD) */
export function relativeTimeParts(now: Date, at: Date): RelativeTime {
  const diffMin = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (diffMin < 1) return { key: "justNow" };
  if (diffMin < 60) return { key: "minutesAgo", n: diffMin };
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return { key: "hoursAgo", n: hours };
  return { key: "date", date: vnDateLabel(at) };
}

export type FeedDot = "amber" | "blue" | "indigo" | "emerald" | "red" | "slate";

export interface FeedKind {
  /** adminDashboard.feed.labels.* 키 */
  labelKey: string;
  dot: FeedDot;
}

interface AuditLogLike {
  entity: string;
  action: string;
  changes: unknown;
}

function changedStatus(changes: unknown): string | null {
  if (changes && typeof changes === "object") {
    const status = (changes as Record<string, { new?: unknown }>).status;
    if (status && typeof status.new === "string") return status.new;
  }
  return null;
}

/** AuditLog → 피드 종류 매핑 (b1 활동 피드 — dot 색은 b1 모크 기준) */
export function feedEntryFor(log: AuditLogLike): FeedKind {
  const status = changedStatus(log.changes);

  if (log.entity === "Booking") {
    if (log.action === "CREATE") return { labelKey: "holdCreated", dot: "amber" };
    switch (status) {
      case BookingStatus.CONFIRMED:
        return { labelKey: "bookingConfirmed", dot: "blue" };
      case BookingStatus.CHECKED_IN:
        return { labelKey: "checkedIn", dot: "indigo" };
      case BookingStatus.CHECKED_OUT:
        return { labelKey: "checkedOut", dot: "slate" };
      case BookingStatus.EXPIRED:
        return { labelKey: "holdExpired", dot: "slate" };
      case BookingStatus.CANCELLED:
        return { labelKey: "bookingCancelled", dot: "red" };
    }
  }
  if (log.entity === "CleaningTask") {
    if (log.action === "CREATE") return { labelKey: "cleaningRequested", dot: "emerald" };
    switch (status) {
      case CleaningStatus.PHOTOS_SUBMITTED:
        return { labelKey: "cleaningSubmitted", dot: "emerald" };
      case CleaningStatus.APPROVED:
        return { labelKey: "cleaningApproved", dot: "emerald" };
      case CleaningStatus.REJECTED:
        return { labelKey: "cleaningRejected", dot: "red" };
    }
  }
  if (log.entity === "Proposal" && log.action === "CREATE") {
    return { labelKey: "proposalCreated", dot: "blue" };
  }
  if (log.entity === "Villa") {
    if (log.action === "CREATE") return { labelKey: "villaCreated", dot: "blue" };
    if (status === "ACTIVE") return { labelKey: "villaApproved", dot: "emerald" };
  }
  if (log.entity === "CheckInRecord") {
    return { labelKey: "agreementSigned", dot: "indigo" };
  }
  return { labelKey: "generic", dot: "slate" };
}

// ===================== 조회 층 =====================

export interface TodayBookingItem {
  id: string;
  villaName: string;
  guestName: string;
  nights: number;
  status: BookingStatus;
}

export interface PendingCleaningItem {
  id: string;
  villaName: string;
  photoCount: number;
  submittedDate: string; // YYYY.MM.DD (createdAt 기준 — 제출 시각 컬럼 없음)
}

export interface DashboardStats {
  todayLabel: string; // YYYY.MM.DD (VN 기준)
  checkinToday: TodayBookingItem[];
  checkoutToday: TodayBookingItem[];
  holdCount: number;
  /** 가장 임박한 홀드 만료까지 시간 (HOLD 0건이면 null) */
  nextHoldExpiryHours: number | null;
  cleaningPendingCount: number;
  cleaningPending: PendingCleaningItem[];
}

export async function loadDashboardStats(
  db: PrismaClient,
  now: Date
): Promise<DashboardStats> {
  // now 주입 일관성(QA I-1): VN 오늘도 now 기준으로 계산
  const todayStr = todayVnDateString(now);
  const today = parseUtcDateOnly(todayStr);
  if (!today) throw new Error(`오늘 날짜 계산 실패: ${todayStr}`);

  const bookingSelect = {
    id: true,
    guestName: true,
    nights: true,
    status: true,
    villa: { select: { name: true } },
  } as const;

  const [checkins, checkouts, holdCount, nextHold, cleaningPendingCount, cleaningPendingRows] =
    await Promise.all([
      // 정의는 /bookings 프리셋(today-checkin·today-checkout)과 동일 — 카드 건수와
      // 링크 목록이 일치해야 함 (QA D-2). "오늘 처리할 일" 중심: 체크인 예정(CONFIRMED)·
      // 체크아웃 예정(CHECKED_IN)만 집계, 처리 완료 건은 카드에서 제외
      db.booking.findMany({
        where: { checkIn: today, status: BookingStatus.CONFIRMED },
        orderBy: { createdAt: "asc" },
        select: bookingSelect,
      }),
      db.booking.findMany({
        where: { checkOut: today, status: BookingStatus.CHECKED_IN },
        orderBy: { createdAt: "asc" },
        select: bookingSelect,
      }),
      db.booking.count({ where: { status: BookingStatus.HOLD } }),
      db.booking.findFirst({
        where: { status: BookingStatus.HOLD, holdExpiresAt: { not: null } },
        orderBy: { holdExpiresAt: "asc" },
        select: { holdExpiresAt: true },
      }),
      db.cleaningTask.count({ where: { status: CleaningStatus.PHOTOS_SUBMITTED } }),
      db.cleaningTask.findMany({
        where: { status: CleaningStatus.PHOTOS_SUBMITTED },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          photoUrls: true,
          createdAt: true,
          villa: { select: { name: true } },
        },
      }),
    ]);

  const toItem = (b: (typeof checkins)[number]): TodayBookingItem => ({
    id: b.id,
    villaName: b.villa.name,
    guestName: b.guestName,
    nights: b.nights,
    status: b.status,
  });

  return {
    todayLabel: todayStr.replaceAll("-", "."),
    checkinToday: checkins.map(toItem),
    checkoutToday: checkouts.map(toItem),
    holdCount,
    nextHoldExpiryHours: nextHold?.holdExpiresAt
      ? hoursUntil(now, nextHold.holdExpiresAt)
      : null,
    cleaningPendingCount,
    cleaningPending: cleaningPendingRows.map((c) => ({
      id: c.id,
      villaName: c.villa.name,
      photoCount: c.photoUrls.length,
      submittedDate: vnDateLabel(c.createdAt), // VN 표시 규약 (QA D-3)
    })),
  };
}

export interface ActivityFeedItem {
  id: string;
  labelKey: string;
  dot: FeedDot;
  /** 상세 한 줄 — 빌라·고객·기간만 (여권·금액 미포함) */
  detail: string;
  at: Date;
}

/** 최근 활동 피드 — AuditLog 최신순. 상세 문구는 관련 엔티티 이름만 합성 */
export async function loadActivityFeed(
  db: PrismaClient,
  take = 8
): Promise<ActivityFeedItem[]> {
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, entity: true, action: true, changes: true, entityId: true, createdAt: true },
  });

  // 엔티티별 이름 일괄 조회
  const ids = (entity: string) =>
    logs.filter((l) => l.entity === entity).map((l) => l.entityId);
  const [bookings, cleanings, proposals, villas] = await Promise.all([
    db.booking.findMany({
      where: { id: { in: ids("Booking") } },
      select: {
        id: true,
        guestName: true,
        checkIn: true,
        checkOut: true,
        villa: { select: { name: true } },
      },
    }),
    db.cleaningTask.findMany({
      where: { id: { in: ids("CleaningTask") } },
      select: { id: true, villa: { select: { name: true } } },
    }),
    db.proposal.findMany({
      where: { id: { in: ids("Proposal") } },
      select: { id: true, clientName: true },
    }),
    db.villa.findMany({
      where: { id: { in: ids("Villa") } },
      select: { id: true, name: true },
    }),
  ]);
  const bookingMap = new Map(bookings.map((b) => [b.id, b]));
  const cleaningMap = new Map(cleanings.map((c) => [c.id, c]));
  const proposalMap = new Map(proposals.map((p) => [p.id, p]));
  const villaMap = new Map(villas.map((v) => [v.id, v]));

  const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

  return logs.map((log) => {
    const kind = feedEntryFor(log);
    let detail = "";
    if (log.entity === "Booking") {
      const b = bookingMap.get(log.entityId);
      if (b) detail = `${b.villa.name} — ${b.guestName} (${md(b.checkIn)}~${md(b.checkOut)})`;
    } else if (log.entity === "CleaningTask") {
      detail = cleaningMap.get(log.entityId)?.villa.name ?? "";
    } else if (log.entity === "Proposal") {
      detail = proposalMap.get(log.entityId)?.clientName ?? "";
    } else if (log.entity === "Villa") {
      detail = villaMap.get(log.entityId)?.name ?? "";
    }
    return { id: log.id, labelKey: kind.labelKey, dot: kind.dot, detail, at: log.createdAt };
  });
}
