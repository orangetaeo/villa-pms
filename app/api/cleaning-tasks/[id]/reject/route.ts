import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rejectCleaningTask, CleaningTransitionError } from "@/lib/cleaning";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const rejectSchema = z.object({
  rejectNote: z.string().trim().min(1, "반려 사유는 필수입니다").max(1000),
});

/** POST /api/cleaning-tasks/[id]/reject — 검수 반려(사유 필수), 게이트 닫힌 채 유지 (ADMIN 전용) */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const body = await req.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const task = await rejectCleaningTask(prisma, {
      taskId: id,
      rejectNote: parsed.data.rejectNote,
      actorUserId: session.user.id,
    });
    return Response.json({ task });
  } catch (e) {
    if (e instanceof CleaningTransitionError) {
      return Response.json({ error: "invalid_transition", message: e.message }, { status: 409 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[cleaning-tasks/reject] 실패", e);
    return Response.json({ error: "반려 처리에 실패했습니다" }, { status: 500 });
  }
}
