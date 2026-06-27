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
  summarizeLedgerBalances,
  type AccountBalanceRow,
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
  it("KRW→CASH_KRW, VND→CASH_VND, USD→CASH_USD", () => {
    expect(cashAccountFor(Currency.KRW)).toBe(LedgerAccount.CASH_KRW);
    expect(cashAccountFor(Currency.VND)).toBe(LedgerAccount.CASH_VND);
    expect(cashAccountFor(Currency.USD)).toBe(LedgerAccount.CASH_USD);
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
  it("USD 수납: CASH_USD +/ REVENUE −, USD 합 0", () => {
    const lines = buildCollectionLines(Currency.USD, 1_500n);
    expect(lines).toEqual([
      { account: LedgerAccount.CASH_USD, currency: Currency.USD, amount: 1_500n },
      { account: LedgerAccount.REVENUE, currency: Currency.USD, amount: -1_500n },
    ]);
    expect(isBalanced(lines)).toBe(true);
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

describe("summarizeLedgerBalances — 잔액 대시보드 부호 해석", () => {
  const rows: AccountBalanceRow[] = [
    { account: LedgerAccount.CASH_KRW, currency: Currency.KRW, amount: "1000000" },
    { account: LedgerAccount.CASH_VND, currency: Currency.VND, amount: "-17500000" },
    { account: LedgerAccount.CASH_USD, currency: Currency.USD, amount: "4700" },
    { account: LedgerAccount.SUPPLIER_PAYABLE, currency: Currency.VND, amount: "-5000000" },
    { account: LedgerAccount.REVENUE, currency: Currency.KRW, amount: "-1000000" },
    { account: LedgerAccount.REVENUE, currency: Currency.VND, amount: "-3000000" },
    { account: LedgerAccount.REVENUE, currency: Currency.USD, amount: "-4700" },
    { account: LedgerAccount.COGS, currency: Currency.VND, amount: "18000000" },
    { account: LedgerAccount.FX_GAIN_LOSS, currency: Currency.VND, amount: "-500000" },
  ];

  it("부호 해석 — 현금 그대로, 채무·매출·환차는 반전(양수=의미)", () => {
    const s = summarizeLedgerBalances(rows);
    expect(s.cashKrw).toBe("1000000"); // 보유 KRW
    expect(s.cashVnd).toBe("-17500000"); // 보유 VND(음수=지급 초과 상태 그대로 노출)
    expect(s.cashUsd).toBe("4700"); // 보유 USD(외국 게스트 수납분)
    expect(s.supplierPayableVnd).toBe("5000000"); // 미지급 채무(−5M 대변 → +5M 갚을 돈)
    expect(s.revenueKrw).toBe("1000000"); // 매출(−1M → +1M)
    expect(s.revenueVnd).toBe("3000000");
    expect(s.revenueUsd).toBe("4700"); // USD 매출(−4700 대변 → +4700)
    expect(s.cogsVnd).toBe("18000000"); // 원가 그대로
    expect(s.fxGainLossVnd).toBe("500000"); // 환차 순이익(−0.5M 대변 → +0.5M 이익)
  });

  it("누락 계정·빈 장부는 0", () => {
    const s = summarizeLedgerBalances([]);
    expect(s).toEqual({
      cashKrw: "0",
      cashVnd: "0",
      cashUsd: "0",
      supplierPayableVnd: "0",
      revenueKrw: "0",
      revenueVnd: "0",
      revenueUsd: "0",
      cogsVnd: "0",
      fxGainLossVnd: "0",
    });
  });

  it("환차 손실(차변 +) → 음수 순손익", () => {
    const s = summarizeLedgerBalances([
      { account: LedgerAccount.FX_GAIN_LOSS, currency: Currency.VND, amount: "300000" },
    ]);
    expect(s.fxGainLossVnd).toBe("-300000"); // 손실
  });
});
