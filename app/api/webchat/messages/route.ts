// POST/GET /api/webchat/messages — 방문자(비로그인) 발신 + 폴링 (T-webchat-mvp)
//
// 비로그인 라우트: role 검사 없음. 대신 httpOnly 서명 쿠키(webchat-session)가 세션 스코프를 강제한다.
// 누수 0(기획 §7): 방문자 응답은 화이트리스트만 — ownerAdminId·ipHash·contact·타 세션·금액 절대 미포함.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/rate-limit";
import {
  WEBCHAT_COOKIE,
  MSG_MAX_LEN,
  hashVisitorIp,
  readSessionIdFromRequest,
  makeSessionCookieValue,
  sessionCookieOptions,
  isWebChatPaused,
  checkWebChatThrottle,
  maybeTranslate,
  computeExpiresAt,
  previewText,
  resolveWebChatOwnerAdminId,
  listActiveOperatorIds,
  verifyTurnstile,
} from "@/lib/webchat";
import { publish } from "@/lib/realtime-bus";
import { enqueueWebChatNewMessageNotification } from "@/lib/webchat-notify";

// ───────────────────────── POST: 발신(+ 최초 세션 원자 생성) ─────────────────────────

const postSchema = z.object({
  text: z.string(),
  locale: z.string().trim().min(1).max(16).optional(),
  turnstileToken: z.string().optional(),
  sourcePage: z.string().trim().max(300).optional(),
});

function normalizeLocale(locale: string | undefined): string {
  return locale && locale.trim().length > 0 ? locale.trim() : "en";
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }
  const { text, locale, turnstileToken, sourcePage } = parsed.data;

  const ip = clientIp(req.headers);
  const ipHash = hashVisitorIp(ip);
  const visitorLocale = normalizeLocale(locale);

  // ── 가드 1: 킬스위치 ──
  if (await isWebChatPaused()) {
    return NextResponse.json({ ok: false, reason: "paused" }, { status: 503 });
  }

  // 기존 세션 로드(쿠키 유효 시)
  const cookieSessionId = readSessionIdFromRequest(req);
  const existing = cookieSessionId
    ? await prisma.webChatSession.findUnique({
        where: { id: cookieSessionId },
        select: { id: true, status: true, expiresAt: true },
      })
    : null;

  if (existing) {
    // ── 가드 2: 차단 세션 ──
    if (existing.status === "BLOCKED") {
      return NextResponse.json({ ok: false, reason: "blocked" }, { status: 403 });
    }
    // ── 가드 3: 만료 — 쿠키 삭제 후 새 세션 유도 ──
    if (existing.expiresAt.getTime() <= Date.now()) {
      const res = NextResponse.json({ ok: false, reason: "expired" }, { status: 410 });
      res.cookies.delete(WEBCHAT_COOKIE);
      return res;
    }
  }

  // ── 가드 4: 스로틀(세션 15/분 · ipHash 40/분) ──
  const throttle = await checkWebChatThrottle(existing?.id ?? null, ipHash, req);
  if (!throttle.allowed) {
    return NextResponse.json({ ok: false, reason: "throttled" }, { status: 429 });
  }

  // ── 가드 5: 길이 ──
  const trimmed = text.trim();
  if (trimmed.length === 0 || text.length > MSG_MAX_LEN) {
    return NextResponse.json({ ok: false, reason: "invalid_length" }, { status: 400 });
  }

  // eager ko 번역(트랜잭션 밖 — Gemini 호출은 DB 커넥션 점유 금지). 실패해도 저장 진행.
  const ko = await maybeTranslate(text, "ko", visitorLocale);
  const preview = previewText(text);
  const now = new Date();
  const expiresAt = computeExpiresAt(now);

  let sessionId: string;
  let messageOut: { id: string; createdAt: Date };
  const isFirstMessage = !existing;

  if (!existing) {
    // 최초 세션 — Turnstile은 세션 생성 시에만 검증
    if (!(await verifyTurnstile(turnstileToken, ip))) {
      return NextResponse.json({ ok: false, reason: "turnstile" }, { status: 403 });
    }
    const ownerAdminId = await resolveWebChatOwnerAdminId();
    if (!ownerAdminId) {
      return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
    }
    // 세션 원자 생성 + 첫 메시지 저장 + 비정규화를 한 트랜잭션으로
    const created = await prisma.webChatSession.create({
      data: {
        ownerAdminId,
        visitorLocale,
        ipHash,
        sourcePage: sourcePage ?? null,
        expiresAt,
        unreadForAdmin: 1,
        lastMessageText: preview,
        lastMessageDirection: "INBOUND",
        lastMessageAt: now,
        messages: {
          create: {
            direction: "INBOUND",
            text,
            sourceLocale: visitorLocale,
            translatedText: ko.translatedText,
            translatedTo: ko.translatedTo,
          },
        },
      },
      select: {
        id: true,
        messages: { select: { id: true, createdAt: true } },
      },
    });
    sessionId = created.id;
    messageOut = created.messages[0];
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const m = await tx.webChatMessage.create({
        data: {
          sessionId: existing.id,
          direction: "INBOUND",
          text,
          sourceLocale: visitorLocale,
          translatedText: ko.translatedText,
          translatedTo: ko.translatedTo,
        },
        select: { id: true, createdAt: true },
      });
      await tx.webChatSession.update({
        where: { id: existing.id },
        data: {
          visitorLocale, // 방문자가 언어 칩으로 바꿨을 수 있음 — 답장 번역이 현재 언어를 향하도록
          lastMessageText: preview,
          lastMessageDirection: "INBOUND",
          lastMessageAt: m.createdAt,
          unreadForAdmin: { increment: 1 },
          expiresAt, // 슬라이딩 연장
        },
      });
      return m;
    });
    sessionId = existing.id;
    messageOut = result;
  }

  // 실시간 신호(식별만) — best-effort. 웹챗은 조직 공유 자산이라 활성 운영자 전원 채널로 fan-out.
  try {
    const operatorIds = await listActiveOperatorIds();
    for (const opId of operatorIds) {
      publish(opId, { type: "inbound", conversationId: sessionId, source: "webchat" });
    }
  } catch {
    /* 신호 실패는 무해 */
  }

  // 운영자 Zalo 알림(INTEG 모듈) — 첫 메시지 즉시, 후속 디바운스. 실패는 모듈이 삼킴.
  const previewKo = ko.translatedText ?? (visitorLocale === "ko" ? preview : null);
  await enqueueWebChatNewMessageNotification({
    sessionId,
    previewKo,
    visitorLocale,
    isFirstMessage,
  });

  // 응답 — 화이트리스트만. 쿠키 발급/갱신(슬라이딩).
  const res = NextResponse.json({
    ok: true,
    sessionId,
    message: { id: messageOut.id, createdAt: messageOut.createdAt.toISOString() },
  });
  res.cookies.set(WEBCHAT_COOKIE, makeSessionCookieValue(sessionId), sessionCookieOptions());
  return res;
}

// ───────────────────────── GET: 폴링(자기 세션만) ─────────────────────────

export async function GET(req: Request) {
  const sessionId = readSessionIdFromRequest(req);
  if (!sessionId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const session = await prisma.webChatSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.status === "BLOCKED") {
    return NextResponse.json({ ok: false, reason: "blocked" }, { status: 403 });
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    const res = NextResponse.json({ ok: false, reason: "expired" }, { status: 410 });
    res.cookies.delete(WEBCHAT_COOKIE);
    return res;
  }

  // after 커서 = 마지막으로 받은 메시지의 createdAt(ISO). 증분만 반환.
  const afterParam = new URL(req.url).searchParams.get("after");
  let after: Date | undefined;
  if (afterParam) {
    const d = new Date(afterParam);
    if (!Number.isNaN(d.getTime())) after = d;
  }

  const rows = await prisma.webChatMessage.findMany({
    where: {
      sessionId: session.id,
      ...(after ? { createdAt: { gt: after } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    // translatedText는 컬럼 1개라 SQL로 방향별 제외 불가 → 아래 매핑에서 INBOUND는 제거(누수 차단).
    select: {
      id: true,
      direction: true,
      text: true,
      translatedText: true,
      translationFailed: true,
      createdAt: true,
    },
  });

  // INBOUND의 ko 번역은 방문자에게 불필요·미노출 — OUTBOUND만 translatedText 노출.
  const messages = rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    text: m.text,
    translatedText: m.direction === "OUTBOUND" ? m.translatedText : null,
    translationFailed: m.translationFailed,
    createdAt: m.createdAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, messages });
}
