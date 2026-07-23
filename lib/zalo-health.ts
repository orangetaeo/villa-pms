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
//   ★쿨다운은 AppSetting에 영속(T-zalo-health-db-cooldown) — 초기 설계는 "재시작 후 재경보 바람직"이었으나
//   배포가 하루 수 회라 같은 미연결 계정 경보가 배포마다 반복(테오 스팸 보고 2026-07-09). streak만 메모리.
// - 경보 이중 채널: ①인앱(계정 소유자+운영자 전원 — Zalo가 죽어도 전달) ②Zalo 큐(ZALO_LISTENER_DOWN,
//   zaloUserId 연결 운영자 — 시스템봇 자체가 죽었으면 발송 실패 허용, 인앱이 폴백).
// - 누수 0: 경보 본문에 credential·비번 미포함 — 계정 표시명·경과·lastError(비민감 상태 문구)만.
//
// ★자가 복구 (T-zalo-health-self-heal, 2026-07-23 추가):
//   실측 사고 — 개인계정 WebSocket이 code 1006으로 끊긴 뒤 zca-js retryOnClose가 살리지 못해
//   수신이 4시간(03:11~07:07 UTC) 멈췄고, 복구는 무관한 배포의 프로세스 재시작으로 우연히 됐다.
//   워치독이 감지만 하고 복구를 사람에게 미룬 게 원인. 이제 미연결이면 **경보 이전에** 저장된
//   credential로 재접속을 시도한다(reconnectAccountForHealth). 살아나면 경보 자체가 나가지 않고,
//   실패가 이어지면 백오프(5→10→20→40→60분)로 간격을 벌리며 기존 경보 규칙(2회 연속·6h 쿨다운)을 그대로 탄다.
import { NotificationType, ZaloAccountKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OPERATOR_ROLES } from "@/lib/permissions";
import { enqueueNotification } from "@/lib/zalo";
import { enqueueInAppNotification } from "@/lib/inapp-notification";
import {
  getSystemBotStatus,
  getStatusForAdmin,
  reconnectAccountForHealth,
  type BotStatus,
  type HealthReconnectOutcome,
} from "@/lib/zalo-runtime";

// ── 판정 파라미터 (테스트에서 주입 가능) ──
export const CHECK_INTERVAL_MS = 5 * 60_000; // 5분 주기
export const ALERT_MIN_STREAK = 2; // 2회 연속(≈10분) 미연결일 때만 경보
export const ALERT_COOLDOWN_MS = 6 * 60 * 60_000; // 계정별 재경보 쿨다운 6시간

/**
 * 자동 재접속 백오프 (계약 T-zalo-health-self-heal) — 시도 n회차 이후 다음 시도까지의 최소 간격.
 * 첫 감지에는 즉시 1회 시도하고, 실패가 이어지면 간격을 벌린다(로그인 폭주=밴 위험 회피).
 * 마지막 값이 상한 — credential 만료처럼 사람이 QR을 잡아야만 풀리는 상황에서도 1시간에 1회로 수렴.
 */
export const RECONNECT_BACKOFF_MS = [5, 10, 20, 40, 60].map((m) => m * 60_000);

/** 계정별 감시 상태 — 메모리 보관(재배포 리셋 허용). */
export interface HealthState {
  unhealthyStreak: number;
  lastAlertAt: number | null; // epoch ms
  /** 연속 자동 재접속 시도 횟수 — 복구되면 0으로 리셋(백오프 계산용) */
  reconnectAttempts?: number;
  /** 다음 재접속 시도 가능 시각(epoch ms). null=지금 즉시 가능 */
  nextReconnectAt?: number | null;
  /** 이 다운 구간에서 경보를 이미 보냈는가 — 복구 알림을 보낼지 판단(경보 없이 자가복구된 건은 조용히 넘어간다) */
  alerted?: boolean;
}

/**
 * 순수 판정 — 이번 체크 결과(healthy)로 상태를 전이하고 경보 여부를 반환.
 * - 연결됨: streak·재접속 백오프 리셋(쿨다운은 유지 — 플랩 시 재경보 억제).
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
    return {
      state: {
        ...state,
        unhealthyStreak: 0,
        lastAlertAt: state.lastAlertAt,
        reconnectAttempts: 0,
        nextReconnectAt: null,
      },
      alert: false,
    };
  }
  const streak = state.unhealthyStreak + 1;
  const cooled = state.lastAlertAt === null || now - state.lastAlertAt >= cooldownMs;
  if (streak >= minStreak && cooled) {
    return {
      state: { ...state, unhealthyStreak: streak, lastAlertAt: now, alerted: true },
      alert: true,
    };
  }
  return { state: { ...state, unhealthyStreak: streak, lastAlertAt: state.lastAlertAt }, alert: false };
}

/**
 * 순수 판정 — 이번 회차에 자동 재접속을 시도할 차례인가(백오프 게이트).
 * 시도할 차례면 시도 횟수를 올리고 다음 시도 가능 시각을 예약한 state를 함께 돌려준다.
 * ★시도 결과(성공/실패)와 무관하게 백오프를 먼저 예약한다 — 실패 경로에서 예약을 빠뜨리면
 *   5분마다 무제한 재로그인이 되어 밴 위험이 커진다.
 */
export function nextReconnectState(
  state: HealthState,
  now: number,
  backoff: number[] = RECONNECT_BACKOFF_MS
): { state: HealthState; attempt: boolean } {
  const dueAt = state.nextReconnectAt ?? null;
  if (dueAt !== null && now < dueAt) return { state, attempt: false };
  const attempts = state.reconnectAttempts ?? 0;
  const wait = backoff[Math.min(attempts, backoff.length - 1)];
  return {
    state: { ...state, reconnectAttempts: attempts + 1, nextReconnectAt: now + wait },
    attempt: true,
  };
}

// ── 워치독 본체 ──

// globalThis 캐시 — realtime-bus 패턴. dev HMR·중복 import에도 인터벌 1개만.
const globalForHealth = globalThis as unknown as {
  __villaZaloHealth?: { timer: ReturnType<typeof setInterval>; states: Map<string, HealthState> };
};

/** 경보 시각 영속 키 — 배포 재시작에도 쿨다운 유지 (AppSetting key-value 재사용, 스키마 무변경) */
function lastAlertSettingKey(accountId: string): string {
  return `zalo-health:last-alert:${accountId}`;
}

/** DB의 마지막 경보 시각(epoch ms). 미기록·파싱 불가·조회 실패는 null (fail-open — 경보 우선). */
async function readPersistedLastAlert(accountId: string): Promise<number | null> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: lastAlertSettingKey(accountId) },
      select: { value: true },
    });
    if (!row) return null;
    const ts = Number.parseInt(row.value, 10);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

/** 경보 발송 시각 기록 — 실패해도 경보 동작에 영향 없음(다음 재시작 때 한 번 더 올 뿐). */
async function writePersistedLastAlert(accountId: string, ts: number): Promise<void> {
  try {
    const key = lastAlertSettingKey(accountId);
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(ts) },
      update: { value: String(ts) },
    });
  } catch (err) {
    console.error(
      "[zalo-health] 경보 시각 영속화 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** 계정 1건의 현재 풀 상태 조회 — SYSTEM_BOT은 "__system__", 개인계정은 소유자 키(통합 모드 포함). */
async function statusForAccount(account: {
  kind: ZaloAccountKind;
  userId: string;
}): Promise<BotStatus> {
  return account.kind === ZaloAccountKind.SYSTEM_BOT
    ? getSystemBotStatus()
    : getStatusForAdmin(account.userId);
}

/** 경보·복구 알림 수신자 — 활성 운영자 전원 + 계정 소유자(중복 제거). */
async function alertRecipients(ownerUserId: string): Promise<Set<string>> {
  const operators = await prisma.user.findMany({
    where: { role: { in: [...OPERATOR_ROLES] }, isActive: true },
    select: { id: true },
  });
  const ids = new Set<string>(operators.map((o) => o.id));
  ids.add(ownerUserId);
  return ids;
}

/** 미연결 경보 발송 — 인앱(소유자+운영자 전원) + Zalo 큐(연결된 운영자). best-effort. */
async function sendDownAlert(params: {
  accountId: string;
  accountName: string;
  ownerUserId: string;
  downMinutes: number;
  lastError: string | null;
  /** 이 다운 구간에서 자동 재접속을 몇 번 시도했는지 — 사람이 QR을 잡아야 할지 판단 근거 */
  reconnectAttempts: number;
}): Promise<void> {
  const title = `📵 Zalo 수신 연결 끊김: ${params.accountName}`;
  // 자동 재접속을 이미 시도했음을 명시 — "그냥 기다리면 되나"를 매번 묻지 않게(2026-07-23 4시간 공백 교훈).
  const retried =
    params.reconnectAttempts > 0
      ? ` 자동 재접속 ${params.reconnectAttempts}회 실패 —`
      : "";
  const body = `${params.downMinutes}분째 미연결 —${retried} 이 계정의 수신 메시지가 도착하지 않습니다. QR 재로그인이 필요합니다.`;

  // ① 인앱 — 운영자 전원 + 계정 소유자(운영자 목록에 없으면 추가). Zalo 불능 시에도 전달되는 1차 채널.
  const recipientIds = await alertRecipients(params.ownerUserId);
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

/** 복구 알림 — 경보를 보냈던 계정이 다시 연결됐을 때 1회. 인앱만(Zalo 큐 미사용 — 소음 최소화). */
async function sendUpNotice(params: {
  accountName: string;
  ownerUserId: string;
  selfHealed: boolean;
}): Promise<void> {
  const title = `✅ Zalo 수신 연결 복구: ${params.accountName}`;
  const body = params.selfHealed
    ? "자동 재접속에 성공했습니다 — 수신이 정상화됐습니다. QR 재로그인은 필요 없습니다."
    : "수신이 정상화됐습니다.";
  try {
    const recipientIds = await alertRecipients(params.ownerUserId);
    for (const userId of recipientIds) {
      await enqueueInAppNotification({
        userId,
        type: "ZALO_LISTENER_RECOVERED",
        title,
        body,
        href: "/zalo-connect",
      });
    }
  } catch (err) {
    console.error(
      "[zalo-health] 복구 알림 적재 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * 미연결 계정 1건 자가 복구 시도 — 백오프가 도래했을 때만 실제 재접속을 호출한다.
 * @returns 갱신된 상태 + 이번 회차에 연결이 살아났는지(healthy)
 */
async function trySelfHeal(
  account: { id: string; kind: ZaloAccountKind; userId: string; displayName: string | null },
  prev: HealthState,
  now: number
): Promise<{ state: HealthState; healed: boolean }> {
  const plan = nextReconnectState(prev, now);
  if (!plan.attempt) return { state: plan.state, healed: false };

  let outcome: HealthReconnectOutcome;
  try {
    outcome = await reconnectAccountForHealth(account.userId, account.kind);
  } catch (err) {
    console.error(
      "[zalo-health] 자동 재접속 실패:",
      err instanceof Error ? err.message : String(err)
    );
    return { state: plan.state, healed: false };
  }

  const healed = outcome === "RECONNECTED" || outcome === "ALREADY_CONNECTED";
  console.log(
    `[zalo-health] 자동 재접속 시도: ${account.displayName ?? account.id} → ${outcome}` +
      ` (${plan.state.reconnectAttempts}회차)`
  );
  return { state: plan.state, healed };
}

/** 1회 점검 — 활성 계정 전체의 풀 상태를 보고 자가 복구 후 필요 시 경보. 전체 try/catch(리스너·서버 무영향). */
export async function runHealthCheckOnce(states: Map<string, HealthState>): Promise<void> {
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { isActive: true, credentials: { not: null } },
      select: { id: true, kind: true, displayName: true, userId: true },
    });
    for (const account of accounts) {
      const status = await statusForAccount(account);
      let prev = states.get(account.id) ?? { unhealthyStreak: 0, lastAlertAt: null };
      let healthy = status.connected;

      // ★자가 복구 — 경보보다 먼저. 여기서 살아나면 경보 자체가 나가지 않는다
      //   (2026-07-23: 감지만 하고 복구를 사람에게 미뤄 수신이 4시간 멈춘 사고의 대책).
      let selfHealed = false;
      if (!healthy) {
        const heal = await trySelfHeal(account, prev, Date.now());
        prev = heal.state;
        if (heal.healed) {
          healthy = true;
          selfHealed = true;
        }
      }

      const wasAlerted = prev.alerted === true;
      const next = nextHealthState(prev, healthy, Date.now());
      const alert = next.alert;
      // ★플랩 방어: 재접속으로 살린 회차는 백오프를 리셋하지 않는다. 접속 직후 다시 끊기는 계정에서
      //   "끊김→즉시 재로그인"이 5분마다 반복되면 그게 곧 밴 위험이다. 백오프 리셋은 풀이 스스로
      //   connected를 보고한 회차(자연 복구 확인)에서만 일어난다.
      const state: HealthState = selfHealed
        ? { ...next.state, reconnectAttempts: prev.reconnectAttempts, nextReconnectAt: prev.nextReconnectAt }
        : next.state;
      states.set(account.id, state);

      // 경보를 보냈던 계정이 살아났으면 복구 1회 통보 후 alerted 해제(반복 통보 금지).
      if (healthy && wasAlerted) {
        states.set(account.id, { ...state, alerted: false });
        await sendUpNotice({
          accountName: account.displayName ?? account.kind,
          ownerUserId: account.userId,
          selfHealed,
        });
      }

      if (alert) {
        // 재시작 리셋 대비 — 인메모리 lastAlertAt이 비어 있어도 DB의 마지막 경보 시각이
        // 쿨다운(6h) 이내면 억제 + 메모리 동기화(이후엔 순수함수 쿨다운이 DB 조회 없이 막음).
        const persisted = await readPersistedLastAlert(account.id);
        if (persisted !== null && Date.now() - persisted < ALERT_COOLDOWN_MS) {
          states.set(account.id, { ...state, lastAlertAt: persisted, alerted: wasAlerted });
          continue;
        }
        await sendDownAlert({
          accountId: account.id,
          accountName: account.displayName ?? account.kind,
          ownerUserId: account.userId,
          downMinutes: Math.round((state.unhealthyStreak * CHECK_INTERVAL_MS) / 60_000),
          lastError: status.lastError,
          reconnectAttempts: state.reconnectAttempts ?? 0,
        });
        await writePersistedLastAlert(account.id, state.lastAlertAt ?? Date.now());
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
