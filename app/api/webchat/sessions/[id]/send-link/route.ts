// POST /api/webchat/sessions/[id]/send-link — 원클릭 게스트 링크 발송 (T-webchat-guest-link-share)
//
// 운영자 전체 개방(웹챗 무금액 게이트). 연결된 예약의 게스트 링크(체크인·부가서비스·영수증)를
//   방문자 언어 사전 번역 문구와 함께 OUTBOUND 메시지로 발송한다. ★Gemini 미경유(translatedText 직접 기록).
//   토큰: 활성(미회수·미만료) GuestCheckinToken 있으면 재사용, 없으면 신규 발급(기존 QR·기전달 링크 무효화 금지).
//   전건 writeAuditLog. reply/route.ts와 동일하게 lastMessage* 비정규화 갱신 + SSE fan-out.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";
import { publish } from "@/lib/realtime-bus";
import { computeExpiresAt, previewText, listActiveOperatorIds } from "@/lib/webchat";
import {
  generateGuestToken,
  defaultGuestTokenExpiry,
  isGuestTokenUsable,
} from "@/lib/guest-checkin";
import { renderLinkMessage, type LinkKind } from "@/lib/webchat-link-templates";

const schema = z.object({ kind: z.enum(["checkin", "options", "receipt"]) });

/** 앱 공개 base URL(NEXTAUTH_URL 우선, 끝 슬래시 제거). 미설정 시 상대경로 폴백(위젯 동일 오리진). */
function appBaseUrl(): string {
  const raw = process.env.NEXTAUTH_URL || process.env.VILLA_PUBLIC_BASE_URL || "";
  return raw.replace(/\/+$/, "");
}

/** kind → /g 경로 suffix. */
function kindPathSuffix(kind: LinkKind): string {
  return kind === "options" ? "/options" : kind === "receipt" ? "/receipt" : "";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }
  const kind = parsed.data.kind;

  // 세션 로드(조직 공유) — bookingId·visitorLocale 필요.
  const session = await prisma.webChatSession.findFirst({
    where: { id },
    select: { id: true, status: true, visitorLocale: true, bookingId: true },
  });
  const foundSession = notFoundIfMissing(session);
  if (!foundSession.ok) return foundSession.response;
  const s = foundSession.resource;

  // 종료·차단 세션엔 발송 불가(reply와 동일 — 방문자에게 전달되지 않음).
  if (s.status === "CLOSED" || s.status === "BLOCKED") {
    return NextResponse.json({ error: "SESSION_NOT_OPEN", status: s.status }, { status: 409 });
  }

  // 미연결이면 발송 불가.
  if (!s.bookingId) {
    return NextResponse.json({ error: "not_linked" }, { status: 400 });
  }

  // 예약 로드 — 토큰 만료 계산(checkOut) + 영수증 게이트(status·checkOutRecord)용. 금액 미조회.
  const booking = await prisma.booking.findUnique({
    where: { id: s.bookingId },
    select: {
      id: true,
      checkOut: true,
      status: true,
      checkOutRecord: { select: { id: true } },
    },
  });
  // relation onDelete SetNull이라 정상적으로는 존재하지만, 방어적으로 미연결 취급.
  if (!booking) {
    return NextResponse.json({ error: "not_linked" }, { status: 400 });
  }

  // receipt는 체크아웃 완료 예약만(영수증 페이지 ready 조건과 동일: CHECKED_OUT && CheckOutRecord 존재).
  if (kind === "receipt") {
    const checkedOut = booking.status === "CHECKED_OUT" && booking.checkOutRecord != null;
    if (!checkedOut) {
      return NextResponse.json({ error: "not_checked_out" }, { status: 400 });
    }
  }

  // ── 토큰 확보: 활성(미회수·미만료) 있으면 재사용, 없으면 발급 ──
  //   ★기존 guest-token POST(app/api/bookings/[id]/guest-token/route.ts)는 무조건 재발급(구 토큰 무효화)이라
  //     여기서는 재사용 분기를 별도로 둔다(이미 QR·링크로 전달된 토큰을 깨지 않기 위함 — 기획 §C). 발급 시맨틱
  //     (generateGuestToken + defaultGuestTokenExpiry + upsert revokedAt:null)은 기존 라우트와 동일.
  const now = new Date();
  const existingToken = await prisma.guestCheckinToken.findUnique({
    where: { bookingId: booking.id },
    select: { token: true, expiresAt: true, revokedAt: true },
  });

  let token: string;
  let tokenReused: boolean;
  if (existingToken && isGuestTokenUsable(existingToken, now)) {
    token = existingToken.token;
    tokenReused = true;
  } else {
    token = generateGuestToken();
    const expiresAt = defaultGuestTokenExpiry(booking.checkOut);
    await prisma.guestCheckinToken.upsert({
      where: { bookingId: booking.id },
      create: { bookingId: booking.id, token, expiresAt },
      update: { token, expiresAt, revokedAt: null },
    });
    tokenReused = false;
  }

  // URL 구성 — base + /g/<token>(+ /options | /receipt). base 미설정이면 상대경로(위젯 동일 오리진).
  const base = appBaseUrl();
  const path = `/g/${token}${kindPathSuffix(kind)}`;
  const url = base ? `${base}${path}` : path;

  // 방문자 언어 사전 번역 문구 조립(Gemini 미경유).
  const rendered = renderLinkMessage(kind, s.visitorLocale, url);
  const preview = previewText(rendered.ko);
  const expiresAt = computeExpiresAt(now);

  // 메시지 생성 + 세션 비정규화 갱신(reply와 동일 트랜잭션 패턴).
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.webChatMessage.create({
      data: {
        sessionId: s.id,
        direction: "OUTBOUND",
        text: rendered.ko, // ko 원문
        sourceLocale: "ko",
        translatedText: rendered.visitor, // 방문자 언어 완성문(번역 미경유)
        translatedTo: rendered.visitorLocale,
        translationFailed: false,
        sentBy: g.userId,
      },
      select: { id: true, createdAt: true },
    });
    await tx.webChatSession.update({
      where: { id: s.id },
      data: {
        lastMessageText: preview,
        lastMessageDirection: "OUTBOUND",
        lastMessageAt: created.createdAt,
        expiresAt, // 슬라이딩 연장
        // unreadForAdmin 미증가(운영자 자신의 발신)
      },
    });
    return created;
  });

  // 실시간 신호(식별만) — best-effort. 활성 운영자 전원 채널로 fan-out.
  try {
    const operatorIds = await listActiveOperatorIds();
    for (const opId of operatorIds) {
      publish(opId, { type: "outbound", conversationId: s.id, source: "webchat" });
    }
  } catch {
    /* 신호 실패는 무해 */
  }

  // 감사 로그 — 무엇을(kind) 어느 예약(bookingId)에 발송했는지 + 토큰 재사용 여부.
  await writeAuditLog({
    userId: g.userId,
    action: "CREATE",
    entity: "WebChatMessage",
    entityId: message.id,
    changes: {
      sessionId: { new: s.id },
      direction: { new: "OUTBOUND" },
      linkKind: { new: kind },
      bookingId: { new: booking.id },
      tokenReused: { new: tokenReused },
    },
  });

  return NextResponse.json({
    ok: true,
    message: {
      id: message.id,
      createdAt: message.createdAt.toISOString(),
      translationFailed: false,
    },
  });
}
