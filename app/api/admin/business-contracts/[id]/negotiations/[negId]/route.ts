// POST /api/admin/business-contracts/[id]/negotiations/[negId] — 협의 수용·거절 (S2). canViewFinance.
//   ACCEPT(+선택 terms) : 계약 조건 갱신 + 협의 ACCEPTED
//   REJECT(+사유 필수)  : 조건 불변 + 협의 REJECTED (사유는 상대방 화면·Zalo에 그대로 노출)
//   ★ SIGNED·VOID 계약의 조건은 절대 바꾸지 않는다(봉인). DRAFT·SENT만 갱신 가능.
//   ★ 원자성: 협의 상태 전이는 where status:OPEN 조건부 update — 동시 해소 레이스 가드.
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { isContractType, parseTerms } from "@/lib/business-contract";
import { negotiationResolveSchema } from "@/lib/contract-negotiation";
import { notifyCounterpartNegotiationResolved } from "@/lib/contract-negotiation-notify";
import type { Prisma } from "@prisma/client";

/** 동시 해소 레이스 표식 — 트랜잭션 롤백용(HTTP 409로 변환). */
class NegotiationRaceError extends Error {}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; negId: string }> },
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;
  const { id, negId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = negotiationResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { action, terms, resolvedNote } = parsed.data;

  const negotiation = await prisma.contractNegotiation.findUnique({
    where: { id: negId },
    select: { id: true, contractId: true, clauseKey: true, status: true, createdById: true },
  });
  if (!negotiation || negotiation.contractId !== id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (negotiation.status !== "OPEN") {
    return NextResponse.json({ error: "ALREADY_RESOLVED", status: negotiation.status }, { status: 409 });
  }

  const contract = await prisma.businessContract.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, locale: true, counterpartId: true },
  });
  if (!contract || !isContractType(contract.type)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 조건 갱신은 미서명 계약에서만. 서명·무효 계약은 봉인(재계약은 VOID 후 신규 — 기존 규칙).
  let termsData: Prisma.InputJsonValue | null = null;
  if (action === "ACCEPT" && terms !== undefined) {
    if (contract.status !== "DRAFT" && contract.status !== "SENT") {
      return NextResponse.json({ error: "NOT_EDITABLE", status: contract.status }, { status: 409 });
    }
    const termsParsed = parseTerms(contract.type, terms);
    if (!termsParsed.success) {
      return NextResponse.json(
        { error: "TERMS_VALIDATION_FAILED", issues: termsParsed.error.flatten() },
        { status: 400 },
      );
    }
    termsData = termsParsed.data as Prisma.InputJsonValue;
  }

  const nextStatus = action === "ACCEPT" ? "ACCEPTED" : "REJECTED";
  const resolvedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      // 조건부 전이 — 동시에 다른 운영자가 해소했으면 count 0 → throw로 트랜잭션 전체 롤백(조건 갱신도 취소).
      const res = await tx.contractNegotiation.updateMany({
        where: { id: negId, status: "OPEN" },
        data: { status: nextStatus, resolvedById: actorId, resolvedNote: resolvedNote ?? null, resolvedAt },
      });
      if (res.count === 0) throw new NegotiationRaceError();
      if (termsData !== null) {
        await tx.businessContract.update({ where: { id }, data: { termsJson: termsData } });
      }
    });
  } catch (e) {
    if (e instanceof NegotiationRaceError) {
      return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
    }
    throw e;
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ContractNegotiation",
    entityId: negId,
    changes: {
      status: { old: "OPEN", new: nextStatus },
      ...(termsData !== null ? { contractTerms: { new: "updated" } } : {}),
      ...(resolvedNote ? { resolvedNote: { new: resolvedNote } } : {}),
    },
  });

  await notifyCounterpartNegotiationResolved(prisma, {
    userId: contract.counterpartId,
    contractId: id,
    negotiationId: negId,
    clauseKey: negotiation.clauseKey,
    accepted: action === "ACCEPT",
    termsChanged: termsData !== null,
    resolvedNote: resolvedNote ?? null,
    locale: contract.locale,
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
