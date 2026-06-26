// POST /api/supplier/bookings — SUPPLIER 직접예약 수동 기록 (T10.2, F10 / ADR-0021 §6)
//
// 공급자가 자기 고객에게 판 것을 기록 → 공실이 즉시 운영자에게 공유(선점 판단).
// 가용성 게이트(lockVillaInventory + checkAvailability)는 lib/availability 단일 소스 재사용.
// 누수·원칙: 응답은 공급자 자기 정보만. 운영자 salePriceKrw·마진·타 공급자·전체 재고 0.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseUtcDateOnly, todayVnDateString } from "@/lib/date-vn";
import { serializeBigInt } from "@/lib/serialize";
import {
  SupplierDirectRejectedError,
  createSupplierDirectBooking,
} from "@/lib/supplier-direct-booking";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  villaId: z.string().min(1),
  checkIn: z.string().regex(DATE_RE),
  checkOut: z.string().regex(DATE_RE), // exclusive
  guestName: z.string().trim().min(1).max(100),
  guestCount: z.number().int().min(1).max(50),
  guestPhone: z.string().trim().max(30).optional(),
  // 공급자가 받은 금액(VND, 동 단위). 선택. 음수 금지. BigInt 변환은 검증 통과 후.
  supplierSalePriceVnd: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
  // 첫 줄 권한 검사 — SUPPLIER 전용 (비로그인 401 / 타롤 403 분리)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 날짜 UTC 자정 정규화 + 실존 검증 (availability-pattern 교훈)
  const checkIn = parseUtcDateOnly(parsed.data.checkIn);
  const checkOut = parseUtcDateOnly(parsed.data.checkOut);
  if (!checkIn || !checkOut) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (checkIn.getTime() >= checkOut.getTime()) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }
  // 과거 체크인 금지 — Asia/Ho_Chi_Minh 오늘 기준
  if (parsed.data.checkIn < todayVnDateString()) {
    return NextResponse.json({ error: "PAST_DATE" }, { status: 400 });
  }

  try {
    const booking = await createSupplierDirectBooking(prisma, {
      villaId: parsed.data.villaId,
      supplierId,
      range: { checkIn, checkOut },
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      guestPhone: parsed.data.guestPhone ?? null,
      supplierSalePriceVnd:
        parsed.data.supplierSalePriceVnd !== undefined
          ? BigInt(parsed.data.supplierSalePriceVnd)
          : null,
    });

    // 응답은 공급자 자기 정보만 — 판매가 KRW·마진·원가 등 운영자 필드 비노출.
    return NextResponse.json(
      serializeBigInt({
        id: booking.id,
        checkIn: parsed.data.checkIn,
        checkOut: parsed.data.checkOut,
        nights: booking.nights,
        guestName: booking.guestName,
        guestCount: booking.guestCount,
        supplierSalePriceVnd: booking.supplierSalePriceVnd, // 공급자 본인 입력값(VND)
      }),
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof SupplierDirectRejectedError) {
      // 빌라 없음/타인 빌라 → 404 (존재 여부 비노출), ACTIVE 아님 → 409, 점유 → 409(상세 비노출)
      if (err.reason === "VILLA_NOT_FOUND") {
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      }
      if (err.reason === "VILLA_NOT_ACTIVE") {
        return NextResponse.json({ error: "VILLA_NOT_ACTIVE" }, { status: 409 });
      }
      // OCCUPIED — 선착순 패배. 사유 코드만, 운영자 예약 상세·금액 절대 비노출.
      return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
    }
    if (err instanceof RangeError) {
      return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
    }
    throw err;
  }
}
