// DELETE /api/villas/[id]/rate-periods/batch/[batchId] — 일괄 작업 그룹 취소 (rate-calendar-ux)
// 같은 batchId로 묶인 레이어들을 한 번에 삭제("이 작업 전체 취소"). villaId 스코프 필수(타 빌라 차단).
// base는 batchId를 갖지 않으므로 안전(삭제 대상에서 자연 제외). 권한 ADMIN(canSetPrice). writeAuditLog 필수.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> }
) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const actorUserId = g.session.user.id;
  const { id, batchId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    // villaId 스코프 강제 — batchId만으로 타 빌라 그룹 삭제 불가
    const del = await tx.villaRatePeriod.deleteMany({ where: { villaId: id, batchId } });
    if (del.count > 0) {
      await writeAuditLog({
        db: tx,
        userId: actorUserId,
        action: "DELETE",
        entity: "VillaRatePeriod",
        entityId: id,
        changes: { batch: { old: { batchId, deleted: del.count } } },
      });
    }
    return del.count;
  });

  // 그룹이 비어 있어도(이미 취소됨) 멱등 200 — deleted 개수로 결과 전달
  return NextResponse.json({ batchId, deleted: result });
}
