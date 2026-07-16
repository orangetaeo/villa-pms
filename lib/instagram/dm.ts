// lib/instagram/dm.ts — Instagram DM 발신 + 카카오 유도 자동응답
//
// 기준: "Instagram API with Instagram Login" 메시징.
//   발신: POST {graphBase}/{IG_USER_ID}/messages  body={recipient:{id},message:{text}}
//     (access_token 쿼리 파라미터. 응답 message_id = OUT 레코드의 igMessageId 멱등 키).
//   ★ 24h 창: 상대가 마지막으로 보낸 시각+24h 안에서만 답장 가능(Meta 정책) — 창 검사는 호출부(reply API).
//     자동응답은 "첫 수신 직후" 발송이므로 항상 창 안이다.
//
// ★ 누수: DM 본문(발신·자동응답)에 판매가(KRW)·마진 절대 금지. 자동응답 기본 문구는 카피 가이드 톤
//   (인사 + 카카오 채널 링크 pf.kakao.com/_mVAfX + 프로필 안내)만. 로그에 토큰·앱시크릿 미출력.
//
// 스레드 키(igThreadId) = 상대 IGSID. 우리 IG 계정이 1개이므로 상대 id만으로 스레드가 유일(schema 주석).
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/lib/availability";
import {
  getIgAccessToken,
  getIgUserId,
  getIgGraphBase,
  getIgDmAutoReplyText,
  isIgDmAutoReplyPaused,
} from "@/lib/instagram/settings";

const HTTP_TIMEOUT_MS = 30_000;

export type IgSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason: string };

interface GraphErrorBody {
  error?: { message?: string; code?: number; type?: string };
}

/**
 * 상대(recipientIgsid)에게 텍스트 DM 발신. 게이트: 토큰·IG_USER_ID 미설정 시 실패 반환(throw 아님).
 * @returns { ok:true, messageId } — messageId는 Send API 응답 message_id(멱등 키).
 * ★ 실제 발송만 담당. OUT 레코드 기록은 recordOutboundDm(호출부가 성공 후 호출).
 */
export async function sendInstagramDm(
  recipientIgsid: string,
  text: string,
  db: DbClient = prisma
): Promise<IgSendResult> {
  const [token, userId, base] = await Promise.all([
    getIgAccessToken(db),
    getIgUserId(db),
    getIgGraphBase(db),
  ]);
  if (!token) return { ok: false, reason: "IG_ACCESS_TOKEN 미설정" };
  if (!userId) return { ok: false, reason: "IG_USER_ID 미설정" };

  try {
    const res = await fetch(`${base}/${userId}/messages?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientIgsid }, message: { text } }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphErrorBody;
    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `Graph API HTTP ${res.status}`;
      return { ok: false, reason: msg };
    }
    const messageId = typeof json.message_id === "string" ? json.message_id : null;
    return { ok: true, messageId };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * OUT 메시지 1건 기록. OUT은 항상 readByAdmin=true(미읽음 집계 오염 방지, schema 주석).
 * messageId 없으면(응답 누락) 로컬 유일 센티널로 대체 — igMessageId NOT NULL·unique 충족.
 */
export async function recordOutboundDm(params: {
  igThreadId: string;
  messageId: string | null;
  text: string;
  autoReplied?: boolean;
  db?: DbClient;
}) {
  const db = params.db ?? prisma;
  const userId = (await getIgUserId(db)) ?? "";
  return db.instagramMessage.create({
    data: {
      igThreadId: params.igThreadId,
      igSenderId: userId,
      direction: "OUT",
      text: params.text,
      igMessageId: params.messageId ?? `out-local:${randomUUID()}`,
      receivedAt: new Date(),
      readByAdmin: true,
      autoReplied: params.autoReplied ?? false,
    },
  });
}

export type AutoReplyResult = { sent: boolean; reason?: string };

/**
 * 스레드 첫 수신 시 카카오 유도 자동응답 1회. 중복 방지 = 스레드에 autoReplied 표시된 행이 있으면 스킵.
 *   - 킬스위치(IG_DM_AUTOREPLY_PAUSED) 정지 시 미발송.
 *   - 발송 성공 시: OUT 레코드 기록 + 스레드 최신 IN 행 autoReplied=true(once-per-thread 잠금).
 * ★ 웹훅 처리에서 신규 IN 저장 직후 호출. 실패해도 throw 금지(수신 저장은 이미 커밋).
 */
export async function maybeSendKakaoAutoReply(
  igThreadId: string,
  db: DbClient = prisma
): Promise<AutoReplyResult> {
  if (await isIgDmAutoReplyPaused(db)) return { sent: false, reason: "PAUSED" };

  // 이 스레드에서 이미 자동응답한 적 있으면 스킵(once-per-thread).
  const prior = await db.instagramMessage.findFirst({
    where: { igThreadId, autoReplied: true },
    select: { id: true },
  });
  if (prior) return { sent: false, reason: "ALREADY_REPLIED" };

  const text = await getIgDmAutoReplyText(db);
  const result = await sendInstagramDm(igThreadId, text, db);
  if (!result.ok) return { sent: false, reason: result.reason };

  // OUT 기록(autoReplied=true로 잠금) + 스레드 최신 IN 행도 autoReplied 표시(집계·표시 겸용).
  await recordOutboundDm({ igThreadId, messageId: result.messageId, text, autoReplied: true, db });
  const latestIn = await db.instagramMessage.findFirst({
    where: { igThreadId, direction: "IN" },
    orderBy: { receivedAt: "desc" },
    select: { id: true },
  });
  if (latestIn) {
    await db.instagramMessage.update({ where: { id: latestIn.id }, data: { autoReplied: true } });
  }
  return { sent: true };
}

/** attachments Json 캐스팅 헬퍼 — 웹훅 원본 배열을 Prisma Json 입력으로. */
export function toJsonAttachments(raw: unknown): Prisma.InputJsonValue | undefined {
  if (raw == null) return undefined;
  return raw as Prisma.InputJsonValue;
}
