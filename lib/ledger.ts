// lib/ledger.ts — 정산 2차 P2-3: 복식부기 LEDGER (ADR-0018)
//
// ★ ADMIN(canViewFinance/isSystemAdmin) 전용 데이터 — 계정잔액·매출·환차는 공급자에 절대 노출 금지.
// 계약: docs/contracts/T-settlement-ledger-p2-3.md  결정: ADR-0018(Accepted)
//
// 규칙(money-pattern):
//  - 모든 금액 BigInt(통화 최소단위: KRW 원, VND 동). float 금지, 합산만.
//  - 부호 규약: 차변 +, 대변 −. 자산·비용↑ = +, 부채·수익↑ = −.
//  - 한 거래(LedgerTransaction)의 분개선 합은 **통화별로 0** (회계항등식). 통화 혼합 시 통화별 검증.
//  - 지원 통화 화이트리스트(KRW·VND·USD)만 — 그 외는 throw. (USD=외국 게스트 수납 현금, Phase 2)
import {
  Currency,
  LedgerAccount,
  LedgerEntryType,
  SettlementStatus,
  type LedgerTransaction,
} from "@prisma/client";
import type { DbClient } from "@/lib/availability";

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** 분개선 한 줄 — 한 계정의 차변(+)/대변(−), 통화별 */
export interface JournalLine {
  account: LedgerAccount;
  currency: Currency;
  amount: bigint;
}

/** 통화별 현금 계정 — KRW·VND·USD. 그 외는 throw(허위 분개 금지). */
export function cashAccountFor(currency: Currency): LedgerAccount {
  if (currency === Currency.KRW) return LedgerAccount.CASH_KRW;
  if (currency === Currency.VND) return LedgerAccount.CASH_VND;
  if (currency === Currency.USD) return LedgerAccount.CASH_USD;
  throw new RangeError(`LEDGER 미지원 통화: ${currency}`);
}

/** 양수 강제 — 0·음수 금액은 거부(수납·원가·지급은 항상 양수) */
function assertPositive(amount: bigint, label: string): void {
  if (amount <= 0n) throw new RangeError(`${label}은(는) 양수여야 합니다: ${amount}`);
}

/**
 * COLLECTION — 고객이 통화 C로 amount 수납.
 * CASH_{C} +amount (자산↑ 차변) / REVENUE −amount (수익↑ 대변). C 통화 합 0.
 */
export function buildCollectionLines(
  currency: Currency,
  amount: bigint
): JournalLine[] {
  assertPositive(amount, "수납액");
  return [
    { account: cashAccountFor(currency), currency, amount },
    { account: LedgerAccount.REVENUE, currency, amount: -amount },
  ];
}

/**
 * COST_ACCRUAL — 정산 totalVnd 만큼 원가·채무 인식 (수납 시점, COLLECTED).
 * COGS +totalVnd (비용↑ 차변) / SUPPLIER_PAYABLE −totalVnd (부채↑ 대변). VND 합 0.
 */
export function buildCostAccrualLines(totalVnd: bigint): JournalLine[] {
  assertPositive(totalVnd, "원가 적립액");
  return [
    { account: LedgerAccount.COGS, currency: Currency.VND, amount: totalVnd },
    {
      account: LedgerAccount.SUPPLIER_PAYABLE,
      currency: Currency.VND,
      amount: -totalVnd,
    },
  ];
}

/**
 * PAYOUT — 공급자에게 totalVnd 지급.
 * SUPPLIER_PAYABLE +totalVnd (부채↓ 차변) / CASH_VND −totalVnd (자산↓ 대변). VND 합 0.
 */
export function buildPayoutLines(totalVnd: bigint): JournalLine[] {
  assertPositive(totalVnd, "지급액");
  return [
    {
      account: LedgerAccount.SUPPLIER_PAYABLE,
      currency: Currency.VND,
      amount: totalVnd,
    },
    { account: LedgerAccount.CASH_VND, currency: Currency.VND, amount: -totalVnd },
  ];
}

/**
 * FX_ADJUSTMENT — 환차 손익(fxAdjustmentVnd: +이익/−손실).
 * CASH_VND +fxAdj / FX_GAIN_LOSS −fxAdj. VND 합 0.
 * fxAdj === 0n 이면 분개 없음([]) — 호출부가 거래 생성을 건너뛴다.
 */
export function buildFxAdjustmentLines(fxAdjustmentVnd: bigint): JournalLine[] {
  if (fxAdjustmentVnd === 0n) return [];
  return [
    {
      account: LedgerAccount.CASH_VND,
      currency: Currency.VND,
      amount: fxAdjustmentVnd,
    },
    {
      account: LedgerAccount.FX_GAIN_LOSS,
      currency: Currency.VND,
      amount: -fxAdjustmentVnd,
    },
  ];
}

/** 통화별 합산 — Number 변환 금지(BigInt 누적) */
export function sumByCurrency(
  lines: readonly JournalLine[]
): Map<Currency, bigint> {
  const totals = new Map<Currency, bigint>();
  for (const l of lines) {
    totals.set(l.currency, (totals.get(l.currency) ?? 0n) + l.amount);
  }
  return totals;
}

/**
 * 회계항등식 검증 — 통화별 합이 모두 0이어야 균형. 위반 시 throw(불균형 분개 적재 차단).
 */
export function assertBalanced(lines: readonly JournalLine[]): void {
  for (const [currency, total] of sumByCurrency(lines)) {
    if (total !== 0n) {
      throw new RangeError(
        `LEDGER 불균형(${currency}): 합 ${total} ≠ 0 — 분개 오류`
      );
    }
  }
}

// ===================== DB 층 (멱등 적재) =====================

interface PostBase {
  occurredAt: Date;
  createdBy: string;
  memo?: string | null;
}

/** 분개선 배열을 균형 검증 후 LedgerTransaction + LedgerLine 으로 생성 (공통) */
async function createTransaction(
  db: DbClient,
  args: {
    type: LedgerEntryType;
    lines: JournalLine[];
    paymentId?: string | null;
    settlementId?: string | null;
  } & PostBase
): Promise<LedgerTransaction> {
  assertBalanced(args.lines);
  return db.ledgerTransaction.create({
    data: {
      type: args.type,
      occurredAt: args.occurredAt,
      paymentId: args.paymentId ?? null,
      settlementId: args.settlementId ?? null,
      memo: args.memo ?? null,
      createdBy: args.createdBy,
      lines: {
        create: args.lines.map((l) => ({
          account: l.account,
          currency: l.currency,
          amount: l.amount,
        })),
      },
    },
  });
}

/**
 * COLLECTION 적재 — paymentId 1:1 멱등. 이미 있으면 기존 거래 반환(중복 분개 금지).
 * KRW·VND 외 통화는 cashAccountFor에서 throw(호출부가 사전 차단해야 함).
 */
export async function postCollection(
  db: DbClient,
  args: { paymentId: string; currency: Currency; amount: bigint } & PostBase
): Promise<LedgerTransaction> {
  const existing = await db.ledgerTransaction.findUnique({
    where: { paymentId: args.paymentId },
  });
  if (existing) return existing;
  return createTransaction(db, {
    type: LedgerEntryType.COLLECTION,
    paymentId: args.paymentId,
    lines: buildCollectionLines(args.currency, args.amount),
    occurredAt: args.occurredAt,
    createdBy: args.createdBy,
    memo: args.memo,
  });
}

/**
 * COLLECTION 역분개 — Payment 삭제(오기록 정정) 시 해당 COLLECTION 거래 제거.
 * paymentId는 FK가 아닌 문자열 참조라 Payment 삭제로 cascade되지 않으므로 명시 삭제.
 * 분개선은 LedgerLine FK cascade로 함께 삭제. 없으면 무시(멱등).
 */
export async function reverseCollection(
  db: DbClient,
  paymentId: string
): Promise<void> {
  await db.ledgerTransaction.deleteMany({ where: { paymentId } });
}

/** 정산당 type별 기존 거래 1건 조회(멱등 가드) */
async function findSettlementTx(
  db: DbClient,
  settlementId: string,
  type: LedgerEntryType
): Promise<LedgerTransaction | null> {
  return db.ledgerTransaction.findFirst({ where: { settlementId, type } });
}

/** COST_ACCRUAL 적재 — settlementId+type 멱등. 이미 있으면 기존 반환. */
export async function postCostAccrual(
  db: DbClient,
  args: { settlementId: string; totalVnd: bigint } & PostBase
): Promise<LedgerTransaction> {
  const existing = await findSettlementTx(
    db,
    args.settlementId,
    LedgerEntryType.COST_ACCRUAL
  );
  if (existing) return existing;
  return createTransaction(db, {
    type: LedgerEntryType.COST_ACCRUAL,
    settlementId: args.settlementId,
    lines: buildCostAccrualLines(args.totalVnd),
    occurredAt: args.occurredAt,
    createdBy: args.createdBy,
    memo: args.memo,
  });
}

/** PAYOUT 적재 — settlementId+type 멱등. 이미 있으면 기존 반환. */
export async function postPayout(
  db: DbClient,
  args: { settlementId: string; totalVnd: bigint } & PostBase
): Promise<LedgerTransaction> {
  const existing = await findSettlementTx(
    db,
    args.settlementId,
    LedgerEntryType.PAYOUT
  );
  if (existing) return existing;
  return createTransaction(db, {
    type: LedgerEntryType.PAYOUT,
    settlementId: args.settlementId,
    lines: buildPayoutLines(args.totalVnd),
    occurredAt: args.occurredAt,
    createdBy: args.createdBy,
    memo: args.memo,
  });
}

/**
 * FX_ADJUSTMENT 적재 — 정산당 replace(기존 FX 거래 삭제 후 재생성).
 * P2-2 fxAdjustmentVnd는 누적이 아닌 절대값이므로, 재조정 시 기존 분개를 지우고 현재값으로 재적재.
 * fxAdj === 0n 이면 기존만 삭제(환차 없음 명시) 후 null 반환.
 */
export async function postFxAdjustment(
  db: DbClient,
  args: { settlementId: string; fxAdjustmentVnd: bigint } & PostBase
): Promise<LedgerTransaction | null> {
  await db.ledgerTransaction.deleteMany({
    where: { settlementId: args.settlementId, type: LedgerEntryType.FX_ADJUSTMENT },
  });
  const lines = buildFxAdjustmentLines(args.fxAdjustmentVnd);
  if (lines.length === 0) return null;
  return createTransaction(db, {
    type: LedgerEntryType.FX_ADJUSTMENT,
    settlementId: args.settlementId,
    lines,
    occurredAt: args.occurredAt,
    createdBy: args.createdBy,
    memo: args.memo,
  });
}

// ===================== 검증 (verifyLedger) =====================

export interface LedgerVerifyResult {
  /** 통화별 전체 분개선 합 — 모두 0이어야 균형 */
  currencyTotals: Record<string, string>;
  /** 통화별 균형 여부(전부 0) */
  balanced: boolean;
  /** 계정×통화별 잔액(부호 포함) */
  accountBalances: { account: LedgerAccount; currency: Currency; amount: string }[];
  /** SUPPLIER_PAYABLE 잔액(VND, 음수=미지급 채무) */
  payableActualVnd: string;
  /** 파생 기대 미지급 채무 = COLLECTED·미PAID 정산 totalVnd 합 (대변이므로 음수 기대) */
  payableExpectedVnd: string;
  /** 채무 잔액 = 기대값 일치 여부 */
  payableReconciled: boolean;
  /** 불일치 사유 목록(비어 있으면 무결) */
  discrepancies: string[];
}

/**
 * LEDGER 무결성 검증 (ADMIN 전용 호출):
 *  ① 통화별 전체 합 = 0 (회계항등식)
 *  ② SUPPLIER_PAYABLE 잔액 = −(COLLECTED·FX_ADJUSTED 상태이며 미PAID인 정산 totalVnd 합)
 *     (수납 시 COST_ACCRUAL로 −적립, 지급 시 PAYOUT으로 +상계 → 미지급분만 잔존)
 */
export async function verifyLedger(db: DbClient): Promise<LedgerVerifyResult> {
  const grouped = await db.ledgerLine.groupBy({
    by: ["account", "currency"],
    _sum: { amount: true },
  });

  const accountBalances = grouped.map((g) => ({
    account: g.account,
    currency: g.currency,
    amount: (g._sum.amount ?? 0n).toString(),
  }));

  // 통화별 전체 합
  const currencyTotalsMap = new Map<Currency, bigint>();
  let payableActual = 0n;
  for (const g of grouped) {
    const amt = g._sum.amount ?? 0n;
    currencyTotalsMap.set(
      g.currency,
      (currencyTotalsMap.get(g.currency) ?? 0n) + amt
    );
    if (
      g.account === LedgerAccount.SUPPLIER_PAYABLE &&
      g.currency === Currency.VND
    ) {
      payableActual += amt;
    }
  }

  const discrepancies: string[] = [];
  let balanced = true;
  const currencyTotals: Record<string, string> = {};
  for (const [currency, total] of currencyTotalsMap) {
    currencyTotals[currency] = total.toString();
    if (total !== 0n) {
      balanced = false;
      discrepancies.push(`통화 ${currency} 불균형: 합 ${total} ≠ 0`);
    }
  }

  // 파생 기대 미지급 채무 — COLLECTED·FX_ADJUSTED(수납 완료·미지급) 정산의 totalVnd 합
  const unpaidCollected = await db.settlement.aggregate({
    where: {
      status: { in: [SettlementStatus.COLLECTED, SettlementStatus.FX_ADJUSTED] },
    },
    _sum: { totalVnd: true },
  });
  const payableExpected = -(unpaidCollected._sum?.totalVnd ?? 0n); // 대변(−)
  const payableReconciled = payableActual === payableExpected;
  if (!payableReconciled) {
    discrepancies.push(
      `SUPPLIER_PAYABLE 잔액 ${payableActual} ≠ 기대 ${payableExpected}(미지급 정산 합)`
    );
  }

  return {
    currencyTotals,
    balanced,
    accountBalances,
    payableActualVnd: payableActual.toString(),
    payableExpectedVnd: payableExpected.toString(),
    payableReconciled,
    discrepancies,
  };
}

// ===================== 잔액 대시보드 (S5) =====================

/** 계정×통화 잔액 1줄 (verifyLedger.accountBalances 형태) */
export interface AccountBalanceRow {
  account: LedgerAccount;
  currency: Currency;
  amount: string; // BigInt 문자열(부호 포함)
}

/**
 * 운영자 표시용 잔액 요약 — 전부 BigInt 문자열(클라 포맷은 호출부).
 * 부호 해석(차변+/대변−):
 *  - 보유현금(자산, 차변): 잔액 그대로 (양수=보유).
 *  - 미지급채무(부채, 대변 −): 갚을 돈 = −잔액 (양수=미지급).
 *  - 매출(수익, 대변 −): 인식 매출 = −잔액 (통화별).
 *  - 원가(비용, 차변): 그대로.
 *  - 환차손익: 순이익 = −잔액 (양수=이익, 음수=손실).
 */
export interface LedgerBalanceSummary {
  cashKrw: string;
  cashVnd: string;
  cashUsd: string; // 보유 USD 현금(외국 게스트 수납분, Phase 2)
  supplierPayableVnd: string; // 미지급 채무(양수=갚을 돈)
  revenueKrw: string;
  revenueVnd: string;
  revenueUsd: string; // 인식 USD 매출
  cogsVnd: string;
  fxGainLossVnd: string; // 순환차손익(양수=이익)
}

/** 잔액 행 배열 → 표시용 요약 (순수). 누락 계정은 0. */
export function summarizeLedgerBalances(
  rows: readonly AccountBalanceRow[]
): LedgerBalanceSummary {
  const bal = (account: LedgerAccount, currency: Currency): bigint => {
    const row = rows.find((r) => r.account === account && r.currency === currency);
    return row ? BigInt(row.amount) : 0n;
  };
  return {
    cashKrw: bal(LedgerAccount.CASH_KRW, Currency.KRW).toString(),
    cashVnd: bal(LedgerAccount.CASH_VND, Currency.VND).toString(),
    cashUsd: bal(LedgerAccount.CASH_USD, Currency.USD).toString(),
    // 대변(−) → 양수 표기로 반전
    supplierPayableVnd: (-bal(LedgerAccount.SUPPLIER_PAYABLE, Currency.VND)).toString(),
    revenueKrw: (-bal(LedgerAccount.REVENUE, Currency.KRW)).toString(),
    revenueVnd: (-bal(LedgerAccount.REVENUE, Currency.VND)).toString(),
    revenueUsd: (-bal(LedgerAccount.REVENUE, Currency.USD)).toString(),
    cogsVnd: bal(LedgerAccount.COGS, Currency.VND).toString(),
    fxGainLossVnd: (-bal(LedgerAccount.FX_GAIN_LOSS, Currency.VND)).toString(),
  };
}
