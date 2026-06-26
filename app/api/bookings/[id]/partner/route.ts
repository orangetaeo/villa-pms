// PUT /api/bookings/[id]/partner — 예약에 여행사/랜드사 파트너 지정/해제 (ADR-0022 PARTNER-2b)
// canViewFinance 전용(파트너 귀속=채권 책임자 결정, 재무 행위). 확정 이후 지정 시 채권 생성.
import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { ensureReceivableForBooking, evaluateConfirmCredit } from "@/lib/partner-booking";

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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

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
      // 확정(confirmHold)과의 경합 직렬화 — 같은 booking 채권 락(payments·hold 라우트와 동일 키).
      // 없으면 동시 확정과 파트너 지정이 서로의 미커밋 쓰기를 못 봐 "CONFIRMED인데 채권 없음"
      // (미수 누락) 발생 가능. ADR-0022 채권 정합성.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receivable:${id}`}))`;
      await tx.booking.update({ where: { id }, data: { partnerId } });
      // 상태는 트랜잭션 안에서 다시 읽는다 — 바깥 stale 스냅샷(예: 그 사이 HOLD→CONFIRMED)으로
      // 채권 생성을 건너뛰는 경합을 차단(락으로 직렬화된 뒤의 확정 상태를 본다).
      const fresh = await tx.booking.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      });
      // 확정 이후 상태에서 새로 지정하면 채권 즉시 생성(멱등)
      if (partnerId && POST_HOLD.has(fresh.status)) {
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
