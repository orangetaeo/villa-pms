// [QA — ADR-0007 독립 검증] dispatchOne 시스템 발송 + 미러 복합키 + 재시도 분류.
// 검증 요청 A(실패 케이스: BOT_NOT_CONNECTED 무증가·SEND_ERROR 재시도·미러 복합키)에 대응.
// 기존 회귀 테스트가 dispatchOne/isRetryableFailure를 전혀 다루지 않아 신규 작성(공백 메움).
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── zalo-runtime mock — sendBotMessage 결과를 시나리오별로 주입 ──
const mockSendBot = vi.fn();
vi.mock("@/lib/zalo-runtime", () => ({
  sendBotMessage: (...a: unknown[]) => mockSendBot(...a),
  ERROR_BOT_NOT_CONNECTED: "BOT_NOT_CONNECTED",
}));

// ── 시스템봇 소유자(미러 귀속 대상) ──
const mockGetSysOwner = vi.fn();
vi.mock("@/lib/zalo-credentials", () => ({
  getSystemBotOwnerId: (...a: unknown[]) => mockGetSysOwner(...a),
}));

// ── prisma mock — Notification.update / ZaloConversation.findUnique / ZaloMessage.create ──
const notifUpdate = vi.fn();
const notifFindMany = vi.fn();
const convFindUnique = vi.fn();
const convUpdate = vi.fn();
const msgCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      update: (...a: unknown[]) => notifUpdate(...a),
      findMany: (...a: unknown[]) => notifFindMany(...a),
    },
    zaloConversation: {
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    zaloMessage: { create: (...a: unknown[]) => msgCreate(...a) },
  },
}));

import {
  isRetryableFailure,
  getAttemptCount,
  withAttempt,
  dispatchPendingNotifications,
  MAX_SEND_ATTEMPTS,
  ERROR_NO_ZALO_LINK,
  ERROR_BOT_NOT_CONNECTED,
} from "@/lib/zalo";
import { NotificationStatus, NotificationType } from "@prisma/client";

function makeNotif(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    userId: "sup1",
    type: NotificationType.BOOKING_HOLD,
    channel: "ZALO",
    status: NotificationStatus.PENDING,
    error: null,
    payload: { villaName: "Sea Villa", checkIn: "2026-07-01", checkOut: "2026-07-03" },
    sentAt: null,
    createdAt: new Date("2026-06-16T00:00:00Z"),
    user: { zaloUserId: "sup-zalo-1" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifUpdate.mockResolvedValue({});
  convUpdate.mockResolvedValue({});
  msgCreate.mockResolvedValue({ id: "mir1" });
  mockGetSysOwner.mockResolvedValue("theo");
  convFindUnique.mockResolvedValue({ id: "conv-theo-sup1" });
});

// ===================== 재시도 분류 (순수 함수) — Item A(a)(b) =====================
describe("isRetryableFailure — 봇 미연결/타임아웃 분류", () => {
  it("BOT_NOT_CONNECTED는 attempt와 무관하게 항상 재시도 대상 (봇 재로그인 후 자동 회복)", () => {
    expect(isRetryableFailure(ERROR_BOT_NOT_CONNECTED, 0)).toBe(true);
    expect(isRetryableFailure(ERROR_BOT_NOT_CONNECTED, 99)).toBe(true);
  });

  it("NO_ZALO_LINK는 영구 실패 — 재시도 안 함", () => {
    expect(isRetryableFailure(ERROR_NO_ZALO_LINK, 0)).toBe(false);
  });

  it("SEND_ERROR(타임아웃 등)는 3회 미만일 때만 재시도", () => {
    expect(isRetryableFailure("SEND_ERROR: timeout", 0)).toBe(true);
    expect(isRetryableFailure("SEND_ERROR: timeout", MAX_SEND_ATTEMPTS - 1)).toBe(true);
    expect(isRetryableFailure("SEND_ERROR: timeout", MAX_SEND_ATTEMPTS)).toBe(false);
  });

  it("getAttemptCount/withAttempt 라운드트립", () => {
    expect(getAttemptCount({ _attempt: 2 })).toBe(2);
    expect(getAttemptCount({})).toBe(0);
    expect(getAttemptCount(null)).toBe(0);
    const bumped = withAttempt({ x: 1 }, 3) as Record<string, unknown>;
    expect(bumped._attempt).toBe(3);
    expect(bumped.x).toBe(1);
  });
});

// ===================== dispatchOne 실패 케이스 — Item A =====================
describe("dispatchOne — 발송 실패 시 FAILED 기록 + 재시도 판정", () => {
  it("봇 미연결: FAILED + error=BOT_NOT_CONNECTED, attempt 미증가(payload 무변경), 크래시 없음", async () => {
    notifFindMany.mockResolvedValue([makeNotif({ payload: { _attempt: 0, villaName: "V" } })]);
    mockSendBot.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });

    const summary = await dispatchPendingNotifications();
    expect(summary.failed).toBe(1);

    const upd = notifUpdate.mock.calls.find((c) => c[0].data.status === "FAILED");
    expect(upd).toBeTruthy();
    expect(upd![0].data.error).toBe("BOT_NOT_CONNECTED");
    // attempt 미증가 — payload 갱신 키가 없어야 함 (withAttempt 미호출)
    expect(upd![0].data).not.toHaveProperty("payload");
    expect(msgCreate).not.toHaveBeenCalled(); // 미러 없음
  });

  it("타임아웃(SEND_ERROR): FAILED + attempt+1로 payload 갱신", async () => {
    notifFindMany.mockResolvedValue([makeNotif({ payload: { _attempt: 1, villaName: "V" } })]);
    mockSendBot.mockResolvedValue({ ok: false, error: "SEND_ERROR: timeout" });

    const summary = await dispatchPendingNotifications();
    expect(summary.failed).toBe(1);

    const upd = notifUpdate.mock.calls.find((c) => c[0].data.status === "FAILED");
    expect(upd![0].data.error).toBe("SEND_ERROR: timeout");
    expect((upd![0].data.payload as Record<string, unknown>)._attempt).toBe(2); // 1→2
  });

  it("사용자 Zalo 미연결: NO_ZALO_LINK 영구 실패 (발송 시도 안 함)", async () => {
    notifFindMany.mockResolvedValue([makeNotif({ user: { zaloUserId: null } })]);
    const summary = await dispatchPendingNotifications();
    expect(summary.failed).toBe(1);
    expect(mockSendBot).not.toHaveBeenCalled();
    const upd = notifUpdate.mock.calls.find((c) => c[0].data.error === ERROR_NO_ZALO_LINK);
    expect(upd).toBeTruthy();
  });

  it("3회 초과 SEND_ERROR FAILED는 후보에서 skip (재발송 안 함)", async () => {
    notifFindMany.mockResolvedValue([
      makeNotif({
        status: NotificationStatus.FAILED,
        error: "SEND_ERROR: timeout",
        payload: { _attempt: MAX_SEND_ATTEMPTS, villaName: "V" },
      }),
    ]);
    const summary = await dispatchPendingNotifications();
    expect(summary.skipped).toBe(1);
    expect(mockSendBot).not.toHaveBeenCalled();
  });
});

// ===================== dispatchOne 미러 복합키 — Item B (시스템봇 소유자 귀속) =====================
describe("dispatchOne — 성공 시 미러는 시스템봇 소유자(테오)의 복합키 대화에만 기록", () => {
  it("미러 findUnique는 ownerAdminId_zaloUserId 복합키 (테오 귀속) — 타 관리자 대화 미기록", async () => {
    notifFindMany.mockResolvedValue([makeNotif()]);
    mockSendBot.mockResolvedValue({ ok: true, messageId: "srv-1" });

    const summary = await dispatchPendingNotifications();
    expect(summary.sent).toBe(1);

    expect(convFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerAdminId_zaloUserId: { ownerAdminId: "theo", zaloUserId: "sup-zalo-1" },
        },
      })
    );
    // 미러 메시지는 SYSTEM·OUTBOUND
    const mir = msgCreate.mock.calls[0]![0].data;
    expect(mir.source).toBe("SYSTEM");
    expect(mir.direction).toBe("OUTBOUND");
  });

  it("시스템봇 소유자 미상(미연결) → 미러 생략, 발송(SENT)은 유효", async () => {
    mockGetSysOwner.mockResolvedValue(null);
    notifFindMany.mockResolvedValue([makeNotif()]);
    mockSendBot.mockResolvedValue({ ok: true, messageId: "srv-1" });

    const summary = await dispatchPendingNotifications();
    expect(summary.sent).toBe(1);
    expect(summary.mirrorSkipped).toBe(1);
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it("소유자 있으나 해당 대화 없음 → 미러 생략(mirrorSkipped), SENT 유효", async () => {
    convFindUnique.mockResolvedValue(null);
    notifFindMany.mockResolvedValue([makeNotif()]);
    mockSendBot.mockResolvedValue({ ok: true, messageId: "srv-1" });

    const summary = await dispatchPendingNotifications();
    expect(summary.sent).toBe(1);
    expect(summary.mirrorSkipped).toBe(1);
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it("본문에 마진·판매가·KRW 미포함 (시스템 발송 빌더는 화이트리스트만)", async () => {
    // payload에 판매가·마진이 섞여 들어와도 본문에 노출 0 (빌더가 안 읽음)
    notifFindMany.mockResolvedValue([
      makeNotif({
        payload: {
          villaName: "Sea Villa",
          checkIn: "2026-07-01",
          checkOut: "2026-07-03",
          salePriceKrw: 999999,
          marginVnd: "5000000",
        },
      }),
    ]);
    mockSendBot.mockResolvedValue({ ok: true, messageId: "srv-1" });
    await dispatchPendingNotifications();
    const sentText = mockSendBot.mock.calls[0]![1] as string;
    expect(sentText).not.toMatch(/999999|5000000|salePrice|margin|KRW|krw/i);
    // 미러 본문도 동일
    const mir = msgCreate.mock.calls[0]![0].data;
    expect(JSON.stringify(mir.text)).not.toMatch(/999999|5000000|salePrice|margin/i);
  });
});
