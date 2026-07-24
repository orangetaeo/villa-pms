// lib/webchat-reminder.ts — 웹 채팅 미응답 리마인드 (T-webchat-unanswered-reminder)
//
// 배경: 방문자(비로그인)가 웹 채팅으로 문의했는데 운영자(테오)가 일정 시간(기본 30분) 답변하지
//   않으면, 운영자 Zalo 그룹방으로 "미응답 리마인드"를 한 번 더 보낸다. 신규 문의 알림(webchat-notify)이
//   묻혔을 때 놓치지 않게 하는 안전망.
//
// 설계(회귀 0 · 새 enum/스키마 없음):
//   - 기존 NotificationType.WEBCHAT_NEW_MESSAGE 재사용 + payload.kind="reminder"로 텍스트 분기
//     (타입 증식 금지 교훈 — MARKETING_ALERT·CONTRACT_NEGOTIATION과 동형). zalo.ts 빌더가 분기.
//   - enqueueOperatorNotification 경유 → 그룹 라우팅·킬스위치(ZALO_OPERATOR_NOTIFY_PAUSED) 그대로 상속.
//
// ★ 미응답 판정: 세션 OPEN + 마지막 메시지 방향 INBOUND(운영자가 아직 답장 안 함) + 그 메시지가
//   threshold(분) 이상 경과. "읽음"이 아니라 "답장"이 기준 — 읽고 안 답해도 리마인드한다.
//
// ★ 중복 방지(dedup): 마지막 방문자 메시지 시각(lastMessageAt) 이후에 이미 리마인드를 보냈으면 스킵.
//   근거를 DB 알림 이력에서 읽으므로 인메모리 상태·재배포에 견고(신규문의 디바운스와 달리 상태 무보관).
//   운영자가 답장하면 lastMessageDirection이 OUTBOUND로 바뀌어 후보에서 자연 이탈. 새 방문자 메시지가
//   오면 lastMessageAt이 리마인드 이력보다 미래가 되어 다시 대상이 됨(무기한 방치 세션도 1회씩만).
//
// ★ 누수 0: payload는 화이트리스트만 — 방문자 연락처·원문 전문·재고·KRW·마진 미포함.
//   preview는 마지막 INBOUND 메시지의 ko 번역 120자 절삭(신규문의 알림과 동일 규칙).
import { NotificationType, WebChatDirection, WebChatSessionStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { enqueueOperatorNotification } from "@/lib/operator-notify";
import { buildPreview } from "@/lib/webchat-notify";

/** 미응답 리마인드 기본 임계치(분). WEBCHAT_UNANSWERED_MINUTES env로 오버라이드. */
export const DEFAULT_UNANSWERED_MINUTES = 30;

/** env에서 임계치(분) 읽기 — 미설정·비정상값은 기본 30분. */
export function resolveThresholdMinutes(
  env: string | undefined = process.env.WEBCHAT_UNANSWERED_MINUTES
): number {
  const n = Number.parseInt(env ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_UNANSWERED_MINUTES;
}

/** 리마인드 판정에 필요한 세션 최소 필드(순수 함수 입력). */
export interface UnansweredCandidate {
  id: string;
  status: WebChatSessionStatus;
  lastMessageDirection: WebChatDirection | null;
  lastMessageAt: Date | null;
}

/**
 * 리마인드 대상 세션 선별 — 순수 함수(DB 무관, 테스트 용이).
 *  - OPEN + 마지막 메시지 INBOUND(미답장) + threshold 경과.
 *  - alreadyRemindedAt: sessionId → 마지막 리마인드 발송 시각(ms epoch). lastMessageAt 이후 발송 이력이
 *    있으면 스킵(같은 미응답 구간에 중복 방지). 이력 없으면 대상.
 * @returns 리마인드를 보낼 세션 id 배열.
 */
export function selectUnansweredSessions(
  sessions: UnansweredCandidate[],
  alreadyRemindedAt: Map<string, number>,
  now: Date,
  thresholdMs: number
): string[] {
  const cutoff = now.getTime() - thresholdMs;
  const out: string[] = [];
  for (const s of sessions) {
    if (s.status !== WebChatSessionStatus.OPEN) continue;
    if (s.lastMessageDirection !== WebChatDirection.INBOUND) continue;
    if (s.lastMessageAt == null) continue;
    const lastAt = s.lastMessageAt.getTime();
    if (lastAt > cutoff) continue; // 아직 threshold 미경과
    const remindedAt = alreadyRemindedAt.get(s.id);
    if (remindedAt != null && remindedAt >= lastAt) continue; // 이 미응답 구간엔 이미 보냄
    out.push(s.id);
  }
  return out;
}

export interface WebChatReminderSummary {
  candidateCount: number;
  reminderCount: number;
  sessionIds: string[];
}

/**
 * 웹 채팅 미응답 리마인드 실행 — cron 진입점(app/api/cron/webchat-unanswered).
 * 멱등: 세션당 미응답 구간(lastMessageAt) 1회. 대상 0건이면 알림 미적재.
 */
export async function runWebChatReminders(
  db: PrismaClient,
  now: Date
): Promise<WebChatReminderSummary> {
  const thresholdMinutes = resolveThresholdMinutes();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const cutoff = new Date(now.getTime() - thresholdMs);

  // 1차 후보 — OPEN + 마지막 INBOUND + threshold 경과 (DB 프리필터).
  const candidates = await db.webChatSession.findMany({
    where: {
      status: WebChatSessionStatus.OPEN,
      lastMessageDirection: WebChatDirection.INBOUND,
      lastMessageAt: { lte: cutoff },
    },
    select: {
      id: true,
      status: true,
      visitorLocale: true,
      lastMessageDirection: true,
      lastMessageAt: true,
    },
    orderBy: { lastMessageAt: "asc" },
  });

  if (candidates.length === 0) {
    return { candidateCount: 0, reminderCount: 0, sessionIds: [] };
  }

  // dedup 이력 — 가장 오래된 후보의 lastMessageAt 이후 리마인드만 보면 충분(그 이전 이력은 판정 무관).
  const oldest = candidates.reduce(
    (min, c) => (c.lastMessageAt && c.lastMessageAt < min ? c.lastMessageAt : min),
    candidates[0].lastMessageAt as Date
  );
  const priorReminders = await db.notification.findMany({
    where: {
      type: NotificationType.WEBCHAT_NEW_MESSAGE,
      createdAt: { gte: oldest },
    },
    select: { payload: true, createdAt: true },
  });

  const alreadyRemindedAt = new Map<string, number>();
  for (const n of priorReminders) {
    const p = n.payload as { kind?: unknown; sessionId?: unknown } | null;
    if (!p || p.kind !== "reminder" || typeof p.sessionId !== "string") continue;
    const at = n.createdAt.getTime();
    const prev = alreadyRemindedAt.get(p.sessionId);
    if (prev == null || at > prev) alreadyRemindedAt.set(p.sessionId, at);
  }

  const eligibleIds = selectUnansweredSessions(candidates, alreadyRemindedAt, now, thresholdMs);
  if (eligibleIds.length === 0) {
    return { candidateCount: candidates.length, reminderCount: 0, sessionIds: [] };
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  let reminderCount = 0;
  for (const sessionId of eligibleIds) {
    const session = byId.get(sessionId);
    if (!session || !session.lastMessageAt) continue;

    // preview — 마지막 INBOUND 메시지의 ko 번역(없으면 ko 원문). 소량 대상만 조회.
    const lastInbound = await db.webChatMessage.findFirst({
      where: { sessionId, direction: WebChatDirection.INBOUND },
      orderBy: { createdAt: "desc" },
      select: { text: true, sourceLocale: true, translatedText: true },
    });
    const previewKo =
      lastInbound?.translatedText ??
      (lastInbound?.sourceLocale === "ko" ? lastInbound.text : null);

    const waitingMinutes = Math.floor((now.getTime() - session.lastMessageAt.getTime()) / 60000);

    await enqueueOperatorNotification({
      type: NotificationType.WEBCHAT_NEW_MESSAGE,
      payload: {
        kind: "reminder", // zalo.ts가 리마인드 문구로 분기 · dedup 이력 판별 키
        sessionId,
        preview: buildPreview(previewKo),
        visitorLocale: session.visitorLocale,
        waitingMinutes,
        adminUrl: `/messages?tab=webchat&session=${sessionId}`,
      },
    });
    reminderCount += 1;
  }

  return { candidateCount: candidates.length, reminderCount, sessionIds: eligibleIds };
}
