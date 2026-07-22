// POST /api/villas/[id]/clips/presign — 빌라 영상 클립 R2 presigned PUT URL 발급 (villa-clip-narration P1)
//
// 권한(첫 줄): SUPPLIER는 **자기 빌라만**, 운영자(isOperator)는 전체. 그 외 403.
//   타인 빌라·미존재 빌라는 동일하게 404 — 빌라 존재 자체를 누설하지 않는다(photos 라우트와 동일 규약).
// 흐름: {contentType, sizeBytes} 검증 → 서버가 키 확정 → presigned PUT URL 반환
//        → 브라우저가 그 URL로 파일 직접 PUT(서버 미경유) → POST /api/villas/[id]/clips 로 커밋.
//
// ★ 여기서 받는 sizeBytes는 **클라 신고값**이다 — 조기 거절(헛된 업로드 방지)에만 쓰고 신뢰하지 않는다.
//   실제 크기·길이·해상도는 커밋 라우트가 R2 HeadObject + ffprobe로 실측한다.
// ★ 누수 0: 금액 필드를 조회·반환하지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-guard";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import {
  isAllowedClipMime,
  isR2Configured,
  villaClipKey,
  presignR2PutUrl,
} from "@/lib/storage";
import { loadVillaClipPolicy } from "@/lib/villa-clip";

export const dynamic = "force-dynamic";

const PRESIGN_EXPIRES_SEC = 900; // 15분 — 모바일 회선에서 80MB 업로드 여유

const bodySchema = z.object({
  contentType: z.string().trim().toLowerCase().max(100),
  sizeBytes: z.number().int().positive(),
  // 표시용일 뿐 저장 키에 미사용(경로 주입·위장 차단) — 감사 로그에만 남긴다.
  fileName: z.string().max(200).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const { role, id: userId } = g.session.user;
  if (role !== "SUPPLIER" && !isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id: villaId } = await params;

  if (!isR2Configured()) {
    // 디스크 폴백 환경(로컬 개발)에서는 브라우저 직업로드 불가.
    return NextResponse.json({ error: "R2_NOT_CONFIGURED" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { contentType, sizeBytes, fileName } = parsed.data;

  if (!isAllowedClipMime(contentType)) {
    return NextResponse.json(
      { error: "DISALLOWED_TYPE", allowed: ["video/mp4", "video/quicktime"] },
      { status: 400 }
    );
  }

  // 빌라 스코프 — SUPPLIER는 자기 빌라만. 타인 빌라·미존재 모두 404.
  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: { id: true, supplierId: true },
  });
  if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const policy = await loadVillaClipPolicy(prisma);

  // 신고 크기 조기 거절 — 통과해도 커밋 단계에서 실측 재검증한다.
  if (sizeBytes > policy.maxBytes) {
    return NextResponse.json(
      { error: "TOO_LARGE", maxBytes: policy.maxBytes },
      { status: 400 }
    );
  }

  // 쿼터 — 커밋된 클립(UPLOADING 제외)만 센다. 미완료 업로드가 자리를 잡아먹지 않게.
  const existingCount = await prisma.villaClip.count({
    where: { villaId, status: { not: "UPLOADING" } },
  });
  if (existingCount >= policy.maxPerVilla) {
    return NextResponse.json(
      { error: "QUOTA_EXCEEDED", maxPerVilla: policy.maxPerVilla },
      { status: 409 }
    );
  }

  const key = villaClipKey(contentType);
  let uploadUrl: string;
  try {
    uploadUrl = presignR2PutUrl(key, PRESIGN_EXPIRES_SEC);
  } catch {
    return NextResponse.json({ error: "PRESIGN_FAILED" }, { status: 503 });
  }

  // 글로벌 규칙 — 업로드 의도 기록(실제 PUT은 브라우저→R2 직결이라 서버가 완료 시점을 모른다).
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "VillaClipUpload",
    entityId: key,
    changes: {
      villaId: { new: villaId },
      fileName: { new: fileName ?? "" },
      contentType: { new: contentType },
      declaredSizeBytes: { new: String(sizeBytes) },
    },
  });

  return NextResponse.json({
    key,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": contentType },
    expiresSec: PRESIGN_EXPIRES_SEC,
    policy: {
      maxBytes: policy.maxBytes,
      maxDurationSec: policy.maxDurationSec,
      maxPerVilla: policy.maxPerVilla,
      remaining: policy.maxPerVilla - existingCount,
    },
  });
}
