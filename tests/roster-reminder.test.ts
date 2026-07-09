import { beforeEach, describe, expect, it, vi } from "vitest";

// T-roster-reminder-cron — D-3 명단 미입력 리마인더 로직.
// 대상 조회(D-3·CONFIRMED·roster null)와 운영자 fan-out·마진 미포함 payload 검증.
const mockEnqueue = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/zalo", () => ({
  enqueueNotification: (...a: unknown[]) => mockEnqueue(...a),
}));

const mockBooking = { findMany: vi.fn() };
const mockUser = { findMany: vi.fn() };
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: (...a: unknown[]) => mockBooking.findMany(...a) },
    user: { findMany: (...a: unknown[]) => mockUser.findMany(...a) },
  },
}));

import { prisma } from "@/lib/prisma";
import { findRosterReminderTargets, runRosterReminders } from "@/lib/roster-reminder";

// VN 타임존(UTC+7) 기준 "오늘" → +3일. now=2026-07-07T03:00Z → VN 2026-07-07 → 대상 checkIn 2026-07-10.
const NOW = new Date("2026-07-07T03:00:00Z");
const EXPECTED_TARGET_ISO = "2026-07-10";

const aBooking = {
  id: "bk1",
  checkIn: new Date("2026-07-10T00:00:00Z"),
  guestName: "김학태",
  guestCount: 4,
  agencyName: null,
  villa: { name: "쏘나씨 V11" },
  partner: { name: "하나투어", contactPhone: "0212345678" },
  proposalItem: { proposal: { token: "tok1" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBooking.findMany.mockResolvedValue([aBooking]);
  mockUser.findMany.mockResolvedValue([{ id: "op1" }, { id: "op2" }]);
});

describe("findRosterReminderTargets — 대상 필터", () => {
  it("D-3·CONFIRMED·guestRoster null 조건으로 조회", async () => {
    await findRosterReminderTargets(prisma as never, NOW);
    const where = mockBooking.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("CONFIRMED");
    expect(where.guestRoster).toBeNull();
    // checkIn 은 VN 오늘 + 3일 (UTC 자정 Date)
    expect(where.checkIn.toISOString().slice(0, 10)).toBe(EXPECTED_TARGET_ISO);
  });

  it("매핑 결과에 token 포함 (마진/가격 필드는 select 안 함)", async () => {
    const targets = await findRosterReminderTargets(prisma as never, NOW);
    expect(targets[0]).toEqual({
      bookingId: "bk1",
      villaName: "쏘나씨 V11",
      checkIn: aBooking.checkIn,
      guestName: "김학태",
      guestCount: 4,
      token: "tok1",
      partnerName: "하나투어",
      partnerPhone: "0212345678",
    });
  });

  it("파트너 없으면 agencyName 폴백, 둘 다 없으면 null", async () => {
    mockBooking.findMany.mockResolvedValue([
      { ...aBooking, partner: null, agencyName: "구여행사텍스트" },
    ]);
    const [withAgency] = await findRosterReminderTargets(prisma as never, NOW);
    expect(withAgency.partnerName).toBe("구여행사텍스트");
    expect(withAgency.partnerPhone).toBeNull();
    mockBooking.findMany.mockResolvedValue([{ ...aBooking, partner: null, agencyName: null }]);
    const [direct] = await findRosterReminderTargets(prisma as never, NOW);
    expect(direct.partnerName).toBeNull();
  });
});

describe("runRosterReminders — 운영자 fan-out", () => {
  it("대상 1건 × 운영자 2명 → 알림 2건", async () => {
    const summary = await runRosterReminders(prisma as never, NOW);
    expect(summary.targetCount).toBe(1);
    expect(summary.notificationCount).toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it("운영자 조회는 활성·zaloUserId 연결·운영자 역할만", async () => {
    await runRosterReminders(prisma as never, NOW);
    const where = mockUser.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.zaloUserId).toEqual({ not: null });
    expect(where.role.in).toContain("OWNER");
    expect(where.role.in).toContain("ADMIN");
    expect(where.role.in).not.toContain("SUPPLIER");
  });

  it("enqueue payload는 ROSTER_REMINDER + 마진/판매가 미포함", async () => {
    await runRosterReminders(prisma as never, NOW);
    const arg = mockEnqueue.mock.calls[0][0] as {
      type: string;
      userId: string;
      payload: Record<string, unknown>;
    };
    expect(arg.type).toBe("ROSTER_REMINDER");
    expect(arg.userId).toBe("op1");
    expect(arg.payload).toEqual({
      bookingId: "bk1",
      villaName: "쏘나씨 V11",
      checkIn: "2026-07-10",
      guestName: "김학태",
      guestCount: 4,
      token: "tok1",
      partnerName: "하나투어",
      partnerPhone: "0212345678",
    });
    expect("totalSaleKrw" in arg.payload).toBe(false);
    expect("supplierCostVnd" in arg.payload).toBe(false);
  });

  it("대상 0건이면 운영자 조회·enqueue 없이 종료", async () => {
    mockBooking.findMany.mockResolvedValue([]);
    const summary = await runRosterReminders(prisma as never, NOW);
    expect(summary).toEqual({ targetCount: 0, notificationCount: 0, bookingIds: [] });
    expect(mockUser.findMany).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("운영자 0명(미연결)이면 알림 0건이지만 정상 종료", async () => {
    mockUser.findMany.mockResolvedValue([]);
    const summary = await runRosterReminders(prisma as never, NOW);
    expect(summary.targetCount).toBe(1);
    expect(summary.notificationCount).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
