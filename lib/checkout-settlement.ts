// lib/checkout-settlement.ts — 체크아웃 게스트 통합 청구 합산 (ADR-0019 S4)
//
// 게스트 청구 = 미니바 소비분(minibarChargeVnd) + 확정 부가옵션(CONFIRMED|DELIVERED ServiceOrder).
//   통화별 분리(ADR-0003): VND/KRW 합산 금지 — guestChargeVnd(미니바+VND옵션)·guestChargeKrw(KRW옵션) 별도.
//   보증금 차감(deductionVnd)은 별개(게스트↔운영자, 공급자 정산 F6 무관). 순수 — BigInt, 부동소수점 금지.
//
// ★원천 통화 1회 계상 규칙(T-guest-bill-double-count-fix, P1 과청구 수정):
//   ServiceOrder에서 priceVnd = 판매가 원천, priceKrw = 주문 시점 환산 표시 스냅샷
//   (guest·admin 생성 경로 모두 priceKrw = priceKrwCeil(totalPriceVnd, fx) — 같은 금액의 KRW 표시본).
//   따라서 주문 하나는 원천 통화로 딱 1회만 계상한다:
//     · priceVnd != null           → serviceVnd에만 합산 (priceKrw는 스냅샷이므로 무시)
//     · priceVnd == null && priceKrw > 0 → serviceKrw에 합산 (KRW-원천 주문 보존)
//   두 컬럼을 각각 합산하면 같은 금액을 ₫+₩로 이중 청구하게 되므로 금지.

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
    // 원천 통화로 1회만 계상 — priceVnd 있으면 그것이 원천(priceKrw는 표시 스냅샷이므로 무시).
    if (o.priceVnd != null) serviceVnd += o.priceVnd;
    else if (o.priceKrw != null && o.priceKrw > 0) serviceKrw += o.priceKrw;
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
 *   DEPOSIT은 "보증금에서 상계"를 표현하는 라인 전용 수단이며 통화는 보증금 통화를 따른다
 *   (VND·KRW·USD — 통화 정합 검증은 completeCheckout에서 booking.depositCurrency와 대조).
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

/**
 * 통화별 보증금 상계 합계(ΣDEPOSIT 라인) — 보증금 통화 일반화(ADR-0041 후속).
 *   보증금이 ₩/$일 수 있으므로 통화별로 나눠 집계한다. 라인 없으면 전부 0.
 *   ★ 통화 정합(보증금 통화와 일치) 검증은 completeCheckout이 담당(여기선 집계만).
 */
export interface DepositOffset {
  vnd: bigint;
  krw: number;
  usd: number;
}

export interface NormalizedSettlement {
  /** (수단,통화) 중복 병합된 라인 — 이 배열이 CheckoutSettlementLine 저장·표시의 원천 */
  lines: SettlementLineInput[];
  // ⚠ settledVnd/Krw/Usd는 DEPOSIT(보증금 상계) 라인도 포함한다 — "실수납액"이 아니라
  //   "청구 커버리지 캐시"의 의미(현금+상계로 청구가 얼마나 덮였는지, ADR-0041 계약 5항).
  settledVnd: bigint | null; // Σ VND 라인 (DEPOSIT 포함, 0이면 null)
  settledKrw: number | null; // Σ KRW 라인 (0이면 null, Number 안전범위 검증 후 변환)
  settledUsd: number | null; // Σ USD 라인 (0이면 null)
  /** 통화별 ΣDEPOSIT 라인(보증금 상계액). 라인 없으면 전부 0. */
  depositOffset: DepositOffset;
  derivedMethod: DerivedSettlementMethod | null;
}

/** 수납 라인 최대 개수 — 방어적 상한(현장 수납이 12건을 넘길 이유 없음). */
export const MAX_SETTLEMENT_LINES = 12;

/**
 * 수납 라인 검증·병합·집계 — 순수. (SPEC: 혼합 수납 + 보증금 상계 ADR-0041)
 *   - 검증: amount ≤ 0 → RangeError, 라인 수 > 12 → RangeError
 *           ★ DEPOSIT 라인의 통화 검증은 여기서 하지 않는다 — 보증금 통화(VND/KRW/USD)와의
 *             정합은 completeCheckout이 booking.depositCurrency와 대조(보증금 통화 일반화).
 *   - (method, currency) 중복 라인은 금액 합산 병합
 *   - 통화별 합계 산출(DEPOSIT 라인 포함 — 청구 커버리지 캐시. KRW/USD는 Number 안전범위 검증 후 변환, 0이면 null)
 *   - depositOffset = 통화별 ΣDEPOSIT 라인(보증금 상계액). KRW/USD는 Number 안전범위 검증 후 변환.
 *   - 수단 종류 1개 → 그 수단(DEPOSIT 가능), 2개 이상 → "MIXED"를 derivedMethod로 반환
 *   - 빈 배열 → lines=[]·전부 null·depositOffset={vnd:0n,krw:0,usd:0}·derivedMethod=null
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
  // 통화별 보증금 상계(ΣDEPOSIT 라인) — 보증금 통화 일반화(ADR-0041 후속)
  let depositVnd = 0n;
  let depositKrw = 0n;
  let depositUsd = 0n;
  const methods = new Set<SettlementLineMethod>();
  for (const l of mergedLines) {
    methods.add(l.method);
    if (l.currency === "VND") {
      vnd += l.amount;
      if (l.method === "DEPOSIT") depositVnd += l.amount;
    } else if (l.currency === "KRW") {
      krw += l.amount;
      if (l.method === "DEPOSIT") depositKrw += l.amount;
    } else {
      usd += l.amount;
      if (l.method === "DEPOSIT") depositUsd += l.amount;
    }
  }

  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  if (krw > MAX_SAFE) throw new RangeError("수납액(KRW) 합계가 안전 정수 범위를 초과했습니다");
  if (usd > MAX_SAFE) throw new RangeError("수납액(USD) 합계가 안전 정수 범위를 초과했습니다");

  const derivedMethod: DerivedSettlementMethod | null =
    methods.size === 0 ? null : methods.size === 1 ? [...methods][0] : "MIXED";

  // depositKrw/Usd ≤ krw/usd(부분집합)이므로 위 안전범위 검증으로 충분 — Number 변환 안전.
  return {
    lines: mergedLines,
    settledVnd: vnd > 0n ? vnd : null,
    settledKrw: krw > 0n ? Number(krw) : null,
    settledUsd: usd > 0n ? Number(usd) : null,
    depositOffset: { vnd: depositVnd, krw: Number(depositKrw), usd: Number(depositUsd) },
    derivedMethod,
  };
}
