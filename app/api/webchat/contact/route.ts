// POST /api/webchat/contact — 방문자 연락처 남기기(프로그레시브 수집, D10) (T-webchat-mvp)
//
// 비로그인: 쿠키 세션 스코프 강제. 이탈 후 회신의 유일한 수단(Zalo 우선). +AuditLog(익명=userId null).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { WEBCHAT_COOKIE, readSessionIdFromRequest } from "@/lib/webchat";

const schema = z
  .object({
    email: z.string().trim().email().max(200).optional(),
    zalo: z.string().trim().min(1).max(100).optional(),
    kakao: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => !!(v.email || v.zalo || v.kakao), { message: "at least one" });

export async function POST(req: Request) {
  const sessionId = readSessionIdFromRequest(req);
  if (!sessionId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

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

  const session = await prisma.webChatSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.status === "BLOCKED") {
    const res = NextResponse.json({ ok: false, reason: "blocked" }, { status: 403 });
    return res;
  }

  const { email, zalo, kakao } = parsed.data;
  await prisma.webChatSession.update({
    where: { id: session.id },
    data: {
      ...(email ? { contactEmail: email } : {}),
      ...(zalo ? { contactZalo: zalo } : {}),
      ...(kakao ? { contactKakao: kakao } : {}),
    },
  });

  // 감사 로그 — 익명 행위(userId null), attribution은 entity+entityId. 값은 저장 사실만(원문 미기록).
  await writeAuditLog({
    userId: null,
    action: "UPDATE",
    entity: "WebChatSession",
    entityId: session.id,
    changes: {
      contact: {
        new: {
          email: email ? true : undefined,
          zalo: zalo ? true : undefined,
          kakao: kakao ? true : undefined,
        },
      },
    },
  });

  return NextResponse.json({ ok: true });
}
