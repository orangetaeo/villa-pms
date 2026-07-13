// ADR-0040 — dispatchOne 그룹 발송 분기 (lib/zalo dispatchPendingNotifications)
//   그룹 행(groupThreadId)은 user.zaloUserId 없이도 발송되며 NO_ZALO_LINK가 적용되지 않는다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationType, NotificationStatus } from "@prisma/client";

const h = vi.hoisted(() => ({
  sendBotGroupMessage: vi.fn(),
  sendBotMessage: vi.fn(),
  sendBotMessageWithAttachments: vi.fn(),
  getSystemBotOwnerId: vi.fn(),
  notificationFindMany: vi.fn(),
  notificationUpdate: vi.fn(async (_args: unknown) => ({})),
  convFindUnique: vi.fn(),
  convUpdate: vi.fn(async (_args: unknown) => ({})),
  msgCreate: vi.fn(async (_args: unknown) => ({})),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findMany: h.notificationFindMany, update: h.notificationUpdate },
    zaloConversation: { findUnique: h.convFindUnique, update: h.convUpdate },
    zaloMessage: { create: h.msgCreate },
  },
}));

vi.mock("@/lib/zalo-runtime", () => ({
  sendBotGroupMessage: h.sendBotGroupMessage,
  sendBotMessage: h.sendBotMessage,
  sendBotMessageWithAttachments: h.sendBotMessageWithAttachments,
  ERROR_BOT_NOT_CONNECTED: "BOT_NOT_CONNECTED",
}));

vi.mock("@/lib/zalo-credentials", () => ({
  getSystemBotOwnerId: () => h.getSystemBotOwnerId(),
}));

import { dispatchPendingNotifications } from "@/lib/zalo";

function groupNotif(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    type: NotificationType.VILLA_PENDING_REVIEW,
    status: NotificationStatus.PENDING,
    channel: "ZALO",
    payload: { villaName: "쏘나씨 V12", supplierName: "Tyy", resubmitted: false },
    error: null,
    groupThreadId: "grp-1",
    user: { zaloUserId: null }, // ★ 소유자 미연결이어도 그룹 발송돼야 함
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getSystemBotOwnerId.mockResolvedValue("owner-1");
  h.convFindUnique.mockResolvedValue({ id: "conv-1" });
});

describe("dispatchOne 그룹 분기", () => {
  it("groupThreadId 있으면 zaloUserId 없이도 그룹 발송(NO_ZALO_LINK 미적용) + SENT + 미러", async () => {
    h.notificationFindMany.mockResolvedValue([groupNotif()]);
    h.sendBotGroupMessage.mockResolvedValue({ ok: true, messageId: "m1" });

    const summary = await dispatchPendingNotifications();

    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(0);
    // 그룹 발송 경로 사용 (개별 DM 아님)
    expect(h.sendBotGroupMessage).toHaveBeenCalledWith("grp-1", expect.stringContaining("쏘나씨 V12"));
    expect(h.sendBotMessage).not.toHaveBeenCalled();
    // NO_ZALO_LINK로 실패 처리되지 않음
    const updateData = h.notificationUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateData.data.status).toBe(NotificationStatus.SENT);
    expect(updateData.data.error).not.toBe("NO_ZALO_LINK");
    // 미러 — GROUP 대화(zaloUserId 슬롯=grp-1)로 findUnique
    expect(h.convFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerAdminId_zaloUserId: { ownerAdminId: "owner-1", zaloUserId: "grp-1" } },
      })
    );
    expect(h.msgCreate).toHaveBeenCalledTimes(1);
  });

  it("BOT_NOT_CONNECTED → attempt 미증가(payload 미갱신) 재시도 유지", async () => {
    h.notificationFindMany.mockResolvedValue([groupNotif()]);
    h.sendBotGroupMessage.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });

    const summary = await dispatchPendingNotifications();

    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(0);
    const updateData = h.notificationUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateData.data.status).toBe(NotificationStatus.FAILED);
    expect(updateData.data.error).toBe("BOT_NOT_CONNECTED");
    // attempt 증가(payload 재작성) 하지 않음
    expect(updateData.data.payload).toBeUndefined();
  });

  it("일반 발송 실패 → attempt+1(payload 갱신) 후 FAILED", async () => {
    h.notificationFindMany.mockResolvedValue([groupNotif()]);
    h.sendBotGroupMessage.mockResolvedValue({ ok: false, error: "TIMEOUT" });

    const summary = await dispatchPendingNotifications();

    expect(summary.failed).toBe(1);
    const updateData = h.notificationUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateData.data.status).toBe(NotificationStatus.FAILED);
    expect(updateData.data.error).toBe("TIMEOUT");
    // payload에 _attempt 기록됨
    expect((updateData.data.payload as Record<string, unknown>)._attempt).toBe(1);
  });

  it("시스템봇 소유자 미상 → 미러 생략(mirrorSkipped) but 발송(SENT) 유효", async () => {
    h.notificationFindMany.mockResolvedValue([groupNotif()]);
    h.sendBotGroupMessage.mockResolvedValue({ ok: true, messageId: "m1" });
    h.getSystemBotOwnerId.mockResolvedValue(null);

    const summary = await dispatchPendingNotifications();

    expect(summary.sent).toBe(1);
    expect(summary.mirrorSkipped).toBe(1);
    expect(h.msgCreate).not.toHaveBeenCalled();
  });
});
