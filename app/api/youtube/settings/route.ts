// GET/PUT /api/youtube/settings — 유튜브 연동 설정 (admin)
// 권한(첫 줄): GET=isOperator(설정 조회), PUT=isSystemAdmin(시크릿·설정 변경은 시스템 통제, OWNER/ADMIN 전용).
// ★ 시크릿: write-only. clientSecret은 설정 여부만 노출(평문 절대 미노출). refreshToken은 OAuth callback이 저장 —
//   여기선 연결 여부(설정 여부)만 노출하고 변경하지 않는다. clientSecret은 빈 문자열이면 기존값 보존.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isOperator, isSystemAdmin } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import {
  YT_PRIVACY_STATUSES,
  getYoutubeClientId,
  isYoutubeClientSecretSet,
  isYoutubeRefreshTokenSet,
  isYoutubeAutopostPaused,
  getYoutubePrivacyStatus,
  getYoutubeShortsPerDay,
  getYoutubeDailyUploadCap,
  setYoutubeClientId,
  setYoutubeClientSecret,
  setYoutubeAutopostPaused,
  setYoutubePrivacyStatus,
  setYoutubeShortsPerDay,
  setYoutubeDailyUploadCap,
} from "@/lib/youtube/settings";

/** 설정 화면 표시용 스냅샷 — 시크릿·refresh token 값은 절대 미포함. */
async function readSettingsSnapshot() {
  const [clientId, clientSecretSet, refreshTokenSet, autopostPaused, privacyStatus, shortsPerDay, dailyUploadCap] =
    await Promise.all([
      getYoutubeClientId(),
      isYoutubeClientSecretSet(),
      isYoutubeRefreshTokenSet(),
      isYoutubeAutopostPaused(),
      getYoutubePrivacyStatus(),
      getYoutubeShortsPerDay(),
      getYoutubeDailyUploadCap(),
    ]);
  return {
    clientId, // 평문(비밀성 낮음)
    clientSecretSet, // 설정 여부만(write-only)
    refreshTokenSet, // OAuth 연결 상태(설정 여부만)
    autopostPaused,
    privacyStatus,
    shortsPerDay,
    dailyUploadCap,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  return NextResponse.json(await readSettingsSnapshot());
}

const putSchema = z
  .object({
    clientId: z.string().trim().max(256).optional(),
    clientSecret: z.string().trim().max(512).optional(), // 빈 문자열이면 기존값 보존(setter 내부 무시)
    autopostPaused: z.boolean().optional(),
    privacyStatus: z.enum(YT_PRIVACY_STATUSES).optional(),
    shortsPerDay: z.number().int().min(0).max(10).optional(),
    dailyUploadCap: z.number().int().min(0).max(50).optional(),
  })
  .refine(
    (d) =>
      d.clientId !== undefined ||
      d.clientSecret !== undefined ||
      d.autopostPaused !== undefined ||
      d.privacyStatus !== undefined ||
      d.shortsPerDay !== undefined ||
      d.dailyUploadCap !== undefined,
    { message: "변경할 필드가 없습니다" }
  );

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // 시크릿·설정 변경은 시스템 통제 — OWNER/ADMIN만.
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

  if (parsed.data.clientId !== undefined) {
    await setYoutubeClientId(parsed.data.clientId);
    changes.clientId = { new: parsed.data.clientId };
  }
  if (parsed.data.clientSecret !== undefined && parsed.data.clientSecret.length > 0) {
    await setYoutubeClientSecret(parsed.data.clientSecret);
    // ★ 시크릿 평문·암호문 절대 감사로그 미기록 — 설정 사실만.
    changes.clientSecret = { new: "***set***" };
  }
  if (parsed.data.autopostPaused !== undefined) {
    await setYoutubeAutopostPaused(parsed.data.autopostPaused);
    changes.autopostPaused = { new: parsed.data.autopostPaused };
  }
  if (parsed.data.privacyStatus !== undefined) {
    await setYoutubePrivacyStatus(parsed.data.privacyStatus);
    changes.privacyStatus = { new: parsed.data.privacyStatus };
  }
  if (parsed.data.shortsPerDay !== undefined) {
    await setYoutubeShortsPerDay(parsed.data.shortsPerDay);
    changes.shortsPerDay = { new: parsed.data.shortsPerDay };
  }
  if (parsed.data.dailyUploadCap !== undefined) {
    await setYoutubeDailyUploadCap(parsed.data.dailyUploadCap);
    changes.dailyUploadCap = { new: parsed.data.dailyUploadCap };
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: "YT_SETTINGS",
    changes,
  });

  return NextResponse.json(await readSettingsSnapshot());
}
