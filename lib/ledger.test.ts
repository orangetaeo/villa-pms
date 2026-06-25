import { describe, expect, it } from "vitest";
import { Currency, LedgerAccount } from "@prisma/client";
import {
  assertBalanced,
  buildCollectionLines,
  buildCostAccrualLines,
  buildFxAdjustmentLines,
  buildPayoutLines,
  cashAccountFor,
  sumByCurrency,
  type JournalLine,
} from "@/lib/ledger";

/** 한 거래의 통화별 합이 모두 0인지 (회계항등식) */
function isBalanced(lines: JournalLine[]): boolean {
  for (const total of sumByCurrency(lines).values()) {
    if (total !== 0n) return false;
  }
  return true;
}

describe("cashAccountFor — 통화별 현금 계정", () => {
  it("KRW→CASH_KRW, VND→CASH_VND", () => {
    expect(cashAccountFor(Currency.KRW)).toBe(LedgerAccount.CASH_KRW);
    expect(cashAccountFor(Currency.VND)).toBe(LedgerAccount.CASH_VND);
  });
  it("미지원 통화(USD)는 throw — 허위 분개 금지", () => {
    expect(() => cashAccountFor(Currency.USD)).toThrow(/미지원 통화/);
  });
});

describe("buildCollectionLines — 수납 분개", () => {
  it("KRW 수납: CASH_KRW +/ REVENUE −, KRW 합 0", () => {
    const lines = buildCollectionLines(Currency.KRW, 1_000_000n);
    expect(lines).toEqual([
      { account: LedgerAccount.CASH_KRW, currency: Currency.KRW, amount: 1_000_000n },
      { account: LedgerAccount.REVENUE, currency: Currency.KRW, amount: -1_000_000n },
    ]);
    expect(isBalanced(lines)).toBe(true);
  });
  it("VND 수납도 VND 합 0", () => {
    const lines = buildCollectionLines(Currency.VND, 18_000_000n);
    expect(lines[0].account).toBe(LedgerAccount.CASH_VND);
    expect(isBalanced(lines)).toBe(true);
  });
  it("0·음수 수납액은 throw", () => {
    expect(() => buildCollectionLines(Currency.KRW, 0n)).toThrow(/양수/);
    expect(() => buildCollectionLines(Currency.VND, -1n)).toThrow(/양수/);
  });
  it("USD 수납은 throw(현금 계정 없음)", () => {
    expect(() => buildCollectionLines(Currency.USD, 100n)).toThrow(/미지원/);
  });
});

describe("buildCostAccrualLines — 원가·채무 적립", () => {
  it("COGS +/ SUPPLIER_PAYABLE −, VND 합 0", () => {
    const lines = buildCostAccrualLines(18_000_000n);
    expect(lines).toEqual([
      { account: LedgerAccount.COGS, currency: Currency.VND, amount: 18_000_000n },
      {
        account: LedgerAccount.SUPPLIER_PAYABLE,
        currency: Currency.VND,
        amount: -18_000_000n,
      },
    ]);
    expect(isBalanced(lines)).toBe(true);
  });
  it("0·음수는 throw", () => {
    expect(() => buildCostAccrualLines(0n)).toThrow(/양수/);
  });
});

describe("buildPayoutLines — 공급자 지급", () => {
  it("SUPPLIER_PAYABLE +/ CASH_VND −, VND 합 0 (채무 상계)", () => {
    const lines = buildPayoutLines(18_000_000n);
    expect(lines).toEqual([
      {
        account: LedgerAccount.SUPPLIER_PAYABLE,
        currency: Currency.VND,
        amount: 18_000_000n,
      },
      { account: LedgerAccount.CASH_VND, currency: Currency.VND, amount: -18_000_000n },
    ]);
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("buildFxAdjustmentLines — 환차", () => {
  it("이익(+): CASH_VND +/ FX_GAIN_LOSS −, 합 0", () => {
    const lines = buildFxAdjustmentLines(500_000n);
    expect(lines).toEqual([
      { account: LedgerAccount.CASH_VND, currency: Currency.VND, amount: 500_000n },
      {
        account: LedgerAccount.FX_GAIN_LOSS,
        currency: Currency.VND,
        amount: -500_000n,
      },
    ]);
    expect(isBalanced(lines)).toBe(true);
  });
  it("손실(−): CASH_VND −/ FX_GAIN_LOSS +, 합 0", () => {
    const lines = buildFxAdjustmentLines(-300_000n);
    expect(lines[0].amount).toBe(-300_000n);
    expect(lines[1].amount).toBe(300_000n);
    expect(isBalanced(lines)).toBe(true);
  });
  it("0 환차는 분개 없음([]) — 호출부가 거래 생성 skip", () => {
    expect(buildFxAdjustmentLines(0n)).toEqual([]);
  });
});

describe("assertBalanced — 회계항등식 가드", () => {
  it("통화별 합 0이면 통과", () => {
    expect(() => assertBalanced(buildCollectionLines(Currency.KRW, 1n))).not.toThrow();
  });
  it("KRW·VND 혼합도 통화별로 각각 0이면 통과", () => {
    const mixed: JournalLine[] = [
      ...buildCollectionLines(Currency.KRW, 1_000_000n),
      ...buildCostAccrualLines(18_000_000n),
    ];
    expect(() => assertBalanced(mixed)).not.toThrow();
  });
  it("불균형(한 통화 합 ≠ 0)이면 throw", () => {
    const bad: JournalLine[] = [
      { account: LedgerAccount.CASH_KRW, currency: Currency.KRW, amount: 1_000_000n },
      { account: LedgerAccount.REVENUE, currency: Currency.KRW, amount: -900_000n },
    ];
    expect(() => assertBalanced(bad)).toThrow(/불균형/);
  });
  it("통화가 섞여 한쪽만 불균형이어도 throw", () => {
    const bad: JournalLine[] = [
      ...buildCollectionLines(Currency.KRW, 1_000_000n),
      { account: LedgerAccount.COGS, currency: Currency.VND, amount: 18_000_000n },
    ];
    expect(() => assertBalanced(bad)).toThrow(/VND/);
  });
});

describe("전체 생애주기 합산 — 마진·환차 도출", () => {
  it("KRW 수납 + VND 원가/지급/환차의 통화별 누계", () => {
    // 고객 KRW 1,000,000 수납, 공급자 원가 VND 18,000,000, 지급 18,000,000, 환차 +500,000
    const all: JournalLine[] = [
      ...buildCollectionLines(Currency.KRW, 1_000_000n),
      ...buildCostAccrualLines(18_000_000n),
      ...buildPayoutLines(18_000_000n),
      ...buildFxAdjustmentLines(500_000n),
    ];
    const totals = sumByCurrency(all);
    // 각 거래가 통화별 균형이므로 전체 누계도 통화별 0
    expect(totals.get(Currency.KRW)).toBe(0n);
    expect(totals.get(Currency.VND)).toBe(0n);

    // 계정별 잔액 검증
    const bal = new Map<LedgerAccount, bigint>();
    for (const l of all) bal.set(l.account, (bal.get(l.account) ?? 0n) + l.amount);
    expect(bal.get(LedgerAccount.CASH_KRW)).toBe(1_000_000n); // 받은 KRW
    expect(bal.get(LedgerAccount.REVENUE)).toBe(-1_000_000n); // 매출(대변)
    expect(bal.get(LedgerAccount.COGS)).toBe(18_000_000n); // 원가
    expect(bal.get(LedgerAccount.SUPPLIER_PAYABLE)).toBe(0n); // 적립 −18M + 지급 +18M = 0(완납)
    expect(bal.get(LedgerAccount.CASH_VND)).toBe(-17_500_000n); // 지급 −18M + 환차 +0.5M
    expect(bal.get(LedgerAccount.FX_GAIN_LOSS)).toBe(-500_000n); // 환차 이익(대변)
  });
});
