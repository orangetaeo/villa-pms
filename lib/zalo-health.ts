// lib/zalo-health.ts — Zalo 리스너 헬스 워치독 (계약 zalo-health-alert)
//
// 배경: 배포 재시작·credential 만료로 zca-js 리스너가 끊기면 해당 계정의 수신이 조용히 멈춘다
//   (실사례: 개인계정 재로그인 실패가 2주간 무감지). security-alerts cron은 SecurityEvent만 보므로
//   리스너 자체를 감시하는 장치가 없었다.
//
// 설계:
// - 리스너 풀은 웹 프로세스 메모리에 있으므로 Railway cron 없이 **인프로세스 setInterval(5분)**로 감시
//   (instrumentation → startZaloHealthWatchdog, globalThis 싱글턴 — dev HMR·중복 import 안전).
// - 판정: ZaloAccount(isActive, credentials 보유) 각각에 대해 풀 인스턴스 status !== "connected".
// - 오탐 방지: 2회 연속(≈10분) 미연결일 때만 경보(배포 직후 재로그인 시간 허용). 계정별 쿨다운 6시간.
//   상태는 메모리 보관 — 재배포로 리셋되어도 "여전히 미연결이면 부팅 ~10분 뒤 재경보"가 오히려 바람직.
// - 경보 이중 채널: ①인앱(계정 소유자+운영자 전원 — Zalo가 죽어도 전달) ②Zalo 큐(ZALO_LISTENER_DOWN,
//   zaloUserId 연결 운영자 — 시스템봇 자체가 죽었으면 발송 실패 허용, 인앱이 폴백).
// - 누수 0: 경보 본문에 credential·비번 미포함 — 계정 표시명·경과·lastError(비민감 상태 문구)만.
import { NotificationType, ZaloAccountKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OPERATOR_ROLES } from "@/lib/permissions";
import { enqueueNotification } from "@/lib/zalo";
import { enqueueInAppNotification } from "@/lib/inapp-notification";
import { getSystemBotStatus, getStatusForAdmin, type BotStatus } from "@/lib/zalo-runtime";

// ── 판정 파라미터 (테스트에서 주입 가능) ──
export const CHECK_INTERVAL_MS = 5 * 60_000; // 5분 주기
export const ALERT_MIN_STREAK = 2; // 2회 연속(≈10분) 미연결일 때만 경보
export const ALERT_COOLDOWN_MS = 6 * 60 * 60_000; // 계정별 재경보 쿨다운 6시간

/** 계정별 감시 상태 — 메모리 보관(재배포 리셋 허용). */
export interface HealthState {
  unhealthyStreak: number;
  lastAlertAt: number | null; // epoch ms
}

/**
 * 순수 판정 — 이번 체크 결과(healthy)로 상태를 전이하고 경보 여부를 반환.
 * - 연결됨: streak 리셋(쿨다운은 유지 — 플랩 시 재경보 억제).
 * - 미연결: streak+1. streak ≥ minStreak && 쿨다운 경과 → alert:true + lastAlertAt 갱신.
 */
export function nextHealthState(
  state: HealthState,
  healthy: boolean,
  now: number,
  opts: { minStreak?: number; cooldownMs?: number } = {}
): { state: HealthState; alert: boolean } {
  const minStreak = opts.minStreak ?? ALERT_MIN_STREAK;
  const cooldownMs = opts.cooldownMs ?? ALERT_COOLDOWN_MS;
  if (healthy) {
    return { state: { unhealthyStreak: 0, lastAlertAt: state.lastAlertAt }, alert: false };
  }
  const streak = state.unhealthyStreak + 1;
  const cooled = state.lastAlertAt === null || now - state.lastAlertAt >= cooldownMs;
  if (streak >= minStreak && cooled) {
    return { state: { unhealthyStreak: streak, lastAlertAt: now }, alert: true };
  }
  return { state: { unhealthyStreak: streak, lastAlertAt: state.lastAlertAt }, alert: false };
}

// ── 워치독 본체 ──

// globalThis 캐시 — realtime-bus 패턴. dev HMR·중복 import에도 인터벌 1개만.
const globalForHealth = globalThis as unknown as {
  __villaZaloHealth?: { timer: ReturnType<typeof setInterval>; states: Map<string, HealthState> };
};

/** 계정 1건의 현재 풀 상태 조회 — SYSTEM_BOT은 "__system__", 개인계정은 소유자 키(통합 모드 포함). */
async function statusForAccount(account: {
  kind: ZaloAccountKind;
  userId: string;
}): Promise<BotStatus> {
  return account.kind === ZaloAccountKind.SYSTEM_BOT
    ? getSystemBotStatus()
    : getStatusForAdmin(account.userId);
}

/** 미연결 경보 발송 — 인앱(소유자+운영자 전원) + Zalo 큐(연결된 운영자). best-effort. */
async function sendDownAlert(params: {
  accountId: string;
  accountName: string;
  ownerUserId: string;
  downMinutes: number;
  lastError: string | null;
}): Promise<void> {
  const title = `📵 Zalo 수신 연결 끊김: ${params.accountName}`;
  const body = `${params.downMinutes}분째 미연결 — 이 계정의 수신 메시지가 도착하지 않습니다. QR 재로그인이 필요합니다.`;

  // ① 인앱 — 운영자 전원 + 계정 소유자(운영자 목록에 없으면 추가). Zalo 불능 시에도 전달되는 1차 채널.
  const operators = await prisma.user.findMany({
    where: { role: { in: [...OPERATOR_ROLES] }, isActive: true },
    select: { id: true },
  });
  const recipientIds = new Set<string>(operators.map((o) => o.id));
  recipientIds.add(params.ownerUserId);
  for (const userId of recipientIds) {
    try {
      await enqueueInAppNotification({
        userId,
        type: "ZALO_LISTENER_DOWN",
        title,
        body,
        href: "/zalo-connect",
      });
    } catch (err) {
      console.error(
        "[zalo-health] 인앱 경보 적재 실패:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // ② Zalo 큐 — zaloUserId 연결된 운영자에게. 시스템봇이 죽은 경우 발송은 실패하지만 큐는 보존(복구 후 발송).
  try {
    const zaloOperators = await prisma.user.findMany({
      where: {
        role: { in: [...OPERATOR_ROLES] },
        isActive: true,
        zaloUserId: { not: null },
      },
      select: { id: true },
    });
    for (const op of zaloOperators) {
      await enqueueNotification({
        userId: op.id,
        type: NotificationType.ZALO_LISTENER_DOWN,
        payload: {
          accountId: params.accountId,
          accountName: params.accountName,
          downMinutes: params.downMinutes,
          lastError: params.lastError ?? "",
        },
      });
    }
  } catch (err) {
    console.error(
      "[zalo-health] Zalo 경보 큐 적재 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** 1회 점검 — 활성 계정 전체의 풀 상태를 보고 필요 시 경보. 전체 try/catch(리스너·서버 무영향). */
export async function runHealthCheckOnce(states: Map<string, HealthState>): Promise<void> {
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { isActive: true, credentials: { not: null } },
      select: { id: true, kind: true, displayName: true, userId: true },
    });
    for (const account of accounts) {
      const status = await statusForAccount(account);
      const prev = states.get(account.id) ?? { unhealthyStreak: 0, lastAlertAt: null };
      const { state, alert } = nextHealthState(prev, status.connected, Date.now());
      states.set(account.id, state);
      if (alert) {
        await sendDownAlert({
          accountId: account.id,
          accountName: account.displayName ?? account.kind,
          ownerUserId: account.userId,
          downMinutes: Math.round((state.unhealthyStreak * CHECK_INTERVAL_MS) / 60_000),
          lastError: status.lastError,
        });
        console.warn(
          `[zalo-health] 리스너 미연결 경보 발송: ${account.displayName ?? account.id} (streak ${state.unhealthyStreak})`
        );
      }
    }
  } catch (err) {
    console.error(
      "[zalo-health] 헬스 점검 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * 워치독 시작 — instrumentation(Node 런타임)에서 1회 호출. 중복 호출·HMR 안전(싱글턴).
 * 첫 점검도 인터벌 주기 후 실행 — 부팅 직후 재로그인 시간을 그레이스로 확보.
 */
export function startZaloHealthWatchdog(): void {
  // 비프로덕션 가드(QA #1) — 로컬 서버도 라이브 DB를 쓰므로, 로컬 기동(풀이 비어 전 계정 미연결로
  // 보임)이 라이브 운영자에게 거짓 경보를 적재하지 않게 Railway 런타임에서만 시작.
  // 로컬 검증이 필요하면 ZALO_HEALTH_WATCHDOG=1 로 명시 opt-in.
  const enabled =
    !!process.env.RAILWAY_ENVIRONMENT_NAME ||
    !!process.env.RAILWAY_ENVIRONMENT ||
    process.env.ZALO_HEALTH_WATCHDOG === "1";
  if (!enabled) {
    console.log("[zalo-health] 비프로덕션 환경 — 워치독 비활성(ZALO_HEALTH_WATCHDOG=1로 opt-in)");
    return;
  }
  if (globalForHealth.__villaZaloHealth) return;
  const states = new Map<string, HealthState>();
  const timer = setInterval(() => {
    void runHealthCheckOnce(states);
  }, CHECK_INTERVAL_MS);
  // Node 프로세스 종료를 막지 않도록(테스트·graceful shutdown) unref.
  timer.unref?.();
  globalForHealth.__villaZaloHealth = { timer, states };
  console.log("[zalo-health] 리스너 헬스 워치독 시작 (5분 주기)");
}
