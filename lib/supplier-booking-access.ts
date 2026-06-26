// lib/supplier-booking-access.ts — 공급자 직접예약 검수 접근 스코프 단일 소스 (T10.5, F10 / ADR-0021 §6 D5)
//
// 공급자(SUPPLIER)는 "seller=SUPPLIER AND villa.supplierId === 본인" 예약만 검수(체크인·아웃)할 수 있다.
// 운영자 예약(seller=OPERATOR)·타 공급자 예약은 존재 여부도 비노출(404) — 재고·마진 비공개 원칙 + T10.2 QA 패턴.
//
// 이 모듈은 권한 판정만 한다(부수효과 없음). 체크인/아웃 비즈니스 로직은 lib/checkin·checkout 재사용.
import { BookingSeller } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** 직접예약 검수 접근 거부 사유 — 라우트가 모두 404로 흡수(존재 비노출) */
export type SupplierBookingAccessReason =
  | "NOT_FOUND" // 예약 없음
  | "NOT_SUPPLIER_SELLER" // 운영자 예약 (seller != SUPPLIER)
  | "NOT_OWN_VILLA"; // 타 공급자 빌라

export class SupplierBookingForbiddenError extends Error {
  constructor(public readonly reason: SupplierBookingAccessReason) {
    super(reason);
    this.name = "SupplierBookingForbiddenError";
  }
}

export interface SupplierBookingScope {
  bookingId: string;
  villaId: string;
  status: string;
}

/**
 * 공급자가 이 예약을 검수할 수 있는지 판정한다.
 *  - 자기 빌라(villa.supplierId === supplierId) AND seller=SUPPLIER 가 아니면 던진다(모두 NOT_FOUND로 흡수 권장).
 *  - 통과 시 최소 스코프(bookingId·villaId·status) 반환.
 *
 * @throws SupplierBookingForbiddenError 접근 불가 (라우트는 404로 응답해 존재 비노출)
 */
export async function assertSupplierCanInspectBooking(
  db: Pick<PrismaClient, "booking">,
  bookingId: string,
  supplierId: string
): Promise<SupplierBookingScope> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      seller: true,
      villaId: true,
      villa: { select: { supplierId: true } },
    },
  });

  if (!booking) throw new SupplierBookingForbiddenError("NOT_FOUND");
  if (booking.seller !== BookingSeller.SUPPLIER) {
    throw new SupplierBookingForbiddenError("NOT_SUPPLIER_SELLER");
  }
  if (booking.villa.supplierId !== supplierId) {
    throw new SupplierBookingForbiddenError("NOT_OWN_VILLA");
  }

  return { bookingId: booking.id, villaId: booking.villaId, status: booking.status };
}
