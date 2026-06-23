// PATCH /api/services/[id] — 부가서비스 상태 전이/취소 (T7.1, Phase 2)
// 마진 비공개(절대 규칙): ServiceOrder는 원가·판매가 보유 → ADMIN 전용. 첫 줄 role 검사.
import { auth } from "@/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { serializeBigInt } from "@/lib/serialize";
import {
  assertServiceTransition,
  isServiceOrderStatus,
  InvalidServiceTransitionError,
} from "@/lib/service-order";
import { canSetPrice } from "@/lib/permissions";

const patchSchema = z.object({
  status: z.string(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // [QA H-2] ServiceOrder 응답은 priceKrw·costVnd를 포함 → 재무 권한자만(STAFF 차단).
  // 형제 GET /api/bookings/[id]/services와 동일하게 canSetPrice로 게이트(마진 비공개).
  if (!canSetPrice(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const next = parsed.data.status;
  if (!isServiceOrderStatus(next)) {
    return Response.json({ error: "INVALID_STATUS", status: next }, { status: 400 });
  }

  const existing = await prisma.serviceOrder.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

  // 상태 전이표 가드 — 위반은 409 (종결 상태 덮어쓰기·역방향 차단)
  try {
    assertServiceTransition(existing.status, next);
  } catch (e) {
    if (e instanceof InvalidServiceTransitionError) {
      return Response.json(
        { error: "INVALID_TRANSITION", from: existing.status, to: next },
        { status: 409 }
      );
    }
    throw e;
  }

  const updated = await prisma.serviceOrder.update({
    where: { id },
    data: { status: next },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: { status: { old: existing.status, new: next } },
  });

  return Response.json({ service: serializeBigInt(updated) });
}
