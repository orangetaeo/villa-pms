// Zalo 리스너 헬스 워치독 — 판정 순수 함수 + 1회 점검 경보 배선 (계약 zalo-health-alert)
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAccountFindMany = vi.fn();
const mockUserFindMany = vi.fn();
// 쿨다운 영속화(T-zalo-health-db-cooldown) — AppSetting 마지막 경보 시각
const mockSettingFindUnique = vi.fn();
const mockSettingUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloAccount: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
    user: { findMany: (...a: unknown[]) => mockUserFindMany(...a) },
    appSetting: {
      findUnique: (...a: unknown[]) => mockSettingFindUnique(...a),
      upsert: (...a: unknown[]) => mockSettingUpsert(...a),
    },
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
const mockReconnect = vi.fn();
vi.mock("@/lib/zalo-runtime", () => ({
  getSystemBotStatus: (...a: unknown[]) => mockSystemStatus(...a),
  getStatusForAdmin: (...a: unknown[]) => mockAdminStatus(...a),
  reconnectAccountForHealth: (...a: unknown[]) => mockReconnect(...a),
}));

import {
  nextHealthState,
  nextReconnectState,
  runHealthCheckOnce,
  RECONNECT_BACKOFF_MS,
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
  // 기본: DB에 마지막 경보 기록 없음(영속 쿨다운 미적용) — 기존 케이스 동작 보존
  mockSettingFindUnique.mockResolvedValue(null);
  mockSettingUpsert.mockResolvedValue({});
  // 기본: 자동 재접속은 실패(=기존 경보 경로 그대로 검증). 성공 케이스는 개별 테스트에서 덮어쓴다.
  mockReconnect.mockResolvedValue("FAILED");
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

describe("nextReconnectState — 자동 재접속 백오프 게이트", () => {
  const fresh: HealthState = { unhealthyStreak: 0, lastAlertAt: null };

  it("첫 감지에는 즉시 시도 + 다음 시도 시각 예약", () => {
    const r = nextReconnectState(fresh, 1_000);
    expect(r.attempt).toBe(true);
    expect(r.state.reconnectAttempts).toBe(1);
    expect(r.state.nextReconnectAt).toBe(1_000 + RECONNECT_BACKOFF_MS[0]);
  });

  it("예약 시각 전에는 시도하지 않는다", () => {
    const s = nextReconnectState(fresh, 1_000).state;
    const r = nextReconnectState(s, 1_000 + 60_000);
    expect(r.attempt).toBe(false);
    expect(r.state.reconnectAttempts).toBe(1); // 증가 없음
  });

  it("실패가 이어지면 간격이 길어지고 상한(마지막 값)에서 멈춘다", () => {
    let s: HealthState = fresh;
    let now = 0;
    const waits: number[] = [];
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length + 3; i++) {
      const r = nextReconnectState(s, now);
      expect(r.attempt).toBe(true);
      waits.push((r.state.nextReconnectAt as number) - now);
      s = r.state;
      now = r.state.nextReconnectAt as number;
    }
    expect(waits.slice(0, RECONNECT_BACKOFF_MS.length)).toEqual(RECONNECT_BACKOFF_MS);
    expect(waits.at(-1)).toBe(RECONNECT_BACKOFF_MS.at(-1));
  });

  it("복구되면 백오프가 리셋된다(다음 장애에서 다시 즉시 시도)", () => {
    const down = nextReconnectState(fresh, 1_000).state;
    const healed = nextHealthState(down, true, 2_000).state;
    expect(healed.reconnectAttempts).toBe(0);
    expect(healed.nextReconnectAt).toBeNull();
    expect(nextReconnectState(healed, 2_100).attempt).toBe(true);
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

  // ── 쿨다운 영속화 (T-zalo-health-db-cooldown) — 배포 재시작 후 재경보 스팸 방지 ──

  it("재시작 시뮬레이션: 새 Map이어도 DB의 최근 경보(6h 이내)가 있으면 재경보 억제 + 메모리 동기화", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    // 1시간 전 경보가 DB에 기록돼 있음(직전 배포에서 발송)
    mockSettingFindUnique.mockResolvedValue({ value: String(Date.now() - 3600_000) });
    const states = new Map(); // 재시작 = 인메모리 상태 소실
    for (let i = 0; i < 5; i++) await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).not.toHaveBeenCalled();
    expect(mockEnqueueZalo).not.toHaveBeenCalled();
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    // DB 조회는 메모리 동기화 후 반복되지 않음(경보 시도 1회분만)
    expect(mockSettingFindUnique).toHaveBeenCalledTimes(1);
  });

  it("DB 경보가 쿨다운(6h) 경과면 정상 경보 + AppSetting 갱신", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    mockSettingFindUnique.mockResolvedValue({ value: String(Date.now() - 7 * 3600_000) });
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states); // streak 2 — 경보
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2); // 운영자+소유자
    expect(mockSettingUpsert).toHaveBeenCalledTimes(1);
    const upsert = mockSettingUpsert.mock.calls[0][0] as { where: { key: string } };
    expect(upsert.where.key).toBe("zalo-health:last-alert:a2");
  });

  // ── 자가 복구 (T-zalo-health-self-heal) ──

  it("미연결 1회차에 자동 재접속 성공 → 경보 0건(사람 개입 불필요)", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    // 재접속이 살려낸다 → 다음 점검부터 풀이 connected를 보고(실제 동작과 동일)
    mockReconnect.mockImplementation(async () => {
      mockAdminStatus.mockResolvedValue(CONNECTED);
      return "RECONNECTED";
    });
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states);
    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(mockReconnect).toHaveBeenCalledWith("owner1", "ADMIN_PERSONAL");
    expect(mockEnqueueInApp).not.toHaveBeenCalled();
    expect(mockEnqueueZalo).not.toHaveBeenCalled();
  });

  it("플랩(붙자마자 다시 끊김) 계정은 매 회차 재로그인하지 않는다 — 백오프 유지", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN); // 재접속 성공 직후 또 끊긴 상태로 계속 보고
    mockReconnect.mockResolvedValue("RECONNECTED");
    const states = new Map();
    for (let i = 0; i < 6; i++) await runHealthCheckOnce(states);
    expect(mockReconnect).toHaveBeenCalledTimes(1); // 백오프(5분) 안에서는 1회뿐
  });

  it("재접속이 실패하면 기존 경보 규칙 그대로 — 2회 연속에서 경보 1회 + 본문에 재시도 횟수", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2);
    const body = (mockEnqueueInApp.mock.calls[0][0] as { body: string }).body;
    expect(body).toContain("자동 재접속");
  });

  it("백오프 미도래 회차에는 재접속을 호출하지 않는다(로그인 폭주·밴 위험 차단)", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    const states = new Map();
    // 5분 백오프 안에서 10회 점검(실제로는 5분 주기지만 여기선 연속 호출) → 첫 회차 1번만 시도
    for (let i = 0; i < 10; i++) await runHealthCheckOnce(states);
    expect(mockReconnect).toHaveBeenCalledTimes(1);
  });

  it("자동 재접속이 throw해도 점검은 계속되고 경보 경로는 살아있다", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    mockReconnect.mockRejectedValue(new Error("login boom"));
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2); // 경보는 정상 발송
  });

  it("경보 후 복구되면 인앱 복구 알림 1회 — 이후 반복 점검엔 추가 알림 없음", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states); // 경보(수신자 2명)
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2);
    // 복구
    mockAdminStatus.mockResolvedValue(CONNECTED);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(4); // +복구 알림 2건
    const last = mockEnqueueInApp.mock.calls[3][0] as { type: string; title: string };
    expect(last.type).toBe("ZALO_LISTENER_RECOVERED");
    expect(last.title).toContain("Jini");
    // 계속 연결 상태 — 추가 알림 없음
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(4);
  });

  it("경보 없이 자가복구된 구간은 복구 알림도 보내지 않는다(소음 0)", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    mockReconnect.mockResolvedValue("RECONNECTED");
    const states = new Map();
    await runHealthCheckOnce(states);
    mockAdminStatus.mockResolvedValue(CONNECTED);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).not.toHaveBeenCalled();
  });

  it("AppSetting 읽기 실패는 fail-open — 경보는 나간다(감시 공백 방지)", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "a2", kind: "ADMIN_PERSONAL", displayName: "Jini", userId: "owner1" },
    ]);
    mockAdminStatus.mockResolvedValue(DOWN);
    mockSettingFindUnique.mockRejectedValue(new Error("db read fail"));
    const states = new Map();
    await runHealthCheckOnce(states);
    await runHealthCheckOnce(states);
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(2);
  });
});
