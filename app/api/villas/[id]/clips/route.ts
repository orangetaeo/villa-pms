// GET/POST /api/villas/[id]/clips — 빌라 영상 클립 목록 조회 / 업로드 커밋 (villa-clip-narration P1)
//
// 권한(첫 줄): SUPPLIER는 자기 빌라만, 운영자는 전체. 타인 빌라·미존재는 404(존재 누설 차단).
//
// POST(커밋)가 이 기능의 보안 핵심이다:
//   presigned PUT은 브라우저→R2 직결이라 서버가 업로드를 중계하지 않는다 → presign 때 받은 sizeBytes는
//   클라 신고값일 뿐이다. 따라서 여기서 **R2 HeadObject(실제 크기) + ffprobe(길이·해상도)**로 실측하고,
//   정책 위반이면 R2 객체를 지운 뒤 거부한다. 통과분만 UPLOADED 행으로 남는다.
//
// ★ 누수 0: 금액(원가·마진·판매가) 필드를 조회·반환하지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-guard";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { PHOTO_SPACES } from "@/lib/villa-schema";
import { isVillaClipKey, villaClipPublicUrl, deleteR2Object } from "@/lib/storage";
import {
  loadVillaClipPolicy,
  probeR2Clip,
  checkClipAgainstPolicy,
  rejectStatus,
} from "@/lib/villa-clip";
import { maybeNotifyVillaContentUpdated } from "@/lib/villa-notify";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  key: z.string().min(1).max(200),
  space: z.enum(PHOTO_SPACES).optional(),
  note: z.string().trim().max(300).optional(),
});

// 목록·상세 응답 필드 — 화이트리스트로 고정(모델 컬럼 추가 시 자동 노출 방지)
const CLIP_SELECT = {
  id: true,
  url: true,
  mimeType: true,
  sizeBytes: true,
  durationSec: true,
  width: true,
  height: true,
  space: true,
  note: true,
  status: true,
  rejectionReason: true,
  reviewedAt: true,
  uploadedBy: true,
  createdAt: true,
} as const;

/** 빌라 스코프 확인 — SUPPLIER는 자기 빌라만. 타인 빌라·미존재 모두 null(404로 수렴). */
async function resolveVilla(villaId: string, role: string, userId: string) {
  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: { id: true, supplierId: true },
  });
  if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) return null;
  return villa;
}

// ===================== GET — 클립 목록 =====================
export async function GET(
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

  const villa = await resolveVilla(villaId, role, userId);
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // UPLOADING 제외 — P1에서 이 상태 행은 생기지 않지만(커밋 시 UPLOADED로 직접 생성),
  //   재개 가능 업로드 도입 시 미완료분이 목록에 새지 않도록 필터를 미리 건다.
  const clips = await prisma.villaClip.findMany({
    where: { villaId, status: { not: "UPLOADING" } },
    select: CLIP_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const policy = await loadVillaClipPolicy(prisma);
  return NextResponse.json({
    clips,
    policy: {
      maxBytes: policy.maxBytes,
      maxDurationSec: policy.maxDurationSec,
      maxPerVilla: policy.maxPerVilla,
      remaining: Math.max(0, policy.maxPerVilla - clips.length),
    },
  });
}

// ===================== POST — 업로드 커밋 (실측 검증) =====================
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { key, space, note } = parsed.data;

  // presign이 발급한 형식의 키만 허용 — 임의 R2 키 등록(타 오브젝트 참조) 차단.
  if (!isVillaClipKey(key)) {
    return NextResponse.json({ error: "INVALID_KEY" }, { status: 400 });
  }

  const villa = await resolveVilla(villaId, role, userId);
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 같은 키 재커밋 차단(중복 행 방지). r2Key는 @unique이지만 먼저 걸러 409로 명확히 응답.
  const dup = await prisma.villaClip.findUnique({ where: { r2Key: key }, select: { id: true } });
  if (dup) return NextResponse.json({ error: "ALREADY_COMMITTED" }, { status: 409 });

  const policy = await loadVillaClipPolicy(prisma);

  // ── 서버 실측: HeadObject(크기) + ffprobe(길이·표시 해상도) ──
  //   ★ maxBytes를 넘겨 **다운로드 전에** 크기를 끊는다(QA H-2): presigned PUT엔 크기 제약이 없어
  //     신고값과 무관하게 수 GB를 올릴 수 있고, 그걸 받아본 뒤 거부하면 OOM·egress 비용이 터진다.
  const probed = await probeR2Clip(key, policy.maxBytes);
  if (!probed.ok) {
    // ★ 실패분은 스토리지에 남기지 않는다 — 정리 cron이 아직 없어 고아가 영구 누적된다(QA H-2).
    await deleteR2Object(key);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entity: "VillaClipUpload",
      entityId: key,
      changes: { villaId: { old: villaId }, rejected: { new: probed.reason } },
    });
    const status = probed.reason === "TOO_LARGE" ? 400 : 400;
    return NextResponse.json(
      probed.reason === "TOO_LARGE"
        ? { error: "TOO_LARGE", maxBytes: policy.maxBytes }
        : { error: "UPLOAD_NOT_FOUND_OR_INVALID" },
      { status }
    );
  }
  const probe = probed.probe;

  const existingCount = await prisma.villaClip.count({
    where: { villaId, status: { not: "UPLOADING" } },
  });
  const check = checkClipAgainstPolicy(probe, policy, existingCount);
  if (!check.ok) {
    // 정책 위반분은 스토리지에 남기지 않는다(쿼터 우회·비용 누수 방지).
    await deleteR2Object(key);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entity: "VillaClipUpload",
      entityId: key,
      changes: {
        villaId: { old: villaId },
        rejected: { new: check.reason },
        sizeBytes: { old: String(probe.sizeBytes) },
        durationSec: { old: String(Math.round(probe.durationSec)) },
      },
    });
    return NextResponse.json(
      {
        error: check.reason,
        maxBytes: policy.maxBytes,
        maxDurationSec: policy.maxDurationSec,
        maxPerVilla: policy.maxPerVilla,
      },
      { status: rejectStatus(check.reason) }
    );
  }

  const mimeType = key.endsWith(".mov") ? "video/quicktime" : "video/mp4";
  const clip = await prisma.$transaction(async (tx) => {
    const created = await tx.villaClip.create({
      data: {
        villaId,
        r2Key: key,
        url: villaClipPublicUrl(key),
        mimeType,
        sizeBytes: probe.sizeBytes,
        durationSec: Math.round(probe.durationSec),
        width: probe.width,
        height: probe.height,
        space: space ?? null,
        note: note ?? null,
        status: "UPLOADED", // 검수 대기 — 마케팅 소재로는 APPROVED만 사용(검수 게이트)
        uploadedBy: userId, // 증빙: 업로더 기록 (createdAt은 @default(now()))
      },
      select: CLIP_SELECT,
    });

    // 글로벌 규칙 — 변경 추적. 실측값을 남겨 사후 분쟁·용량 감사에 쓴다.
    await writeAuditLog({
      db: tx,
      userId,
      action: "CREATE",
      entity: "VillaClip",
      entityId: created.id,
      changes: {
        villaId: { new: villaId },
        r2Key: { new: key },
        sizeBytes: { new: String(probe.sizeBytes) },
        durationSec: { new: String(Math.round(probe.durationSec)) },
        resolution: { new: `${probe.width}x${probe.height}` },
      },
    });

    return created;
  });

  // 승인(ACTIVE)된 빌라를 공급자가 수정한 경우만 운영자 통지 (best-effort·PENDING dedup)
  await maybeNotifyVillaContentUpdated(prisma, { villaId, kind: "CLIPS", actorRole: role });

  return NextResponse.json(clip, { status: 201 });
}
