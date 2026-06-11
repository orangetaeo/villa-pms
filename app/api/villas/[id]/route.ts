// PATCH /api/villas/[id] — ADMIN 빌라 상태 변경 (T1.2, SPEC F1 승인 게이트)
// 전이 규칙: APPROVE PENDING_REVIEW→ACTIVE / DEACTIVATE ACTIVE→INACTIVE / REACTIVATE INACTIVE→ACTIVE
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { createInitialInspectionTask } from "@/lib/cleaning";
import type { VillaStatus } from "@prisma/client";

const patchSchema = z.object({
  action: z.enum(["APPROVE", "DEACTIVATE", "REACTIVATE"]),
});

// 허용 전이표 — 그 외 전이는 409
const TRANSITIONS: Record<
  z.infer<typeof patchSchema>["action"],
  { from: VillaStatus; to: VillaStatus }
> = {
  APPROVE: { from: "PENDING_REVIEW", to: "ACTIVE" },
  DEACTIVATE: { from: "ACTIVE", to: "INACTIVE" },
  REACTIVATE: { from: "INACTIVE", to: "ACTIVE" },
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

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

  const transition = TRANSITIONS[parsed.data.action];

  // 트랜잭션 안에서 현재 상태 확인 + 전이 — 동시 요청 간 전이 규칙 위반 방지
  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!villa) return { kind: "NOT_FOUND" as const };
    if (villa.status !== transition.from) {
      return { kind: "CONFLICT" as const, current: villa.status };
    }
    const updated = await tx.villa.update({
      where: { id },
      data: { status: transition.to },
      select: { id: true, status: true },
    });

    // T3.4b (ADR-0006): 최초 승인 시 초기 검수 태스크 — 검수 이력 있으면 null (멱등).
    // 게이트 개방은 여전히 검수 승인 경로 단일 — 여기서 isSellable을 만지지 않는다
    const initialTask =
      parsed.data.action === "APPROVE"
        ? await createInitialInspectionTask(tx, {
            villaId: id,
            actorUserId: session.user.id,
            now: new Date(),
          })
        : null;

    return {
      kind: "OK" as const,
      oldStatus: villa.status,
      villa: updated,
      initialInspectionCreated: initialTask !== null,
    };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "CONFLICT") {
    return NextResponse.json(
      {
        error: "INVALID_TRANSITION",
        current: result.current,
        action: parsed.data.action,
      },
      { status: 409 }
    );
  }

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "Villa",
    entityId: result.villa.id,
    changes: {
      status: { old: result.oldStatus, new: result.villa.status },
    },
  });

  return NextResponse.json({
    id: result.villa.id,
    status: result.villa.status,
    initialInspectionCreated: result.initialInspectionCreated,
  });
}
