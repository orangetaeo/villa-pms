import { prisma } from "@/lib/prisma";
import { approveCleaningTask, CleaningTransitionError } from "@/lib/cleaning";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

/** POST /api/cleaning-tasks/[id]/approve — 검수 승인 → 게이트 규칙 통과 시 isSellable=true (ADMIN 전용) */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", _req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  try {
    const { task, gateOpened } = await approveCleaningTask(prisma, {
      taskId: id,
      actorUserId: session.user.id,
      now: new Date(),
    });
    return Response.json({ task, gateOpened });
  } catch (e) {
    if (e instanceof CleaningTransitionError) {
      return Response.json({ error: "invalid_transition", message: e.message }, { status: 409 });
    }
    console.error("[cleaning-tasks/approve] 실패", e);
    return Response.json({ error: "승인 처리에 실패했습니다" }, { status: 500 });
  }
}
