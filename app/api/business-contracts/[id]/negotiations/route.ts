// POST /api/business-contracts/[id]/negotiations — 상대방(SUPPLIER/VENDOR/PARTNER) 조항 협의 요청 (S2)
//   게이트: 본인 계약 + status=SENT만(DRAFT는 미노출, SIGNED는 봉인, VOID는 종결).
//   같은 조항에 OPEN이 이미 있으면 409 — 중복 요청 스팸 차단.
//   ★ 요청이 접수되면 운영자가 해소할 때까지 서명이 막힌다(sign 라우트의 파생 판정).
//   ★ 누수: 응답에 termsJson·타 계약·금액 없음. 자기가 만든 협의 요약만.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isContractType, isCounterpartRole } from "@/lib/business-contract";
import {
  isNegotiableClause,
  isReasonAllowed,
  negotiationRequestSchema,
} from "@/lib/contract-negotiation";
import { notifyOperatorsNegotiationRequested } from "@/lib/contract-negotiation-notify";
import type { Prisma } from "@prisma/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const { userId, role } = g;
  const { id } = await params;

  if (!isCounterpartRole(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = negotiationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { clauseKey, reason, proposedTiers, note } = parsed.data;

  const contract = await prisma.businessContract.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, counterpartId: true },
  });
  if (!contract || contract.counterpartId !== userId) {
    // 타인 계약은 존재 자체를 숨긴다(열거 방지) — 404.
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (contract.status !== "SENT") {
    return NextResponse.json({ error: "NOT_NEGOTIABLE", status: contract.status }, { status: 409 });
  }
  if (!isContractType(contract.type) || !isNegotiableClause(contract.type, clauseKey)) {
    return NextResponse.json({ error: "CLAUSE_NOT_NEGOTIABLE" }, { status: 400 });
  }
  if (!isReasonAllowed(clauseKey, reason)) {
    return NextResponse.json({ error: "REASON_NOT_ALLOWED" }, { status: 400 });
  }

  // 같은 조항 중복 OPEN 차단 — 운영자가 하나씩 해소할 수 있게.
  const dup = await prisma.contractNegotiation.findFirst({
    where: { contractId: id, clauseKey, status: "OPEN" },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json({ error: "ALREADY_OPEN", negotiationId: dup.id }, { status: 409 });
  }

  const created = await prisma.contractNegotiation.create({
    data: {
      contractId: id,
      clauseKey,
      reason,
      proposedJson: proposedTiers ? ({ cancelTiers: proposedTiers } as Prisma.InputJsonValue) : undefined,
      note: note ?? null,
      status: "OPEN",
      createdById: userId,
    },
    select: { id: true, clauseKey: true, reason: true, status: true, createdAt: true },
  });

  await writeAuditLog({
    db: prisma,
    userId,
    action: "CREATE",
    entity: "ContractNegotiation",
    entityId: created.id,
    changes: {
      contractId: { new: id },
      clauseKey: { new: clauseKey },
      reason: { new: reason },
      hasProposal: { new: proposedTiers ? "yes" : "no" },
    },
  });

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await notifyOperatorsNegotiationRequested(prisma, {
    contractId: id,
    negotiationId: created.id,
    contractType: contract.type,
    counterpartName: me?.name ?? "",
    clauseKey,
    reason,
    hasProposal: Boolean(proposedTiers),
    note: note ?? null,
  });

  return NextResponse.json({ negotiation: created }, { status: 201 });
}
