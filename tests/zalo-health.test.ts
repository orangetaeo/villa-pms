// Zalo 리스너 헬스 워치독 — 판정 순수 함수 + 1회 점검 경보 배선 (계약 zalo-health-alert)
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAccountFindMany = vi.fn();
const mockUserFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloAccount: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
    user: { findMany: (...a: unknown[]) => mockUserFindMany(...a) },
  },
}));

const mockEnqueueZalo = vi.fn();
vi.mock("@/lib/zalo", () => ({
  enqueueNotification: (...a: unknown[]) => mockEnqueueZalo(...a),
}));

const mockEnqueueInApp = vi.fn();
vi.mock("@/lib/inapp-notification", () => ({
  enqueueInAppNotification: (...a: unknown[]) => mockEnqueueInApp(...a),
}));

const mockSystemStatus = vi.fn();
const mockAdminStatus = vi.fn();
vi.mock("@/lib/zalo-runtime", () => ({
  getSystemBotStatus: (...a: unknown[]) => mockSystemStatus(...a),
  getStatusForAdmin: (...a: unknown[]) => mockAdminStatus(...a),
}));

import {
  nextHealthState,
  runHealthCheckOnce,
  type HealthState,
} from "@/lib/zalo-health";

const CONNECTED = { connected: true, status: "connected", displayName: "x", lastConnected: null, lastError: null };
const DOWN = { connected: false, status: "disconnected", displayName: "x", lastConnected: null, lastError: "Đăng nhập thất bại" };

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueueInApp.mockResolvedValue({});
  mockEnqueueZalo.mockResolvedValue({});
  // user.findMany 순서: ①인앱 대상(운영자 전원) ②Zalo 대상(zaloUserId 연결 운영자)
  mockUserFindMany.mockResolvedValue([{ id: "op1" }]);
});

describe("nextHealthState — 판정 순수 함수", () => {
  const fresh: HealthState = { unhealthyStreak: 0, lastAlertAt: null };

  it("1회 미연결(streak 1)로는 경보 없음 — 배포 직후 오탐 방지", () => {
    const r = nextHealthState(fresh, false, 1000);
    expect(r.alert).toBe(false);
    expect(r.state.unhealthyStreak).toBe(1);
  });

  it("2회 연속 미연결 → 경보 1회 + lastAlertAt 기록", () => {
    const s1 = nextHealthState(fresh, false, 1000).state;
    const r2 = nextHealthState(s1, false, 2000);
    expect(r2.alert).toBe(true);
    expect(r2.state.lastAlertAt).toBe(2000);
  });

  it("쿨다운 내 계속 미연결이어도 재경보 없음", () => {
    const alerted: HealthState = { unhealthyStreak: 2, lastAlertAt: 2000 };
    const r = nextHealthState(alerted, false, 2000 + 60_000);
    expect(r.alert).toBe(false);
    expect(r.state.unhealthyStreak).toBe(3);
  });

  it("쿨다운 경과 후 여전히 미연결 → 재경보", () => {
    const alerted: HealthState = { unhealthyStreak: 2, lastAlertAt: 2000 };
    const r = nextHealthState(alerted, false, 2000 + 6 * 3600_000);
    expect(r.alert).toBe(true);
  });

  it("복구(연결) → streak 리셋, 경보 없음. 쿨다운 기록은 유지(플랩 재경보 억제)", () => {
    const alerted: HealthState = { unhealthyStreak: 5, lastAlertAt: 2000 };
    const r = nextHealthState(alerted, true, 9000);
    expect(r.alert).toBe(false);
    expect(r.state.unhealthyStreak).toBe(0);
    expect(r.state.lastAlertAt).toBe(2000);
  });
});

describe("runHealthCheckOnce — 점검·경보 배선", () => {
  it("연결된 계정은 경보 0 (인앱·Zalo 큐 미적재)", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a1", kind: "SYSTEM_BOT", displayName: "Taeo", userId: "u1" },
    ]);
    mockSystemStatus.mockReturnValue(CONNECTED);
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).not.toHaveBeenCalled();
    expect(mockEnqueueZalo).not.toHaveBeenCalled();
  });

  it("개인계정 2회 연속 미연결 → 인앱(운영자+소유자 dedup) + Zalo 큐 적재", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    const states = new Map();
    await runHealthCheckOnce(states); // streak 1 — 무경보
    expect(mockEnqueueInApp).not.toHaveBeenCalled();
    await runHealthCheckOnce(states); // streak 2 — 경보
    // 인앱: 운영자 op1 + 소유자 owner1 = 2건
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2);
    const inAppUserIds = mockEnqueueInApp.mock.calls.map((c) => (c[0] as { userId: string }).userId).sort();
    expect(inAppUserIds).toEqual(["op1", "owner1"]);
    // 인앱 본문에 계정명·재로그인 안내 포함, href=/zalo-connect
    const first = mockEnqueueInApp.mock.calls[0][0] as { title: string; href: string };
    expect(first.title).toContain("Jini");
    expect(first.href).toBe("/zalo-connect");
    // Zalo 큐: 운영자 1건, 타입 ZALO_LISTENER_DOWN, payload에 credential류 없음
    expect(mockEnqueueZalo).toHaveBeenCalledTimes(1);
    const z = mockEnqueueZalo.mock.calls[0][0] as { type: string; payload: Record<string, unknown> };
    expect(z.type).toBe("ZALO_LISTENER_DOWN");
    expect(JSON.stringify(z.payload)).not.toMatch(/credential|password|cookie|imei/i);
  });

  it("경보 후 쿨다운 내 반복 점검 → 재경보 없음(스팸 방지)", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    const states = new Map();
    for (let i = 0; i < 5; i++) await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2); // 최초 경보 1회분(수신자 2명)만
  });

  it("DB 실패는 swallow — throw 없이 종료(리스너·서버 무영향)", async () => {
    mockAccountFindMany.mockRejectedValue(new Error("db down"));
    await expect(runHealthCheckOnce(new Map())).resolves.toBeUndefined();
  });
});
