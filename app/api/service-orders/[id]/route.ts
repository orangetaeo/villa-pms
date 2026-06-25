// /api/service-orders/[id] — 부가서비스 주문 상태 전이·확정 (ADR-0019 S2)
//   PATCH: 상태 전이(REQUESTED→CONFIRMED→DELIVERED, 종결 전 CANCELLED) + 확정 시 원가·판매가 조정.
//   원가(costVnd)·판매가 조정은 canViewFinance(돈 경계). 상태만 바꾸는 건 isOperator.
//   상태 전이표는 lib/service-order.ts 재사용(단일 소스).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, type Role } from "@/lib/permissions";
import { assertServiceTransition, InvalidServiceTransitionError } from "@/lib/service-order";
import type { ServiceOrderStatus } from "@prisma/client";

const patchSchema = z.object({
  status: z.enum(["REQUESTED", "CONFIRMED", "DELIVERED", "CANCELLED"]).optional(),
  // 확정 시 운영자 원가·판매가 조정(canViewFinance) — 모두 선택
  costVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  vendorName: z.string().max(100).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isOperator(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = session.user.id;
  const canFinance = canViewFinance(role);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  // 돈 필드는 canViewFinance만 — STAFF가 보내면 거부(가격·원가 변경은 돈 경계)
  const touchesMoney =
    d.costVnd !== undefined || d.priceKrw !== undefined || d.priceVnd !== undefined;
  if (touchesMoney && !canFinance) {
    return NextResponse.json({ error: "FORBIDDEN_FINANCE" }, { status: 403 });
  }

  const existing = await prisma.serviceOrder.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (d.status && d.status !== existing.status) {
    try {
      assertServiceTransition(existing.status, d.status as ServiceOrderStatus);
    } catch (e) {
      if (e instanceof InvalidServiceTransitionError) {
        return NextResponse.json(
          { error: "INVALID_TRANSITION", from: e.from, to: e.to },
          { status: 409 }
        );
      }
      throw e;
    }
    data.status = d.status;
  }
  if (canFinance) {
    if (d.costVnd !== undefined) data.costVnd = d.costVnd ? BigInt(d.costVnd) : 0n;
    if (d.priceKrw !== undefined && d.priceKrw !== null) data.priceKrw = d.priceKrw;
    if (d.priceVnd !== undefined) data.priceVnd = d.priceVnd ? BigInt(d.priceVnd) : null;
  }
  if (d.vendorName !== undefined) data.vendorName = d.vendorName?.trim() || null;
  if (d.note !== undefined) data.note = d.note?.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ id, changed: false });
  }

  await prisma.serviceOrder.update({ where: { id }, data });
  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      ...(data.status ? { status: { old: existing.status, new: data.status } } : {}),
      ...(data.costVnd !== undefined ? { costVnd: { new: (data.costVnd as bigint).toString() } } : {}),
    },
  });
  return NextResponse.json({ id, changed: true });
}
