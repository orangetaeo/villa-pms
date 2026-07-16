// POST /api/instagram/dm/[threadId]/reply — 운영자 DM 답장 발송
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403.
// 24h 창: 스레드 마지막 IN 메시지 receivedAt+24h 초과 시 409 WINDOW_EXPIRED(Meta 정책 — 발송 차단).
//   IN 이력이 없으면 409 NO_INBOUND(우리가 먼저 대화 개시 불가).
// 발송 성공 시 OUT 기록 + AuditLog(본문은 감사로그에 미기록 — PII 최소화, 스레드·길이만).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { sendInstagramDm, recordOutboundDm } from "@/lib/instagram/dm";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_LEN = 1000;

export async function POST(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { threadId } = await params;
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "EMPTY_TEXT" }, { status: 400 });
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json({ error: "TEXT_TOO_LONG", maxLength: MAX_TEXT_LEN }, { status: 400 });
  }

  // 24h 창 판정 — 스레드 마지막 IN(상대 발신) 기준.
  const latestIn = await prisma.instagramMessage.findFirst({
    where: { igThreadId: threadId, direction: "IN" },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  if (!latestIn) {
    return NextResponse.json({ error: "NO_INBOUND" }, { status: 409 });
  }
  const ageMs = Date.now() - latestIn.receivedAt.getTime();
  if (ageMs > WINDOW_MS) {
    return NextResponse.json(
      { error: "WINDOW_EXPIRED", lastInboundAt: latestIn.receivedAt.toISOString() },
      { status: 409 }
    );
  }

  const result = await sendInstagramDm(threadId, text);
  if (!result.ok) {
    // 발송 실패(토큰 만료·Graph 오류) → 502(클라가 재시도 안내).
    return NextResponse.json({ error: "SEND_FAILED", reason: result.reason }, { status: 502 });
  }

  const rec = await recordOutboundDm({ igThreadId: threadId, messageId: result.messageId, text });

  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "InstagramMessage",
    entityId: rec.id,
    // ★ 본문 미기록(PII 최소화) — 스레드·방향·길이만.
    changes: { direction: { new: "OUT" }, threadId: { new: threadId }, textLength: { new: text.length } },
  });

  return NextResponse.json({
    ok: true,
    message: {
      id: rec.id,
      direction: rec.direction,
      text: rec.text,
      receivedAt: rec.receivedAt.toISOString(),
      readByAdmin: rec.readByAdmin,
    },
  });
}
