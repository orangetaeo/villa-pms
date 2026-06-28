// 보안 이상탐지 경보 (보안 P3-S3) — SecurityEvent(P0-1) 임계치 초과 시 운영자(테오)에게 Zalo 경보.
//
// 설계:
// - evaluateSecurityTriggers / applyCooldown는 순수 함수(단위 테스트로 임계치·쿨다운 고정).
// - runSecurityAlerts가 조회→평가→쿨다운→enqueue→마커기록 오케스트레이션(멱등·fire-and-forget).
// - 알림은 enqueueNotification(검증된 큐 발송경로) 재사용. 쿨다운은 SecurityEvent(type=ALERT_SENT)로 기록
//   (type이 String 컬럼이라 무마이그레이션). 알림 payload·텍스트에 비번·해시·마진·판매가 미포함.

import { NotificationType, type PrismaClient } from "@prisma/client";
import { enqueueNotification } from "./zalo";
import { recordSecurityEvent } from "./security-event";

export const ALERT_WINDOW_MS = 10 * 60_000; // 탐지 윈도우 10분
export const ALERT_COOLDOWN_MS = 60 * 60_000; // 같은 category 재경보 쿨다운 60분

// 기본 임계치(운영 중 조정 가능). 10분 윈도우 기준.
export const SECURITY_ALERT_THRESHOLDS = {
  loginFailPerActor: 20, // 한 phone/ip의 로그인 실패
  authzDenyPerUser: 15, // 한 userId의 권한거부(403)
  credDecryptFail: 1, // Zalo credential 복호화 실패(희귀=즉시)
  ssrfBlock: 1, // 내부망 접근 차단(희귀=즉시)
  rateLimitTotal: 100, // 전체 rate-limit 차단
};

// 탐지 대상 SecurityEvent 타입(윈도우 조회 필터와 일치)
export const MONITORED_TYPES = [
  "LOGIN_FAIL",
  "AUTHZ_DENY",
  "CRED_DECRYPT_FAIL",
  "SSRF_BLOCK",
  "RATE_LIMIT",
] as const;

export interface SecurityEventLite {
  type: string;
  actorUserId: string | null;
  actorPhone: string | null;
  ip: string | null;
}

export interface SecurityTrigger {
  category: string; // 쿨다운 키 (안정적 식별자)
  count: number;
  top: string | null; // 주요 출처(조사 힌트) — phone/ip/userId
}

/** 식별자별 카운트 후 최다 그룹 반환(없으면 null). */
function topGroup<T>(items: T[], keyFn: (t: T) => string | null): { key: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let top: { key: string; count: number } | null = null;
  for (const [key, count] of counts) {
    if (!top || count > top.count) top = { key, count };
  }
  return top;
}

/**
 * 윈도우 내 SecurityEvent 배열 → 발화한 트리거 목록(순수 함수).
 * LOGIN_FAIL·AUTHZ_DENY는 per-actor 최다 그룹이 임계 초과 시, 나머지는 총량 기준.
 */
export function evaluateSecurityTriggers(
  events: SecurityEventLite[],
  thresholds = SECURITY_ALERT_THRESHOLDS,
): SecurityTrigger[] {
  const triggers: SecurityTrigger[] = [];

  const loginFails = events.filter((e) => e.type === "LOGIN_FAIL");
  const lf = topGroup(loginFails, (e) => e.actorPhone ?? e.ip);
  if (lf && lf.count >= thresholds.loginFailPerActor) {
    triggers.push({ category: "LOGIN_FAIL_SPIKE", count: lf.count, top: lf.key });
  }

  const denies = events.filter((e) => e.type === "AUTHZ_DENY");
  const ad = topGroup(denies, (e) => e.actorUserId);
  if (ad && ad.count >= thresholds.authzDenyPerUser) {
    triggers.push({ category: "AUTHZ_DENY_SPIKE", count: ad.count, top: ad.key });
  }

  const cred = events.filter((e) => e.type === "CRED_DECRYPT_FAIL");
  if (cred.length >= thresholds.credDecryptFail) {
    triggers.push({ category: "CRED_DECRYPT_FAIL", count: cred.length, top: null });
  }

  const ssrf = events.filter((e) => e.type === "SSRF_BLOCK");
  if (ssrf.length >= thresholds.ssrfBlock) {
    triggers.push({ category: "SSRF_BLOCK", count: ssrf.length, top: topGroup(ssrf, (e) => e.ip)?.key ?? null });
  }

  const rl = events.filter((e) => e.type === "RATE_LIMIT");
  if (rl.length >= thresholds.rateLimitTotal) {
    triggers.push({ category: "RATE_LIMIT_FLOOD", count: rl.length, top: null });
  }

  return triggers;
}

/** 쿨다운 적용(순수) — 최근 경보된 category는 제외. */
export function applyCooldown(
  triggers: SecurityTrigger[],
  alertedCategories: Set<string>,
): { fresh: SecurityTrigger[]; skipped: number } {
  const fresh = triggers.filter((t) => !alertedCategories.has(t.category));
  return { fresh, skipped: triggers.length - fresh.length };
}

// 경보 수신자 — 보안 책임 역할(테오)만. STAFF/MANAGER 제외(불필요한 경보 회피).
const ALERT_RECIPIENT_ROLES = ["OWNER", "ADMIN"] as const;

export interface SecurityAlertSummary {
  triggered: number;
  alertsSent: number;
  skippedCooldown: number;
  categories: string[];
}

/**
 * 이상탐지 1회 실행 — 최근 윈도우 평가 → 쿨다운 → OWNER/ADMIN(zaloUserId)에게 경보 → 마커 기록.
 * 멱등(빈 윈도우=0건). 경보 실패가 cron 본 흐름을 막지 않게 호출처에서 try/catch.
 */
export async function runSecurityAlerts(db: PrismaClient, now: Date): Promise<SecurityAlertSummary> {
  const windowStart = new Date(now.getTime() - ALERT_WINDOW_MS);
  const events = await db.securityEvent.findMany({
    where: { createdAt: { gte: windowStart }, type: { in: [...MONITORED_TYPES] } },
    select: { type: true, actorUserId: true, actorPhone: true, ip: true },
  });

  const triggers = evaluateSecurityTriggers(events);
  if (triggers.length === 0) {
    return { triggered: 0, alertsSent: 0, skippedCooldown: 0, categories: [] };
  }

  // 쿨다운 — 최근 60분 ALERT_SENT 마커의 category 수집
  const cooldownStart = new Date(now.getTime() - ALERT_COOLDOWN_MS);
  const recentMarkers = await db.securityEvent.findMany({
    where: { type: "ALERT_SENT", createdAt: { gte: cooldownStart } },
    select: { meta: true },
  });
  const onCooldown = new Set<string>();
  for (const m of recentMarkers) {
    const cat = (m.meta as { category?: string } | null)?.category;
    if (cat) onCooldown.add(cat);
  }

  const { fresh, skipped } = applyCooldown(triggers, onCooldown);
  if (fresh.length === 0) {
    return { triggered: triggers.length, alertsSent: 0, skippedCooldown: skipped, categories: [] };
  }

  const recipients = await db.user.findMany({
    where: { role: { in: [...ALERT_RECIPIENT_ROLES] }, isActive: true, zaloUserId: { not: null } },
    select: { id: true },
  });

  let alertsSent = 0;
  for (const t of fresh) {
    for (const r of recipients) {
      await enqueueNotification({
        db,
        userId: r.id,
        type: NotificationType.SECURITY_ALERT,
        payload: { category: t.category, count: t.count, top: t.top, windowMin: ALERT_WINDOW_MS / 60_000 },
      });
      alertsSent += 1;
    }
    // 쿨다운 마커 — 수신자 0명이어도 기록(빈 윈도우 반복 평가 폭주 방지). 비민감 meta만.
    await recordSecurityEvent({ type: "ALERT_SENT", meta: { category: t.category, count: t.count } });
  }

  return {
    triggered: triggers.length,
    alertsSent,
    skippedCooldown: skipped,
    categories: fresh.map((t) => t.category),
  };
}
