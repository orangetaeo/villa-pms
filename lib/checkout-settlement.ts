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

// ===================== 수납 라인(수단×통화) 정규화 — 혼합 수납 (T-checkout-mixed) =====================
//
// 체크아웃 게스트 수납은 "현금 500만₫ + 계좌이체 20만₩"처럼 수단·통화가 섞여 들어올 수 있다.
//   라인(수단, 통화, 원본 통화 최소단위 금액)으로 받아 서버가 검증·병합·통화별 합계·대표 수단을 파생한다.
//   금액은 원본 통화 그대로(VND=동, KRW=원, USD=정수 달러) — 환산 저장 금지. 부동소수점 금지.

export type SettlementCurrency = "VND" | "KRW" | "USD";

/**
 * 수납 라인에 허용되는 수단 — 현금·계좌이체·기타 + 보증금 차감(DEPOSIT, ADR-0041).
 *   DEPOSIT은 "보증금에서 상계"를 표현하는 라인 전용 수단이며 currency=VND만 허용된다.
 *   (구 shape의 method 필드는 여전히 GuestSettlementMethodValue만 — DEPOSIT은 라인으로만 지정.)
 *   MIXED는 서버 파생 전용(입력 금지).
 */
export const SETTLEMENT_LINE_METHODS = ["CASH", "BANK_TRANSFER", "OTHER", "DEPOSIT"] as const;
export type SettlementLineMethod = (typeof SETTLEMENT_LINE_METHODS)[number];

export interface SettlementLineInput {
  method: SettlementLineMethod; // CASH | BANK_TRANSFER | OTHER | DEPOSIT (MIXED는 서버 파생 전용 — 입력 금지)
  currency: SettlementCurrency;
  amount: bigint; // 원본 통화 최소단위 정수 (> 0)
}

/** 파생 대표 수단 — 라인 수단 1종이면 그 수단(DEPOSIT 가능), 2종 이상이면 "MIXED". 라인 없으면 null. */
export type DerivedSettlementMethod = SettlementLineMethod | "MIXED";

export interface NormalizedSettlement {
  /** (수단,통화) 중복 병합된 라인 — 이 배열이 CheckoutSettlementLine 저장·표시의 원천 */
  lines: SettlementLineInput[];
  // ⚠ settledVnd/Krw/Usd는 DEPOSIT(보증금 상계) 라인도 포함한다 — "실수납액"이 아니라
  //   "청구 커버리지 캐시"의 의미(현금+상계로 청구가 얼마나 덮였는지, ADR-0041 계약 5항).
  settledVnd: bigint | null; // Σ VND 라인 (DEPOSIT 포함, 0이면 null)
  settledKrw: number | null; // Σ KRW 라인 (0이면 null, Number 안전범위 검증 후 변환)
  settledUsd: number | null; // Σ USD 라인 (0이면 null)
  /** ΣDEPOSIT 라인(보증금 상계액, 항상 VND). 라인 없으면 0n. */
  depositOffsetVnd: bigint;
  derivedMethod: DerivedSettlementMethod | null;
}

/** 수납 라인 최대 개수 — 방어적 상한(현장 수납이 12건을 넘길 이유 없음). */
export const MAX_SETTLEMENT_LINES = 12;

/**
 * 수납 라인 검증·병합·집계 — 순수. (SPEC: 혼합 수납 + 보증금 상계 ADR-0041)
 *   - 검증: amount ≤ 0 → RangeError, 라인 수 > 12 → RangeError,
 *           DEPOSIT 라인인데 currency ≠ VND → RangeError(보증금은 VND 전용)
 *   - (method, currency) 중복 라인은 금액 합산 병합
 *   - 통화별 합계 산출(DEPOSIT 라인 포함 — 청구 커버리지 캐시. KRW/USD는 Number 안전범위 검증 후 변환, 0이면 null)
 *   - depositOffsetVnd = ΣDEPOSIT 라인(보증금 상계액, 항상 VND)
 *   - 수단 종류 1개 → 그 수단(DEPOSIT 가능), 2개 이상 → "MIXED"를 derivedMethod로 반환
 *   - 빈 배열 → lines=[]·전부 null·depositOffsetVnd=0n·derivedMethod=null
 */
export function normalizeSettlementLines(lines: SettlementLineInput[]): NormalizedSettlement {
  if (lines.length > MAX_SETTLEMENT_LINES) {
    throw new RangeError(`수납 라인은 최대 ${MAX_SETTLEMENT_LINES}건까지 입력할 수 있습니다`);
  }

  // (수단,통화) 병합 — 입력 순서 보존
  const merged = new Map<string, SettlementLineInput>();
  for (const l of lines) {
    if (l.amount <= 0n) {
      throw new RangeError("수납액은 0보다 커야 합니다");
    }
    // 보증금 상계(DEPOSIT)는 VND 전용 — 보증금이 VND로 수취되므로 (ADR-0041)
    if (l.method === "DEPOSIT" && l.currency !== "VND") {
      throw new RangeError("보증금 차감(DEPOSIT) 라인은 VND만 허용됩니다");
    }
    const key = `${l.method}|${l.currency}`;
    const prev = merged.get(key);
    if (prev) {
      prev.amount += l.amount;
    } else {
      merged.set(key, { method: l.method, currency: l.currency, amount: l.amount });
    }
  }
  const mergedLines = [...merged.values()];

  let vnd = 0n;
  let krw = 0n;
  let usd = 0n;
  let depositOffsetVnd = 0n;
  const methods = new Set<SettlementLineMethod>();
  for (const l of mergedLines) {
    methods.add(l.method);
    if (l.method === "DEPOSIT") depositOffsetVnd += l.amount; // 항상 VND(위 검증)
    if (l.currency === "VND") vnd += l.amount;
    else if (l.currency === "KRW") krw += l.amount;
    else usd += l.amount;
  }

  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  if (krw > MAX_SAFE) throw new RangeError("수납액(KRW) 합계가 안전 정수 범위를 초과했습니다");
  if (usd > MAX_SAFE) throw new RangeError("수납액(USD) 합계가 안전 정수 범위를 초과했습니다");

  const derivedMethod: DerivedSettlementMethod | null =
    methods.size === 0 ? null : methods.size === 1 ? [...methods][0] : "MIXED";

  return {
    lines: mergedLines,
    settledVnd: vnd > 0n ? vnd : null,
    settledKrw: krw > 0n ? Number(krw) : null,
    settledUsd: usd > 0n ? Number(usd) : null,
    depositOffsetVnd,
    derivedMethod,
  };
}
