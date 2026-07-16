// POST /api/youtube/clips/presign — 직접 촬영 클립 R2 presigned PUT URL 발급 (marketing-s2 §A-1)
// 권한(첫 줄): isOperator(ADMIN 계열)만. SUPPLIER/VENDOR/PARTNER 403.
// 흐름: {fileName, contentType, sizeBytes} → 화이트리스트(mp4/mov)·크기(≤500MB) 검증 → 서버가 클립 키 확정
//   → presigned PUT URL 반환. 브라우저가 이 URL로 파일을 직접 PUT(서버 미경유). 반환 key를 편집 잡 clips[].key로 사용.
// ★ 클라 fileName은 표시용일 뿐 저장 키에 미사용(경로 주입·위장 차단) — 키는 youtubeClipKey가 cuid로 생성.
// ★ R2 미설정 환경(로컬 디스크 폴백)에서는 직업로드 불가 → 503.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import {
  isAllowedClipMime,
  isR2Configured,
  youtubeClipKey,
  presignR2PutUrl,
  YT_CLIP_MAX_BYTES,
} from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const PRESIGN_EXPIRES_SEC = 600; // 10분

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2_NOT_CONFIGURED" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const contentType = typeof b.contentType === "string" ? b.contentType.trim().toLowerCase() : "";
  const sizeBytes = typeof b.sizeBytes === "number" && Number.isFinite(b.sizeBytes) ? b.sizeBytes : NaN;
  const fileName = typeof b.fileName === "string" ? b.fileName.slice(0, 200) : "";

  if (!isAllowedClipMime(contentType)) {
    return NextResponse.json({ error: "DISALLOWED_TYPE", allowed: ["video/mp4", "video/quicktime"] }, { status: 400 });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "SIZE_REQUIRED" }, { status: 400 });
  }
  if (sizeBytes > YT_CLIP_MAX_BYTES) {
    return NextResponse.json({ error: "TOO_LARGE", maxBytes: YT_CLIP_MAX_BYTES }, { status: 400 });
  }

  const key = youtubeClipKey(contentType);
  let uploadUrl: string;
  try {
    uploadUrl = presignR2PutUrl(key, PRESIGN_EXPIRES_SEC);
  } catch {
    return NextResponse.json({ error: "PRESIGN_FAILED" }, { status: 503 });
  }

  // 감사 로그 — 업로드 의도 기록(실제 PUT은 브라우저→R2 직결이라 서버가 완료 시점을 모름).
  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "YoutubeClipUpload",
    entityId: key,
    changes: { fileName: { new: fileName }, contentType: { new: contentType }, sizeBytes: { new: sizeBytes } },
  });

  return NextResponse.json({
    key,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": contentType },
    expiresSec: PRESIGN_EXPIRES_SEC,
  });
}
