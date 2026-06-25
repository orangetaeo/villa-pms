// lib/checkout-settlement.ts — 체크아웃 게스트 통합 청구 합산 (ADR-0019 S4)
//
// 게스트 청구 = 미니바 소비분(minibarChargeVnd) + 확정 부가옵션(CONFIRMED|DELIVERED ServiceOrder).
//   통화별 분리(ADR-0003): VND/KRW 합산 금지 — guestChargeVnd(미니바+VND옵션)·guestChargeKrw(KRW옵션) 별도.
//   보증금 차감(deductionVnd)은 별개(게스트↔운영자, 공급자 정산 F6 무관). 순수 — BigInt, 부동소수점 금지.

export interface ServiceChargeLine {
  priceKrw: number | null;
  priceVnd: bigint | null;
}

export interface GuestBill {
  minibarVnd: bigint; // 미니바 소비 합계(VND)
  serviceVnd: bigint; // 부가옵션 VND 합계
  serviceKrw: number; // 부가옵션 KRW 합계
  totalVnd: bigint; // 미니바 + VND옵션
  totalKrw: number; // KRW옵션
}

/** 게스트 청구서 합산 — 미니바(VND) + 확정 서비스주문(통화별). 순수. */
export function computeGuestBill(
  minibarChargeVnd: bigint | null,
  serviceOrders: ServiceChargeLine[]
): GuestBill {
  const minibarVnd = minibarChargeVnd ?? 0n;
  let serviceVnd = 0n;
  let serviceKrw = 0;
  for (const o of serviceOrders) {
    if (o.priceVnd != null) serviceVnd += o.priceVnd;
    if (o.priceKrw != null && o.priceKrw > 0) serviceKrw += o.priceKrw;
  }
  return {
    minibarVnd,
    serviceVnd,
    serviceKrw,
    totalVnd: minibarVnd + serviceVnd,
    totalKrw: serviceKrw,
  };
}

export const GUEST_SETTLEMENT_METHODS = ["CASH", "BANK_TRANSFER", "OTHER"] as const;
export type GuestSettlementMethodValue = (typeof GUEST_SETTLEMENT_METHODS)[number];

export function isGuestSettlementMethod(v: string): v is GuestSettlementMethodValue {
  return (GUEST_SETTLEMENT_METHODS as readonly string[]).includes(v);
}
