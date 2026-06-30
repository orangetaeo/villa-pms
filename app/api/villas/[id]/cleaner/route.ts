// PATCH /api/villas/[id]/cleaner — 빌라 청소 담당자 지정/해제 (T-villa-cleaner-assign)
//   cleanerId 설정(role=CLEANER·미삭제 검증) 또는 null(미지정=공급자 담당 폴백).
//   ★ 지정 즉시 그 빌라의 미완료 청소(PENDING/REJECTED/PHOTOS_SUBMITTED)를 담당자에게 재배정
//      (APPROVED는 이력 보존). 신규 체크아웃·정기 청소는 생성 시점에 자동 배정(lib/cleaning).
//   권한: isOperator. 누수: 마진·가격 아님(운영 배정 데이터).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const bodySchema = z.object({
  // null = 미지정(공급자 담당 폴백)
  cleanerId: z.string().min(1).nullable(),
});

// 미완료 청소 — 담당 변경 시 재배정 대상(승인 완료분은 이력 보존).
const OPEN_STATUSES = ["PENDING", "REJECTED", "PHOTOS_SUBMITTED"] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const nextCleanerId = parsed.data.cleanerId;

  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, cleanerId: true },
  });
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 담당자 지정 시 — 실제 CLEANER·미삭제 사용자만 허용(엉뚱한 역할 배정 차단)
  if (nextCleanerId) {
    const cleaner = await prisma.user.findFirst({
      where: { id: nextCleanerId, role: "CLEANER", deletedAt: null },
      select: { id: true },
    });
    if (!cleaner) {
      return NextResponse.json({ error: "INVALID_CLEANER" }, { status: 400 });
    }
  }

  if (nextCleanerId === villa.cleanerId) {
    return NextResponse.json({ cleanerId: villa.cleanerId }); // 변화 없음 — 멱등
  }

  let reassigned = 0;
  await prisma.$transaction(async (tx) => {
    await tx.villa.update({
      where: { id: villa.id },
      data: { cleanerId: nextCleanerId },
    });
    // 이 빌라의 미완료 청소를 새 담당자에게 즉시 재배정(미지정이면 null=공급자 담당).
    const res = await tx.cleaningTask.updateMany({
      where: { villaId: villa.id, status: { in: [...OPEN_STATUSES] } },
      data: { assigneeId: nextCleanerId },
    });
    reassigned = res.count;
    await writeAuditLog({
      db: tx,
      userId: g.session.user.id,
      action: "UPDATE",
      entity: "Villa",
      entityId: villa.id,
      changes: {
        cleanerId: { old: villa.cleanerId, new: nextCleanerId },
        reassignedOpenTasks: { new: reassigned },
      },
    });
  });

  return NextResponse.json({ cleanerId: nextCleanerId, reassigned });
}
