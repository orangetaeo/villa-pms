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

import {
  enqueueOperatorNotification,
  ZALO_ADMIN_NOTIFY_GROUP_ID_KEY,
  ZALO_OPERATOR_NOTIFY_PAUSED_KEY,
} from "@/lib/operator-notify";

interface MockOpts {
  groupSetting?: { value: string } | null;
  pausedSetting?: { value: string } | null;
  operators?: { id: string }[];
}

function mockDb(opts: MockOpts = {}) {
  // key별 라우팅 — 일시정지 킬스위치가 그룹 조회보다 앞서 별도 키를 읽는다
  const appSettingFindUnique = vi.fn(async (args: { where: { key: string } }) => {
    if (args.where.key === ZALO_OPERATOR_NOTIFY_PAUSED_KEY) return opts.pausedSetting ?? null;
    if (args.where.key === ZALO_ADMIN_NOTIFY_GROUP_ID_KEY) return opts.groupSetting ?? null;
    return null;
  });
  const userFindMany = vi.fn(async () => opts.operators ?? [{ id: "op-1" }, { id: "op-2" }]);
  const db = {
    appSetting: { findUnique: appSettingFindUnique },
    user: { findMany: userFindMany },
  } as never;
  const groupKeyCalled = () =>
    appSettingFindUnique.mock.calls.some((c) => c[0].where.key === ZALO_ADMIN_NOTIFY_GROUP_ID_KEY);
  return { db, appSettingFindUnique, userFindMany, groupKeyCalled };
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
    // (일시정지 킬스위치 키는 최상단에서 조회하지만, 그룹 키는 조회하지 않는다)
    expect(m.groupKeyCalled()).toBe(false);
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

describe("enqueueOperatorNotification — 일시정지 킬스위치", () => {
  it('paused="1" → 0 반환, 그룹 설정돼 있어도 미적재(fan-out·그룹 조회 없음)', async () => {
    const m = mockDb({ pausedSetting: { value: "1" }, groupSetting: { value: "grp-1" } });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.VILLA_PENDING_REVIEW, // 화이트리스트 타입
      payload: { villaName: "V" },
    });
    expect(count).toBe(0);
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(m.groupKeyCalled()).toBe(false); // 그룹 조회조차 안 함
    expect(m.userFindMany).not.toHaveBeenCalled();
    expect(getSystemBotOwnerId).not.toHaveBeenCalled();
  });

  it("paused 값 공백·대문자 변형(' True ') → 0 반환(폴백 타입도 정지)", async () => {
    const m = mockDb({ pausedSetting: { value: " True " }, operators: [{ id: "op-1" }] });
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.BOOKING_HOLD, // 화이트리스트 밖(폴백 경로)도 정지
      payload: {},
    });
    expect(count).toBe(0);
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(m.userFindMany).not.toHaveBeenCalled();
  });

  it('paused="0"·빈 값·키 부재 → 기존 동작(정지 아님)', async () => {
    for (const pausedSetting of [{ value: "0" }, { value: "" }, null]) {
      enqueueNotification.mockClear();
      const m = mockDb({ pausedSetting, operators: [{ id: "op-1" }, { id: "op-2" }] });
      const count = await enqueueOperatorNotification({
        db: m.db,
        type: NotificationType.VILLA_PENDING_REVIEW,
        payload: {},
      });
      expect(count).toBe(2);
      expect(enqueueNotification).toHaveBeenCalledTimes(2);
    }
  });

  it("paused 조회 throw(fail-open) → 기존 동작(알림 계속)", async () => {
    const m = mockDb({ operators: [{ id: "op-1" }] });
    // 첫 findUnique(=paused 키) 호출만 실패 → fail-open으로 알림 계속
    m.appSettingFindUnique.mockRejectedValueOnce(new Error("db down"));
    const count = await enqueueOperatorNotification({
      db: m.db,
      type: NotificationType.ROSTER_REMINDER,
      payload: {},
    });
    expect(count).toBe(1);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
  });
});
