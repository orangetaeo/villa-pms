// GET/PUT /api/instagram/settings — 인스타 연동 설정 (admin)
// 권한(첫 줄): GET=isOperator(설정 조회), PUT=isSystemAdmin(토큰·설정 변경은 시스템 통제, OWNER/ADMIN 전용).
// ★ 토큰: write-only. GET은 설정 여부 + 말미 4자만(평문 절대 미노출). PUT은 빈 문자열이면 기존 토큰 보존.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isOperator, isSystemAdmin } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import {
  getIgUserId,
  getIgGraphBase,
  getIgAccessTokenMeta,
  isAutopostPaused,
  setIgUserId,
  setIgAccessToken,
  setAutopostPaused,
} from "@/lib/instagram/settings";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const [userId, graphBase, tokenMeta, paused] = await Promise.all([
    getIgUserId(),
    getIgGraphBase(),
    getIgAccessTokenMeta(),
    isAutopostPaused(),
  ]);

  return NextResponse.json({
    igUserId: userId,
    graphBase,
    accessTokenSet: tokenMeta.set,
    accessTokenLast4: tokenMeta.last4, // 말미 4자만(평문 아님)
    autopostPaused: paused,
  });
}

const putSchema = z
  .object({
    igUserId: z.string().trim().max(64).optional(),
    accessToken: z.string().trim().max(1000).optional(), // 빈 문자열이면 기존값 보존(setIgAccessToken 내부 무시)
    autopostPaused: z.boolean().optional(),
  })
  .refine(
    (d) => d.igUserId !== undefined || d.accessToken !== undefined || d.autopostPaused !== undefined,
    { message: "변경할 필드가 없습니다" }
  );

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // 토큰·설정 변경은 시스템 통제 — OWNER/ADMIN만.
  if (!isSystemAdmin(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }

  const changes: Record<string, { new?: unknown }> = {};

  if (parsed.data.igUserId !== undefined) {
    await setIgUserId(parsed.data.igUserId);
    changes.igUserId = { new: parsed.data.igUserId };
  }
  if (parsed.data.accessToken !== undefined && parsed.data.accessToken.length > 0) {
    await setIgAccessToken(parsed.data.accessToken);
    // ★ 토큰 평문·암호문 절대 감사로그 미기록 — 설정 사실만.
    changes.accessToken = { new: "***set***" };
  }
  if (parsed.data.autopostPaused !== undefined) {
    await setAutopostPaused(parsed.data.autopostPaused);
    changes.autopostPaused = { new: parsed.data.autopostPaused };
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: "IG_SETTINGS",
    changes,
  });

  const [userId, tokenMeta, paused] = await Promise.all([
    getIgUserId(),
    getIgAccessTokenMeta(),
    isAutopostPaused(),
  ]);
  return NextResponse.json({
    igUserId: userId,
    accessTokenSet: tokenMeta.set,
    accessTokenLast4: tokenMeta.last4,
    autopostPaused: paused,
  });
}
