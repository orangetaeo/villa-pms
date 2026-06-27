// lib/settlement-finance.ts — 정산 고도화 1차: 운영자 손익(수납·환산·환차·마진) 파생 계산.
//
// 스키마 무변경 — 기존 Booking 필드(saleCurrency·totalSaleKrw·totalSaleVnd·supplierCostVnd·fxVndPerKrw)에서
//   운영자 손익을 파생한다. ★ ADMIN(canViewFinance) 전용 — 마진·매출·VND환산은 공급자에 절대 노출 금지.
//
// 규칙(money-pattern·fin/settlement-pattern):
//  - VND BigInt, KRW Int. float 금지. 합산만(재계산 금지).
//  - KRW 수납액 VND 환산은 예약 시점 환율 스냅샷(Booking.fxVndPerKrw)만 사용 — 스냅샷 없으면 환산 불가(허위 0 금지) → fxMissing.
//  - 마진 = 수납 VND환산 − 공급자 지급(supplierCostVnd). 환산 불가 예약은 마진 합계에서 제외.
//  - 지원 통화 화이트리스트(KRW·VND·USD)만 — 그 외는 throw. USD(Phase 2)는 fxVndPerUsd 스냅샷으로 환산.
import { Currency } from "@prisma/client";
import { krwToVndSnapshot, usdToVndSnapshot } from "@/lib/pricing";

/** 정산 손익 계산 입력 — 한 예약의 통화·금액·환율 스냅샷 */
export interface FinanceBooking {
  saleCurrency: Currency;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  /** Phase 2 USD: USD 예약 총 판매가(정수 달러). 그 외 통화면 null */
  totalSaleUsd?: number | null;
  supplierCostVnd: bigint;
  /** 예약 시점 환율 스냅샷 (Decimal(14,4) 문자열). KRW 예약의 VND 환산에만 사용 */
  fxVndPerKrw: string | null;
  /** Phase 2 USD: 예약 시점 USD→VND 환율 스냅샷. USD 예약의 VND 환산에만 사용 */
  fxVndPerUsd?: string | null;
}

/** 한 예약의 손익 결과 */
export interface BookingFinance {
  /** KRW로 수납한 금액 (KRW 예약만, 그 외 0) */
  collectedKrw: number;
  /** VND로 수납한 금액 (VND 예약만, 그 외 0n) */
  collectedVnd: bigint;
  /** USD로 수납한 금액 (USD 예약만, 그 외 0) — Phase 2 */
  collectedUsd: number;
  /** 수납액의 VND 환산 — KRW/USD는 스냅샷 환율로 환산, VND는 그대로. 환율 미상이면 null */
  collectedVndEquivalent: bigint | null;
  /** 공급자 지급액 (VND) */
  payoutVnd: bigint;
  /** 운영자 마진 = 수납 VND환산 − 지급. 환율 미상이면 null */
  marginVnd: bigint | null;
  /** KRW/USD 예약인데 환율 스냅샷이 없어 환산 불가 */
  fxMissing: boolean;
}

/** 지원 통화 화이트리스트 — 그 외는 정산 손익 분기에 도달하면 throw (money-pattern 교훈). USD=Phase 2 허용. */
function assertSupportedCurrency(c: Currency): void {
  if (c !== Currency.KRW && c !== Currency.VND && c !== Currency.USD) {
    throw new RangeError(`정산 손익 미지원 통화: ${c}`);
  }
}

export function bookingFinance(b: FinanceBooking): BookingFinance {
  assertSupportedCurrency(b.saleCurrency);
  const payoutVnd = b.supplierCostVnd;

  if (b.saleCurrency === Currency.VND) {
    const collectedVnd = b.totalSaleVnd ?? 0n;
    return {
      collectedKrw: 0,
      collectedVnd,
      collectedUsd: 0,
      collectedVndEquivalent: collectedVnd,
      payoutVnd,
      marginVnd: collectedVnd - payoutVnd,
      fxMissing: false,
    };
  }

  if (b.saleCurrency === Currency.USD) {
    // USD 예약(Phase 2) — 스냅샷 환율(fxVndPerUsd)로 VND 환산. 스냅샷 없으면 환산·마진 불가(fxMissing).
    const collectedUsd = b.totalSaleUsd ?? 0;
    if (!b.fxVndPerUsd) {
      return {
        collectedKrw: 0,
        collectedVnd: 0n,
        collectedUsd,
        collectedVndEquivalent: null,
        payoutVnd,
        marginVnd: null,
        fxMissing: true,
      };
    }
    const collectedVndEquivalent = usdToVndSnapshot(collectedUsd, b.fxVndPerUsd);
    return {
      collectedKrw: 0,
      collectedVnd: 0n,
      collectedUsd,
      collectedVndEquivalent,
      payoutVnd,
      marginVnd: collectedVndEquivalent - payoutVnd,
      fxMissing: false,
    };
  }

  // KRW 예약 — 스냅샷 환율로 VND 환산. 스냅샷 없으면 환산·마진 불가(fxMissing).
  const collectedKrw = b.totalSaleKrw ?? 0;
  if (!b.fxVndPerKrw) {
    return {
      collectedKrw,
      collectedVnd: 0n,
      collectedUsd: 0,
      collectedVndEquivalent: null,
      payoutVnd,
      marginVnd: null,
      fxMissing: true,
    };
  }
  const collectedVndEquivalent = krwToVndSnapshot(collectedKrw, b.fxVndPerKrw);
  return {
    collectedKrw,
    collectedVnd: 0n,
    collectedUsd: 0,
    collectedVndEquivalent,
    payoutVnd,
    marginVnd: collectedVndEquivalent - payoutVnd,
    fxMissing: false,
  };
}

/** 월/공급자 손익 합계 */
export interface FinanceSummary {
  /** 총 KRW 수납 (KRW 예약 합) */
  collectedKrw: number;
  /** 총 VND 수납 (VND 예약 합) */
  collectedVnd: bigint;
  /** 총 USD 수납 (USD 예약 합) — Phase 2 */
  collectedUsd: number;
  /** 총 수납 VND환산 (환산 가능 예약만) */
  collectedVndEquivalent: bigint;
  /** 총 공급자 지급 (VND) */
  payoutVnd: bigint;
  /** 총 마진 (VND, 환산 가능 예약만) */
  marginVnd: bigint;
  /** 환율 미상으로 환산·마진에서 제외된 KRW 예약 수 */
  fxMissingCount: number;
  /** 합산 예약 수 */
  bookingCount: number;
}

export function summarizeFinance(bookings: readonly FinanceBooking[]): FinanceSummary {
  const summary: FinanceSummary = {
    collectedKrw: 0,
    collectedVnd: 0n,
    collectedUsd: 0,
    collectedVndEquivalent: 0n,
    payoutVnd: 0n,
    marginVnd: 0n,
    fxMissingCount: 0,
    bookingCount: bookings.length,
  };
  for (const b of bookings) {
    const f = bookingFinance(b);
    summary.collectedKrw += f.collectedKrw;
    summary.collectedVnd += f.collectedVnd;
    summary.collectedUsd += f.collectedUsd;
    summary.payoutVnd += f.payoutVnd;
    if (f.fxMissing) {
      summary.fxMissingCount += 1;
      continue; // 환율 미상 — VND환산·마진 합계에서 제외(허위 0 금지)
    }
    if (f.collectedVndEquivalent != null) summary.collectedVndEquivalent += f.collectedVndEquivalent;
    if (f.marginVnd != null) summary.marginVnd += f.marginVnd;
  }
  return summary;
}
