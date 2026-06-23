import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { effectiveProposalStatus } from "@/lib/proposal";
import { ProposalStatus } from "@prisma/client";
import { canSetPrice } from "@/lib/permissions";

/**
 * PATCH /api/proposals/[id] — 제안 회수 (T2.1 b12 회수 버튼)
 * ADMIN 전용. 시각상 유효한 ACTIVE만 REVOKED 전이 — USED/EXPIRED/REVOKED·만료 경과는 409.
 */

const patchSchema = z.object({ action: z.literal("revoke") });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙, 401/403 분리)
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSetPrice(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const now = new Date();

  // 상태 전이 + 감사 로그 원자 기록 (글로벌 절대 규칙)
  // updateMany status 가드(QA D-1): read-then-write는 공개 가예약의 ACTIVE→USED 원자 전이
  // (lib/hold.ts)와 경합 시 USED를 REVOKED로 덮어쓴다 — where에 상태·만료 조건을 넣어 차단
  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.proposal.updateMany({
      where: { id, status: ProposalStatus.ACTIVE, expiresAt: { gt: now } },
      data: { status: ProposalStatus.REVOKED },
    });
    if (count === 0) return null;
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "Proposal",
      entityId: id,
      changes: { status: { old: ProposalStatus.ACTIVE, new: ProposalStatus.REVOKED } },
    });
    return { id, status: ProposalStatus.REVOKED };
  });

  if (!result) {
    // 전이 실패 사유 구분 — 404(미존재) vs 409(시각상 비활성: USED·EXPIRED·REVOKED·만료 경과)
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      select: { status: true, expiresAt: true },
    });
    if (!proposal) return Response.json({ error: "not_found" }, { status: 404 });
    const effective = effectiveProposalStatus(proposal.status, proposal.expiresAt, now);
    return Response.json({ error: "not_active", status: effective }, { status: 409 });
  }

  return Response.json(result);
}
