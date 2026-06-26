// app/api/bookings/[id]/payments — 실수납(Payment) 기록·조회 (정산 2차 P2-1)
//
// ★ ADMIN(canViewFinance) 전용 — 수납액·미수·VND환산은 공급자에 절대 노출 금지(leak-checklist).
// 숙박비 수납만 기록(보증금은 Booking.deposit* 분리 유지, 계약서 결정사항).
// 계약: docs/contracts/T-settlement-payment-recording.md
import { NextResponse } from "next/server";
import { z } from "zod";
import { Currency, PaymentMethod } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { krwToVndSnapshot } from "@/lib/pricing";
import { computeVndEquivalent, summarizeCollection } from "@/lib/payment";
import { postCollection } from "@/lib/ledger";
import { applyPaymentToReceivable } from "@/lib/partner-booking";

const createSchema = z.object({
  currency: z.nativeEnum(Currency),
  // 통화 최소단위 정수(원/동). 문자열·숫자 모두 허용 → BigInt 변환.
  amount: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
    .transform((v) => BigInt(v)),
  method: z.nativeEnum(PaymentMethod),
  receivedAt: z.string().datetime({ offset: true }).or(z.string().date()),
  fxRateToVnd: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  note: z.string().max(500).optional(),
  // 입금 용도 (ADR-0022) — 기본 GUEST(기존 고객 수납·하위호환). 파트너 객실료는 DEPOSIT/BALANCE.
  purpose: z.enum(["GUEST", "DEPOSIT", "BALANCE"]).default("GUEST"),
});

/** 견적 판매가의 VND 환산 — VND는 그대로, KRW는 예약 시점 스냅샷 환율로. 스냅샷 없으면 null */
function expectedVndEquivalent(b: {
  saleCurrency: Currency;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  fxVndPerKrw: { toString(): string } | null;
}): bigint | null {
  if (b.saleCurrency === Currency.VND) return b.totalSaleVnd ?? 0n;
  if (b.saleCurrency === Currency.KRW) {
    if (!b.fxVndPerKrw) return null; // 환율 미상 — 미수 산출 불가
    return krwToVndSnapshot(b.totalSaleKrw ?? 0, b.fxVndPerKrw.toString());
  }
  return null;
}

async function loadBooking(id: string) {
  return prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      fxVndPerKrw: true,
    },
  });
}

/** POST — 결제 1건 기록 (ADMIN 전용) */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const booking = await loadBooking(id);
  if (!booking) {
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // VND 환산 — KRW는 환율 필수(없으면 400). VND는 환율 무시.
  let vndEquivalent: bigint;
  try {
    vndEquivalent = computeVndEquivalent(
      body.currency,
      body.amount,
      body.fxRateToVnd ?? null
    );
  } catch {
    return NextResponse.json(
      { error: "FX_REQUIRED_FOR_KRW" },
      { status: 400 }
    );
  }

  // 청구서에 묶인 채권엔 직접 입금 금지 — 이중 인식 방지(QA, 청구서로 수납해야 함, ADR-0022 3b)
  if (body.purpose === "DEPOSIT" || body.purpose === "BALANCE") {
    const linked = await prisma.partnerReceivable.findUnique({
      where: { bookingId: id },
      select: { invoiceId: true },
    });
    if (linked?.invoiceId) {
      return NextResponse.json({ error: "RECEIVABLE_INVOICED" }, { status: 409 });
    }
  }

  const payment = await prisma.$transaction(async (tx) => {
    // 동시성 가드 — 같은 예약의 채권 입금을 직렬화(advisory lock). 없으면 READ COMMITTED에서
    // 동시 입금 2건이 같은 depositPaidVnd 스냅샷을 읽어 lost-update(채권 카운터 누락) 발생.
    // 카운터는 여신게이트·체크인차단을 구동하므로 정확성이 중요. (Payment·LEDGER는 paymentId 멱등이라 안전)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receivable:${id}`}))`;
    // 파트너 객실료 입금(DEPOSIT/BALANCE)이면 예약의 채권을 찾아 반영 (ADR-0022)
    let receivable: {
      id: string;
      partnerId: string;
      totalVnd: bigint;
      depositPaidVnd: bigint;
      balancePaidVnd: bigint;
    } | null = null;
    if (body.purpose === "DEPOSIT" || body.purpose === "BALANCE") {
      receivable = await tx.partnerReceivable.findUnique({
        where: { bookingId: id },
        select: {
          id: true,
          partnerId: true,
          totalVnd: true,
          depositPaidVnd: true,
          balancePaidVnd: true,
        },
      });
    }

    const created = await tx.payment.create({
      data: {
        bookingId: id,
        currency: body.currency,
        amount: body.amount,
        method: body.method,
        fxRateToVnd: body.currency === Currency.KRW ? body.fxRateToVnd : null,
        vndEquivalent,
        receivedAt: new Date(body.receivedAt),
        note: body.note,
        purpose: body.purpose,
        partnerId: receivable?.partnerId ?? null,
        receivableId: receivable?.id ?? null,
      },
    });

    // 채권 선금/잔금 누적 + 상태 재계산 (VND 환산액 기준)
    if (receivable && (body.purpose === "DEPOSIT" || body.purpose === "BALANCE")) {
      const upd = applyPaymentToReceivable(receivable, body.purpose, vndEquivalent);
      await tx.partnerReceivable.update({
        where: { id: receivable.id },
        data: upd,
      });
    }
    // 복식부기 LEDGER — COLLECTION 분개 (CASH_{C} +/ REVENUE −, paymentId 멱등, ADR-0018)
    // currency는 KRW·VND만(computeVndEquivalent가 그 외 차단) → cashAccountFor 안전.
    await postCollection(tx, {
      paymentId: created.id,
      currency: body.currency,
      amount: body.amount,
      occurredAt: created.receivedAt,
      createdBy: session.user.id,
    });
    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE",
      entity: "Payment",
      entityId: created.id,
      changes: {
        bookingId: { old: null, new: id },
        amount: { old: null, new: `${body.currency} ${body.amount}` },
        purpose: { old: null, new: body.purpose },
      },
      db: tx,
    });
    return created;
  });

  return NextResponse.json({ payment: serializeBigInt(payment) }, { status: 201 });
}

/** GET — 결제 목록 + 수납 요약 (ADMIN 전용) */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const booking = await loadBooking(id);
  if (!booking) {
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  }

  const payments = await prisma.payment.findMany({
    where: { bookingId: id },
    orderBy: { receivedAt: "asc" },
  });

  // summarizeCollection 입력 형태로 축약 — 저장된 vndEquivalent를 신뢰(fxRateToVnd Decimal 미사용)
  const paymentLikes = payments.map((p) => ({
    currency: p.currency,
    amount: p.amount,
    vndEquivalent: p.vndEquivalent,
  }));

  const expected = expectedVndEquivalent(booking);
  // 견적 환산 가능할 때만 미수/상태 산출 (환율 미상이면 collected만)
  const summary =
    expected != null
      ? summarizeCollection(paymentLikes, expected)
      : {
          collectedVndEquivalent: payments.reduce(
            (s, p) => s + (p.vndEquivalent ?? 0n),
            0n
          ),
          expectedVndEquivalent: null,
          outstandingVnd: null,
          status: "FX_UNKNOWN" as const,
          paymentCount: payments.length,
        };

  return NextResponse.json({
    payments: serializeBigInt(payments),
    summary: serializeBigInt(summary),
  });
}
