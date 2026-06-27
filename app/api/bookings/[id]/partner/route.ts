// PUT /api/bookings/[id]/partner — 예약에 여행사/랜드사 파트너 지정/해제 (ADR-0022 PARTNER-2b)
// canViewFinance 전용(파트너 귀속=채권 책임자 결정, 재무 행위). 확정 이후 지정 시 채권 생성.
import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { ensureReceivableForBooking, evaluateConfirmCredit } from "@/lib/partner-booking";
import { requireCapability } from "@/lib/api-guard";

/** 여신 게이트 차단 — 트랜잭션 롤백용 (lib/hold.ts confirm 패턴과 정합) */
class CreditBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "CreditBlockedError";
  }
}

const schema = z.object({ partnerId: z.string().min(1).nullable() });

// 확정 이후(채권 발생 시점) 상태에서 지정하면 즉시 채권 생성
const POST_HOLD = new Set<BookingStatus>([
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.CHECKED_OUT,
]);

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }
  const { partnerId } = parsed.data;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, status: true, partnerId: true, receivable: { select: { id: true } } },
  });
  if (!booking) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 채권이 이미 생성된 예약은 파트너 변경 금지(채권 정합성) — 변경은 취소 후 재예약
  if (booking.receivable && partnerId !== booking.partnerId) {
    return NextResponse.json({ error: "RECEIVABLE_EXISTS" }, { status: 409 });
  }
  // 지정 파트너 실재 검증
  if (partnerId) {
    const exists = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "PARTNER_NOT_FOUND" }, { status: 400 });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id }, data: { partnerId } });
      // 확정 이후 상태에서 새로 지정하면 채권 즉시 생성(멱등)
      if (partnerId && POST_HOLD.has(booking.status)) {
        // 여신 게이트 재실행(ADR-0022) — confirm과 동일. 차단 파트너(한도초과·연체·
        // BLOCKED/SUSPENDED)에 채권 생성 우회 차단. update 후 평가해 새 partnerId 기준.
        const credit = await evaluateConfirmCredit(tx, id, new Date());
        if (!credit.allowed) {
          throw new CreditBlockedError(credit.reason ?? "OVER_LIMIT");
        }
        await ensureReceivableForBooking(tx, id, new Date());
      }
      await writeAuditLog({
        db: tx,
        userId: session.user.id,
        action: "UPDATE",
        entity: "Booking",
        entityId: id,
        changes: { partnerId: { old: booking.partnerId, new: partnerId } },
      });
    });
  } catch (e) {
    if (e instanceof CreditBlockedError) {
      return NextResponse.json(
        { error: "PARTNER_CREDIT_BLOCKED", reason: e.reason },
        { status: 409 }
      );
    }
    throw e;
  }

  return NextResponse.json({ ok: true, partnerId });
}
