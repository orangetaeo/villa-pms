// lib/zalo-webhook.ts — villa→Nike 수신 webhook push (S2 / ADR-0010 A4)
//
// 목적: villa __system__가 새 메시지를 저장한 직후, Nike webhook 수신 라우트로 메시지 DTO 1건을
//       fire-and-forget POST한다. Nike(B4)는 이를 HMAC 검증 후 기존 emitZaloMessage→SSE로 흘려보낸다.
//       villa 자체 UI는 기존 폴링 유지 — 이 push는 Nike 실시간 표시 전용(병렬 추가).
//
// 인증(② HMAC — villa 서명, Nike 검증):
//   - 서명 키: ZALO_WEBHOOK_HMAC_SECRET (ZALO_EXT_SHARED_SECRET과 별개, 양 레포 동일 값).
//   - 서명 대상: `${timestamp}.${rawBody}` (rawBody = 직렬화된 JSON 문자열 그대로).
//   - 헤더: x-zalo-webhook-timestamp(epoch ms), x-zalo-webhook-signature(`sha256=`+hex).
//
// 안전성:
//   - NIKE_WEBHOOK_URL / ZALO_WEBHOOK_HMAC_SECRET 미설정 시 no-op(조용히 반환 — 배포 순서 무해).
//   - AbortController 타임아웃(4s) — Nike 다운 시 dangling fetch가 리스너 스레드를 잡지 않게.
//   - 실패는 swallow(로그만, credential·시크릿·HMAC 비밀 미출력). at-least-once(재시도 안 함 —
//     누락은 Nike poll/B3 재조회가 catch-up). 멱등 키 = message.zaloMsgId(Nike가 중복 무시).
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TIMEOUT_MS = 4000;

/** push 페이로드 message 블록 — A2/A3·webhook 동일 메시지 DTO 화이트리스트(credential·금액·마진 0건). */
interface WebhookMessageDTO {
  id: string;
  zaloMsgId: string | null;
  cliMsgId: string | null;
  direction: string;
  source: string;
  msgType: string;
  text: string;
  translatedText: string | null;
  attachmentUrls: string[];
  quotedText: string | null;
  quotedSender: string | null;
  reactions: unknown;
  createdAt: string;
}

/**
 * 상대경로 첨부 URL을 villa 절대 URL로 보정 (B3 보강 — Nike 도메인 기준 깨짐 방지).
 * 이미 절대(http/https) URL이면 그대로. 상대경로면 base(NEXTAUTH_URL 등)로 prefix.
 * base 미설정 + 상대경로면 그대로 둔다(차선 — 깨지더라도 누수는 아님).
 */
function toAbsoluteUrls(urls: string[]): string[] {
  const base =
    process.env.VILLA_PUBLIC_BASE_URL ||
    process.env.STORAGE_PUBLIC_URL ||
    process.env.NEXTAUTH_URL ||
    "";
  return urls.map((u) => {
    if (/^https?:\/\//i.test(u)) return u; // 이미 절대 URL
    if (!base) return u;
    const left = base.replace(/\/+$/, "");
    const right = u.replace(/^\/+/, "");
    return `${left}/${right}`;
  });
}

/**
 * 저장된 ZaloMessage 1건을 Nike로 push (fire-and-forget).
 * @param ref 메시지 식별 — id(INBOUND saveInboundMessage 반환) 또는 zaloMsgId(OUTBOUND echo) 중 하나.
 * @param threadId 대화 상대 zaloUserId (Nike emitZaloMessage threadId).
 * @param ownerAdminId 테오(라우팅 힌트·정합 확인용 — 페이로드엔 ownerScope:"theo"만 노출).
 *
 * 호출부(zalo-runtime handleInboundEvent)에서 await 없이 void로 띄운다. 절대 throw 금지(전체 swallow).
 */
export function pushInboundToNike(args: {
  ref: { id: string } | { zaloMsgId: string };
  threadId: string;
  ownerAdminId: string;
}): void {
  // 비블로킹 — 즉시 반환하고 내부 async를 띄운다(리스너 스레드 점유 금지).
  void (async () => {
    try {
      const webhookUrl = process.env.NIKE_WEBHOOK_URL;
      const secret = process.env.ZALO_WEBHOOK_HMAC_SECRET;
      if (!webhookUrl || !secret) return; // env 미설정 → no-op(안전)

      // ── 메시지 DTO 최소 조회 (credential·금액·마진 미참조 — ZaloMessage 화이트리스트만) ──
      const where =
        "id" in args.ref ? { id: args.ref.id } : { zaloMsgId: args.ref.zaloMsgId };
      const m = await prisma.zaloMessage.findFirst({
        where: {
          ...where,
          // 테오 스코프 정합 — push는 테오 대화 메시지만(타 관리자 누수 0)
          conversation: { ownerAdminId: args.ownerAdminId },
        },
        select: {
          id: true,
          zaloMsgId: true,
          cliMsgId: true,
          direction: true,
          source: true,
          msgType: true,
          text: true,
          translatedText: true,
          attachmentUrls: true,
          quotedText: true,
          quotedSender: true,
          reactions: true,
          createdAt: true,
          conversationId: true,
        },
      });
      if (!m) return; // 미저장/스코프 외 → push 없음

      const message: WebhookMessageDTO = {
        id: m.id,
        zaloMsgId: m.zaloMsgId,
        cliMsgId: m.cliMsgId,
        direction: m.direction,
        source: m.source,
        msgType: m.msgType ?? "text",
        text: m.text ?? "",
        translatedText: m.translatedText,
        attachmentUrls: toAbsoluteUrls(m.attachmentUrls ?? []),
        quotedText: m.quotedText,
        quotedSender: m.quotedSender,
        reactions: m.reactions ?? null,
        createdAt: m.createdAt.toISOString(),
      };

      const payload = {
        ownerScope: "theo" as const, // 라우팅 힌트(신뢰 X — Nike는 HMAC만 신뢰)
        conversationId: m.conversationId,
        threadId: args.threadId,
        message,
      };

      // ── HMAC-SHA256 서명: `${timestamp}.${rawBody}` ──
      const rawBody = JSON.stringify(payload);
      const timestamp = Date.now().toString();
      const signature =
        "sha256=" +
        createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

      // ── fire-and-forget POST + AbortController 타임아웃 ──
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-zalo-webhook-timestamp": timestamp,
            "x-zalo-webhook-signature": signature,
          },
          body: rawBody,
          signal: controller.signal,
        });
        // 응답 상태는 무시(at-least-once, 재시도 안 함 — Nike poll이 catch-up)
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // 실패 swallow — credential·시크릿·HMAC 비밀 미출력(일반 메시지만)
      console.error(
        "[zalo-webhook] Nike push 실패(무시):",
        err instanceof Error ? err.message : String(err)
      );
    }
  })();
}
