// ADR-0040 — 운영자 알림 그룹 라우팅 3중 게이트 (lib/operator-notify)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationType } from "@prisma/client";

// enqueueNotification·getSystemBotOwnerId는 전역 prisma를 쓰므로 모킹 (호출 인자만 검증)
const enqueueNotification = vi.fn(async (_params: unknown) => ({}));
vi.mock("@/lib/zalo", () => ({
  enqueueNotification: (params: unknown) => enqueueNotification(params),
}));

const getSystemBotOwnerId = vi.fn(async (): Promise<string | null> => "owner-1");
vi.mock("@/lib/zalo-credentials", () => ({
  getSystemBotOwnerId: () => getSystemBotOwnerId(),
}));

// operator-notify가 db 미주입 시 쓰는 기본 prisma — 여기선 항상 db 주입하므로 빈 객체
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { enqueueOperatorNotification } from "@/lib/operator-notify";

interface MockOpts {
  groupSetting?: { value: string } | null;
  operators?: { id: string }[];
}

function mockDb(opts: MockOpts = {}) {
  const appSettingFindUnique = vi.fn(async () => opts.groupSetting ?? null);
  const userFindMany = vi.fn(async () => opts.operators ?? [{ id: "op-1" }, { id: "op-2" }]);
  const db = {
    appSetting: { findUnique: appSettingFindUnique },
    user: { findMany: userFindMany },
  } as never;
  return { db, appSettingFindUnique, userFindMany };
}

beforeEach(() => {
  enqueueNotification.mockClear();
  getSystemBotOwnerId.mockClear();
  getSystemBotOwnerId.mockResolvedValue("owner-1");
});

describe("enqueueOperatorNotification — 3중 게이트", () => {
  it("게이트 3충족(그룹설정·화이트리스트·소유자) → 그룹 1행(groupThreadId), fan-out 없음", async () => {
    const m = mockDb({ groupSetting: { value: "grp-1" } });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.VILLA_PENDING_REVIEW,
      payload: { villaName: "V" },
    });
    expect(count).toBe(1);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1", groupThreadId: "grp-1" })
    );
    // 그룹 경로면 운영자 목록 조회조차 안 함
    expect(m.userFindMany).not.toHaveBeenCalled();
  });

  it("그룹 미설정 → 운영자 개별 DM fan-out (groupThreadId 없음)", async () => {
    const m = mockDb({ groupSetting: null, operators: [{ id: "op-1" }, { id: "op-2" }] });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.VILLA_PENDING_REVIEW,
      payload: { villaName: "V" },
    });
    expect(count).toBe(2);
    expect(enqueueNotification).toHaveBeenCalledTimes(2);
    for (const call of enqueueNotification.mock.calls) {
      expect((call[0] as Record<string, unknown>).groupThreadId).toBeUndefined();
    }
    expect(getSystemBotOwnerId).not.toHaveBeenCalled();
  });

  it("화이트리스트 밖 타입은 그룹 설정돼 있어도 항상 개별 DM", async () => {
    const m = mockDb({ groupSetting: { value: "grp-1" }, operators: [{ id: "op-1" }] });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.BOOKING_HOLD, // 운영자 그룹 대상 아님
      payload: { villaName: "V" },
    });
    expect(count).toBe(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "op-1" })
    );
    expect((enqueueNotification.mock.calls[0][0] as Record<string, unknown>).groupThreadId).toBeUndefined();
    // 화이트리스트 밖이면 그룹 조회·소유자 조회 없이 바로 fan-out
    expect(m.appSettingFindUnique).not.toHaveBeenCalled();
    expect(getSystemBotOwnerId).not.toHaveBeenCalled();
  });

  it("시스템봇 소유자 미상(미연결) → 그룹 설정돼 있어도 개별 DM 폴백", async () => {
    getSystemBotOwnerId.mockResolvedValue(null);
    const m = mockDb({ groupSetting: { value: "grp-1" }, operators: [{ id: "op-1" }, { id: "op-2" }] });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.GUEST_PAYMENT_NOTICE,
      payload: {},
    });
    expect(count).toBe(2);
    expect(enqueueNotification).toHaveBeenCalledTimes(2);
    expect(m.userFindMany).toHaveBeenCalled();
  });

  it("AppSetting 조회 실패(fail-open) → 개별 DM 폴백", async () => {
    const m = mockDb({ operators: [{ id: "op-1" }] });
    m.appSettingFindUnique.mockRejectedValueOnce(new Error("db down"));
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.ROSTER_REMINDER,
      payload: {},
    });
    expect(count).toBe(1);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
  });

  it("대상 운영자 0명(미연결) → 0건, 예외 없음", async () => {
    const m = mockDb({ groupSetting: null, operators: [] });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.SERVICE_ORDER_REQUESTED,
      payload: {},
    });
    expect(count).toBe(0);
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});
