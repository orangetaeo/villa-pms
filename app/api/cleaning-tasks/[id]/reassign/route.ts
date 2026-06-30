// PATCH /api/cleaning-tasks/[id]/reassign — 개별 청소 1건 담당자 재배정 (운영자 전용)
//   빌라 기본 담당(Villa.cleanerId)과 별개의 일회성 배정. 휴무·과부하 등 상황 대응.
//   assigneeId=CLEANER(미삭제) 또는 null(미지정=공급자 담당). 새 담당자에게 청소요청 알림.
//   ★ 누수: 운영 배정 데이터(마진·가격 아님). 알림 payload에 고객정보·금액 없음.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { NotificationType } from "@prisma/client";

const bodySchema = z.object({
  assigneeId: z.string().min(1).nullable(),
});

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
  const nextAssigneeId = parsed.data.assigneeId;

  const task = await prisma.cleaningTask.findUnique({
    where: { id },
    select: { id: true, assigneeId: true, villa: { select: { name: true } } },
  });
  if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 담당자 지정 시 — 실제 CLEANER·미삭제 사용자만 허용
  if (nextAssigneeId) {
    const cleaner = await prisma.user.findFirst({
      where: { id: nextAssigneeId, role: "CLEANER", deletedAt: null },
      select: { id: true },
    });
    if (!cleaner) {
      return NextResponse.json({ error: "INVALID_CLEANER" }, { status: 400 });
    }
  }

  if (nextAssigneeId === task.assigneeId) {
    return NextResponse.json({ assigneeId: task.assigneeId }); // 변화 없음 — 멱등
  }

  await prisma.$transaction(async (tx) => {
    await tx.cleaningTask.update({
      where: { id: task.id },
      data: { assigneeId: nextAssigneeId },
    });
    // 새 담당자에게 청소요청 알림(미지정으로 바꾼 경우는 알림 없음).
    if (nextAssigneeId) {
      await tx.notification.create({
        data: {
          userId: nextAssigneeId,
          type: NotificationType.CLEANING_REQUEST,
          payload: {
            cleaningTaskId: task.id,
            villaName: task.villa.name,
            reassigned: true,
          },
        },
      });
    }
    await writeAuditLog({
      db: tx,
      userId: g.session.user.id,
      action: "UPDATE",
      entity: "CleaningTask",
      entityId: task.id,
      changes: { assigneeId: { old: task.assigneeId, new: nextAssigneeId } },
    });
  });

  return NextResponse.json({ assigneeId: nextAssigneeId });
}
