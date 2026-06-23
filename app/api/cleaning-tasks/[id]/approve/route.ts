import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approveCleaningTask, CleaningTransitionError } from "@/lib/cleaning";
import { isOperator } from "@/lib/permissions";

/** POST /api/cleaning-tasks/[id]/approve — 검수 승인 → 게이트 규칙 통과 시 isSellable=true (ADMIN 전용) */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

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
