// app/api/webhooks/instagram/route.ts — Instagram 메시징 웹훅 수신
//
// GET  : hub.mode=subscribe & hub.verify_token == IG_WEBHOOK_VERIFY_TOKEN → hub.challenge 에코(200).
//        불일치·미설정 → 403.
// POST : X-Hub-Signature-256 HMAC(raw body, key=IG_APP_SECRET) 검증. 불일치·미설정 → 401.
//        messages 이벤트만 파싱 → InstagramMessage(IN) 멱등 저장(igMessageId unique, P2002 흡수).
//        echo(message.is_echo)·read·reaction 등 비수신 이벤트는 무시.
//        ★ 항상 200 빠른 응답 — 처리 실패도 Meta 재전송 폭주 방지(파싱 불가급만 인앱 경보).
//
// ★ 로그: 토큰·앱시크릿·서명 원문 미출력. 본문 preview는 40자 절단(PII 최소화).
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getIgWebhookVerifyToken, getIgAppSecret } from "@/lib/instagram/settings";
import { maybeSendKakaoAutoReply, toJsonAttachments } from "@/lib/instagram/dm";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DM_INBOX_HREF = "/marketing/instagram";

/** 상수시간 문자열 비교(길이 다르면 즉시 false). */
function timingSafeStrEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ── GET: 웹훅 검증 핸드셰이크 ──
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expected = await getIgWebhookVerifyToken();
  if (mode === "subscribe" && expected && token && timingSafeStrEq(token, expected)) {
    // challenge 원문 그대로 에코(text/plain).
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** X-Hub-Signature-256 검증 — sha256=<hmac(raw, appSecret)>, 상수시간 비교. */
function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return timingSafeStrEq(header, expected);
}

interface IgMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown;
  };
}
interface IgEntry {
  id?: string;
  time?: number;
  messaging?: IgMessaging[];
}
interface IgWebhookPayload {
  object?: string;
  entry?: IgEntry[];
}

/**
 * 신규 IN 메시지 멱등 저장. 이미 존재(P2002)면 false(재전송·echo 중복 → 재알림/재응답 안 함).
 */
async function createInboundMessage(args: {
  senderId: string;
  mid: string;
  text: string | null;
  attachments: unknown;
  receivedAt: Date;
}): Promise<boolean> {
  try {
    await prisma.instagramMessage.create({
      data: {
        igThreadId: args.senderId, // 스레드 키 = 상대 IGSID
        igSenderId: args.senderId,
        direction: "IN",
        text: args.text,
        attachments: toJsonAttachments(args.attachments),
        igMessageId: args.mid,
        receivedAt: args.receivedAt,
        readByAdmin: false,
        autoReplied: false,
      },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false; // 중복 mid — 웹훅 재전송/echo. 멱등 흡수.
    }
    throw e;
  }
}

/**
 * 신규 DM 인앱 알림 — 과알림 완화: 이 스레드에 (방금 저장분 포함) 미읽음 IN이 1건뿐일 때만 알림.
 * 이미 미읽음이 쌓여 있으면 운영자는 이미 벨 뱃지로 인지 중 → 스킵.
 */
async function notifyNewDmThrottled(igThreadId: string, text: string | null): Promise<void> {
  try {
    const unread = await prisma.instagramMessage.count({
      where: { igThreadId, direction: "IN", readByAdmin: false },
    });
    if (unread !== 1) return; // 0(경합)·2+(이미 알림됨) → 스킵
    const preview = (text?.trim() || "(미디어)").slice(0, 40);
    await enqueueInAppForOperators({
      type: "IG_DM_RECEIVED",
      title: "새 인스타그램 DM",
      body: preview,
      href: DM_INBOX_HREF,
    });
  } catch (e) {
    // 알림 적재 실패가 웹훅 200을 막지 않게 격리.
    console.error("[webhooks/instagram] 인앱 알림 실패(무시):", e instanceof Error ? e.message : String(e));
  }
}

async function processPayload(payload: IgWebhookPayload): Promise<void> {
  if (!payload || payload.object !== "instagram") return;
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const ev of events) {
      const msg = ev.message;
      if (!msg || typeof msg !== "object") continue; // read·reaction·postback 등 무시
      if (msg.is_echo) continue; // 우리 발신 echo — 발신 시 이미 OUT 기록됨
      const mid = typeof msg.mid === "string" ? msg.mid : null;
      const senderId = typeof ev.sender?.id === "string" ? ev.sender.id : null;
      if (!mid || !senderId) continue;
      const text = typeof msg.text === "string" ? msg.text : null;
      const receivedAt =
        typeof ev.timestamp === "number" ? new Date(ev.timestamp) : new Date();

      const created = await createInboundMessage({
        senderId,
        mid,
        text,
        attachments: msg.attachments,
        receivedAt,
      });
      if (!created) continue; // 중복 → 알림·자동응답 스킵

      await notifyNewDmThrottled(senderId, text);
      // 카카오 유도 자동응답(스레드 1회) — 실패해도 200 유지.
      try {
        await maybeSendKakaoAutoReply(senderId);
      } catch (e) {
        console.error(
          "[webhooks/instagram] 자동응답 실패(무시):",
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  }
}

// ── POST: 이벤트 수신 ──
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = await getIgAppSecret();
  // 앱 시크릿 미설정 시 무인증 처리 금지 → 401(설정 전까지 웹훅 비활성과 동일).
  if (!secret) return new NextResponse("Unauthorized", { status: 401 });
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: IgWebhookPayload | null = null;
  try {
    payload = JSON.parse(raw) as IgWebhookPayload;
  } catch {
    // 서명은 통과했으나 본문 파싱 불가 = 이상 신호 → 인앱 경보 후 200(재전송 폭주 방지).
    try {
      await enqueueInAppForOperators({
        type: "IG_DM_RECEIVED",
        title: "인스타그램 웹훅 파싱 오류",
        body: "서명은 통과했으나 payload를 해석하지 못했습니다. 로그 확인 필요.",
        href: DM_INBOX_HREF,
      });
    } catch {
      /* noop */
    }
    return NextResponse.json({ ok: true });
  }

  try {
    await processPayload(payload);
  } catch (e) {
    // 처리 실패도 200 — Meta 재전송 폭주 방지. 로그만(PII·시크릿 미포함).
    console.error(
      "[webhooks/instagram] payload 처리 실패(무시):",
      e instanceof Error ? e.message : String(e)
    );
  }
  return NextResponse.json({ ok: true });
}
