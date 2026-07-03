import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { submitCleaningPhotos, CleaningTransitionError } from "@/lib/cleaning";
import { isOperator } from "@/lib/permissions";
import { requireAuth } from "@/lib/api-guard";

const submitSchema = z
  .object({
    // max 50 — a4 슬롯 이론 최대 45장(침실·욕실 동적) 수용 (T3.8 QA D-1)
    photoUrls: z.array(z.string().min(1)).min(1, "청소 사진은 1장 이상 필요합니다").max(50),
    // photoUrls와 병렬인 슬롯 id(exterior·bedroom-1…) — 검수 페어링 정렬용. 구클라이언트 호환 optional
    photoSlots: z.array(z.string().min(1).max(30)).max(50).optional(),
  })
  .refine((v) => !v.photoSlots || v.photoSlots.length === v.photoUrls.length, {
    message: "photoSlots는 photoUrls와 길이가 같아야 합니다",
    path: ["photoSlots"],
  });

/**
 * POST /api/cleaning-tasks/[id]/submit — 청소 사진 제출 (SPEC F4 게이트 1단계)
 * 권한: ADMIN / 해당 빌라 SUPPLIER / 배정된 CLEANER — 그 외 403
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  const { role, id: userId } = session.user;

  const { id } = await params;
  const task = await prisma.cleaningTask.findUnique({
    where: { id },
    select: { id: true, assigneeId: true, villa: { select: { supplierId: true } } },
  });
  if (!task) return Response.json({ error: "not_found" }, { status: 404 });

  const allowed =
    isOperator(role) ||
    (role === "SUPPLIER" && task.villa.supplierId === userId) ||
    (role === "CLEANER" && task.assigneeId === userId);
  if (!allowed) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const updated = await submitCleaningPhotos(prisma, {
      taskId: id,
      photoUrls: parsed.data.photoUrls,
      photoSlots: parsed.data.photoSlots,
      actorUserId: userId,
    });
    return Response.json({ task: updated });
  } catch (e) {
    if (e instanceof CleaningTransitionError) {
      return Response.json({ error: "invalid_transition", message: e.message }, { status: 409 });
    }
    console.error("[cleaning-tasks/submit] 실패", e);
    return Response.json({ error: "사진 제출에 실패했습니다" }, { status: 500 });
  }
}
