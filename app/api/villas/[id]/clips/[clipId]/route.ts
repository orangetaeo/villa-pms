// PATCH/DELETE /api/villas/[id]/clips/[clipId] — 클립 검수(승인·반려) / 메타 수정 / 삭제
// (villa-clip-narration P1)
//
// 권한(첫 줄):
//   - PATCH `status`(승인·반려) = **운영자 전용**. 공급자는 자기 영상을 스스로 승인할 수 없다(검수 게이트 원칙3).
//   - PATCH `space`·`note`(메타) = 공급자(자기 빌라)·운영자.
//   - DELETE = 공급자(자기 빌라)·운영자. R2 원본도 함께 정리(best-effort).
// 타인 빌라·미존재·타 빌라 소속 clipId는 모두 404(스코프 누설 차단).
//
// ★ 누수 0: 금액 필드를 조회·반환하지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-guard";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { PHOTO_SPACES } from "@/lib/villa-schema";
import { deleteR2Object } from "@/lib/storage";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]).optional(),
    rejectionReason: z.string().trim().max(300).optional(),
    space: z.enum(PHOTO_SPACES).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.space !== undefined || v.note !== undefined, {
    message: "NO_FIELDS",
  });

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
  createdAt: true,
} as const;

// ===================== PATCH — 검수 / 메타 수정 =====================
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const { role, id: userId } = g.session.user;
  if (role !== "SUPPLIER" && !isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id: villaId, clipId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 검수(승인·반려)는 운영자만 — 공급자가 자기 영상을 승인하면 검수 게이트가 무의미해진다.
  if (data.status !== undefined && !isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true },
    });
    if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) {
      return { kind: "NOT_FOUND" as const };
    }

    const clip = await tx.villaClip.findUnique({
      where: { id: clipId },
      select: { id: true, villaId: true, status: true, space: true, note: true },
    });
    // 없거나 다른 빌라 소속이면 404 (스코프 누설 차단)
    if (!clip || clip.villaId !== villaId) return { kind: "NOT_FOUND" as const };
    // 커밋 전(UPLOADING) 행은 사용자 조작 대상이 아니다.
    if (clip.status === "UPLOADING") return { kind: "NOT_FOUND" as const };

    const update: {
      status?: "APPROVED" | "REJECTED";
      rejectionReason?: string | null;
      reviewedBy?: string;
      reviewedAt?: Date;
      space?: (typeof PHOTO_SPACES)[number] | null;
      note?: string | null;
    } = {};
    const changes: Record<string, { old?: string; new?: string }> = {};

    if (data.status !== undefined) {
      update.status = data.status;
      // 반려 사유는 반려일 때만 유지 — 승인 시 이전 사유를 지운다(재검수 흔적은 AuditLog에 남는다).
      update.rejectionReason = data.status === "REJECTED" ? (data.rejectionReason ?? null) : null;
      update.reviewedBy = userId;
      update.reviewedAt = new Date();
      changes.status = { old: clip.status, new: data.status };
      if (data.status === "REJECTED" && data.rejectionReason) {
        changes.rejectionReason = { new: data.rejectionReason };
      }
    }
    if (data.space !== undefined) {
      update.space = data.space;
      changes.space = { old: clip.space ?? "", new: data.space ?? "" };
    }
    if (data.note !== undefined) {
      update.note = data.note;
      changes.note = { old: clip.note ?? "", new: data.note ?? "" };
    }

    const updated = await tx.villaClip.update({
      where: { id: clip.id },
      data: update,
      select: CLIP_SELECT,
    });

    // 글로벌 규칙 — 변경 추적(승인·반려 주체와 사유가 남아야 분쟁 대응이 된다)
    await writeAuditLog({
      db: tx,
      userId,
      action: "UPDATE",
      entity: "VillaClip",
      entityId: clip.id,
      changes: { villaId: { old: villaId }, ...changes },
    });

    return { kind: "OK" as const, clip: updated };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(result.clip);
}

// ===================== DELETE — 클립 삭제 (R2 원본 포함) =====================
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const { role, id: userId } = g.session.user;
  if (role !== "SUPPLIER" && !isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id: villaId, clipId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true },
    });
    if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) {
      return { kind: "NOT_FOUND" as const };
    }

    const clip = await tx.villaClip.findUnique({
      where: { id: clipId },
      select: { id: true, villaId: true, r2Key: true, status: true, sizeBytes: true },
    });
    if (!clip || clip.villaId !== villaId) return { kind: "NOT_FOUND" as const };

    await tx.villaClip.delete({ where: { id: clip.id } });

    // 글로벌 규칙 — 삭제 추적. r2Key를 남겨 사후 스토리지 대조가 가능하게.
    await writeAuditLog({
      db: tx,
      userId,
      action: "DELETE",
      entity: "VillaClip",
      entityId: clip.id,
      changes: {
        villaId: { old: villaId },
        r2Key: { old: clip.r2Key },
        status: { old: clip.status },
        sizeBytes: { old: String(clip.sizeBytes) },
      },
    });

    return { kind: "OK" as const, clipId: clip.id, r2Key: clip.r2Key };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 스토리지 정리는 트랜잭션 밖에서 best-effort — 실패해도 삭제 요청은 성공(고아는 정리 cron 대상).
  await deleteR2Object(result.r2Key);
  return NextResponse.json({ deleted: result.clipId });
}
