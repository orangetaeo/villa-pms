// /api/settlements/[id] — ADMIN 정산 상세·상태 전이 (T4.5, SPEC F6)
// GET   : 상세 (items + booking 요약: 빌라명·기간 — 고객 연락처 미포함)
// PATCH { action: CONFIRM | MARK_PAID } : DRAFT→CONFIRMED→PAID (전이표 가드 409)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/serialize";
import {
  SettlementNotFoundError,
  SettlementTransitionError,
  transitionSettlement,
} from "@/lib/settlement";
import { canViewFinance, isSystemAdmin } from "@/lib/permissions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  const settlement = await prisma.settlement.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      yearMonth: true,
      totalVnd: true,
      status: true,
      paidAt: true,
      statementUrl: true,
      createdAt: true,
      supplier: { select: { name: true, phone: true } },
      items: {
        select: {
          id: true,
          bookingId: true,
          amountVnd: true,
          // booking 요약 — 빌라명·기간·상태만. 고객 연락처(guestPhone)·판매가 미포함
          booking: {
            select: {
              status: true,
              checkIn: true,
              checkOut: true,
              nights: true,
              villa: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!settlement) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ settlement: serializeBigInt(settlement) });
}

const patchSchema = z.object({
  action: z.enum(["CONFIRM", "MARK_PAID"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
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

  try {
    // 전이 + paidAt + SETTLEMENT_READY 큐 + AuditLog — 모두 lib 트랜잭션 내부
    const settlement = await transitionSettlement(id, parsed.data.action, session.user.id);
    return NextResponse.json({
      settlement: serializeBigInt({
        id: settlement.id,
        status: settlement.status,
        paidAt: settlement.paidAt,
        totalVnd: settlement.totalVnd,
      }),
    });
  } catch (e) {
    if (e instanceof SettlementNotFoundError) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (e instanceof SettlementTransitionError) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", current: e.current, action: e.action },
        { status: 409 }
      );
    }
    throw e;
  }
}
