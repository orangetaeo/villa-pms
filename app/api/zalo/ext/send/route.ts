// POST /api/zalo/ext/send — Nike→villa 발송 위임 엔드포인트 (S1 / ADR-0010 A1·A5)
//
// 목적: villa-pms가 테오 Zalo 세션의 단일 허브(ADR-0010 A안). Nike는 테오 계정을
//       더 이상 WebSocket 로그인하지 않고(B1), 발송을 이 서버-서버 엔드포인트로 위임한다(B2).
//       신규 발송 로직 작성 금지 — 기존 sendChat*AsAdmin / addReactionAsAdmin 재사용.
//
// 보안(A5):
//   - 시크릿 게이트: x-zalo-ext-secret 헤더 vs process.env.ZALO_EXT_SHARED_SECRET을
//     crypto.timingSafeEqual로 비교(단순 === 금지). 헤더 없음/불일치/env 미설정 → 401.
//     시크릿 값은 로그·응답·에러에 절대 미출력.
//   - ownerAdminId(테오)는 요청에서 절대 받지 않는다 — 서버에서 getSystemBotOwnerId()
//     (SYSTEM_BOT DB 동적 해석) 또는 env ZALO_SYSTEM_OWNER_ID로 결정. 리터럴 ID 인라인 금지.
//     결정 실패(SYSTEM_BOT 없음) → 503.
//   - 응답 DTO는 채팅 발송 결과(messageId 등 최소 필드)만. ZaloAccount.credentials·villa
//     마진/판매가/재고 모델 절대 미참조·미반환.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  sendChatMessageAsAdmin,
  sendChatImageAsAdmin,
  sendChatReplyAsAdmin,
  addReactionAsAdmin,
  REACTION_KEYS,
} from "@/lib/zalo-runtime";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";

const SECRET_HEADER = "x-zalo-ext-secret";

// ── 본문 스키마 (discriminated union, kind 기준) ──────────────────────
// threadId = 발송 대상 Zalo userId(상대 스레드). ownerAdminId는 요청에서 받지 않음(서버 결정).
const replyQuoteSchema = z.object({
  zaloMsgId: z.string().min(1),
  cliMsgId: z.string().min(1),
  content: z.string().default(""),
  uidFrom: z.string().min(1),
});

const bodySchema = z.discriminatedUnion("kind", [
  // 텍스트 발송 → sendChatMessageAsAdmin
  z.object({
    kind: z.literal("TEXT"),
    threadId: z.string().min(1),
    text: z.string().min(1).max(4000),
  }),
  // 이미지 발송 → sendChatImageAsAdmin. 바이너리는 base64로 전달(서버-서버 JSON).
  z.object({
    kind: z.literal("IMAGE"),
    threadId: z.string().min(1),
    imageBase64: z.string().min(1),
    fileName: z.string().min(1).max(200),
    caption: z.string().max(4000).optional(),
  }),
  // 답글(인용) 발송 → sendChatReplyAsAdmin
  z.object({
    kind: z.literal("REPLY"),
    threadId: z.string().min(1),
    text: z.string().min(1).max(4000),
    quote: replyQuoteSchema,
  }),
  // 리액션 발송 → addReactionAsAdmin
  z.object({
    kind: z.literal("REACTION"),
    threadId: z.string().min(1),
    target: z.object({
      zaloMsgId: z.string().min(1),
      cliMsgId: z.string().min(1),
    }),
    iconKey: z.enum(REACTION_KEYS),
  }),
]);

/** 시크릿 게이트 — timingSafeEqual 비교. env 미설정·헤더 없음·불일치 모두 false. */
function isSecretValid(req: Request): boolean {
  const expected = process.env.ZALO_EXT_SHARED_SECRET;
  if (!expected) return false; // env 미설정 → 인증 불가(401). 시크릿 값 미노출.
  const provided = req.headers.get(SECRET_HEADER);
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // 길이 다르면 timingSafeEqual이 throw — 먼저 길이 비교(불일치로 처리)하되,
  // 길이 노출 최소화를 위해 동일 길이일 때만 정밀 비교한다.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  // ── A5 시크릿 게이트 (첫 줄 인증) ──
  if (!isSecretValid(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // ── A5 ownerAdminId 서버 결정 (요청 파라미터 미수용) ──
  // 1순위: SYSTEM_BOT DB 동적 해석. 2순위: env ZALO_SYSTEM_OWNER_ID. 둘 다 없으면 503.
  let ownerAdminId: string | null = null;
  try {
    ownerAdminId = await getSystemBotOwnerId();
  } catch {
    ownerAdminId = null;
  }
  if (!ownerAdminId) {
    ownerAdminId = process.env.ZALO_SYSTEM_OWNER_ID ?? null;
  }
  if (!ownerAdminId) {
    return NextResponse.json({ error: "SYSTEM_BOT_UNAVAILABLE" }, { status: 503 });
  }

  // ── 본문 파싱·검증 ──
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }
  const body = parsed.data;

  // ── 발송 (기존 함수 재사용, ownerAdminId 서버 고정) ──
  try {
    if (body.kind === "TEXT") {
      const res = await sendChatMessageAsAdmin(ownerAdminId, body.threadId, body.text);
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      return NextResponse.json({ ok: true, kind: "TEXT", messageId: res.messageId });
    }

    if (body.kind === "IMAGE") {
      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.imageBase64, "base64");
      } catch {
        return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
      }
      if (buffer.length === 0) {
        return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
      }
      const res = await sendChatImageAsAdmin(
        ownerAdminId,
        body.threadId,
        buffer,
        body.fileName,
        body.caption
      );
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      return NextResponse.json({ ok: true, kind: "IMAGE", messageId: res.messageId });
    }

    if (body.kind === "REPLY") {
      const res = await sendChatReplyAsAdmin(ownerAdminId, body.threadId, body.text, {
        zaloMsgId: body.quote.zaloMsgId,
        cliMsgId: body.quote.cliMsgId,
        content: body.quote.content,
        uidFrom: body.quote.uidFrom,
      });
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      return NextResponse.json({ ok: true, kind: "REPLY", messageId: res.messageId });
    }

    // body.kind === "REACTION"
    const res = await addReactionAsAdmin(
      ownerAdminId,
      body.threadId,
      { zaloMsgId: body.target.zaloMsgId, cliMsgId: body.target.cliMsgId },
      body.iconKey
    );
    if (!res.ok) {
      return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, kind: "REACTION" });
  } catch (e) {
    // 예기치 못한 서버 오류 — credential·시크릿 미노출(메시지 길이 제한 + 일반 코드).
    return NextResponse.json(
      { error: "INTERNAL_ERROR", reason: (e instanceof Error ? e.message : "unknown").slice(0, 200) },
      { status: 500 }
    );
  }
}
