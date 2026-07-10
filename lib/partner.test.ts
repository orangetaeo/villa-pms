import { describe, expect, it } from "vitest";
import { CreditTier, PartnerStatus, ReceivableStatus } from "@prisma/client";
import {
  DEFAULT_DEPOSIT_RATE_PCT,
  agingBuckets,
  canCreateBookingFor,
  computeDepositDue,
  computeDueDate,
  hasOverdue,
  outstandingForPartner,
  receivableOutstanding,
  type ReceivableLike,
} from "./partner";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

function rec(p: Partial<ReceivableLike>): ReceivableLike {
  return {
    totalVnd: 1_000_000n,
    depositPaidVnd: 0n,
    balancePaidVnd: 0n,
    dueDate: utc("2026-07-01"),
    status: ReceivableStatus.PENDING,
    ...p,
  };
}

describe("computeDepositDue", () => {
  it("기본 30%를 올림으로 산출", () => {
    expect(computeDepositDue(1_000_000n, 30)).toBe(300_000n);
  });
  it("나누어떨어지지 않으면 올림(부족수금 방지)", () => {
    // 1,000,001 * 30 / 100 = 300000.3 → 300001
    expect(computeDepositDue(1_000_001n, 30)).toBe(300_001n);
  });
  it("pct는 0~100으로 클램프", () => {
    expect(computeDepositDue(1_000_000n, 150)).toBe(1_000_000n);
    expect(computeDepositDue(1_000_000n, -5)).toBe(0n);
  });
  it("총액 0 이하는 0", () => {
    expect(computeDepositDue(0n, 30)).toBe(0n);
    expect(computeDepositDue(-100n, 30)).toBe(0n);
  });
  it("정책 기본 상수는 30", () => {
    expect(DEFAULT_DEPOSIT_RATE_PCT).toBe(30);
  });
});

describe("computeDueDate", () => {
  it("등급 A는 체크인일이 잔금 기한", () => {
    const due = computeDueDate({ tier: CreditTier.A, checkInDate: utc("2026-07-10") });
    expect(due.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
  it("등급 B는 마감일 + termDays", () => {
    const due = computeDueDate({
      tier: CreditTier.B,
      checkInDate: utc("2026-07-10"),
      periodEnd: utc("2026-07-31"),
      paymentTermDays: 30,
    });
    expect(due.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });
  it("등급 B에서 마감일 미상이면 체크인일 기준 잠정", () => {
    const due = computeDueDate({
      tier: CreditTier.B,
      checkInDate: utc("2026-07-10"),
      paymentTermDays: 15,
    });
    expect(due.toISOString()).toBe("2026-07-25T00:00:00.000Z");
  });
});

describe("receivableOutstanding / outstandingForPartner", () => {
  it("미입금 잔액 = 총액 − 선금 − 잔금", () => {
    expect(
      receivableOutstanding(rec({ totalVnd: 1_000_000n, depositPaidVnd: 300_000n }))
    ).toBe(700_000n);
  });
  it("과입금이어도 음수가 되지 않음", () => {
    expect(
      receivableOutstanding(
        rec({ totalVnd: 1_000_000n, depositPaidVnd: 600_000n, balancePaidVnd: 600_000n })
      )
    ).toBe(0n);
  });
  it("완납·대손은 미수 합계에서 제외", () => {
    const list = [
      rec({ totalVnd: 1_000_000n, status: ReceivableStatus.PENDING }),
      rec({ totalVnd: 2_000_000n, status: ReceivableStatus.PAID }),
      rec({ totalVnd: 5_000_000n, status: ReceivableStatus.WRITTEN_OFF }),
      rec({ totalVnd: 500_000n, depositPaidVnd: 100_000n, status: ReceivableStatus.PARTIAL }),
    ];
    // 1,000,000 + 400,000 = 1,400,000
    expect(outstandingForPartner(list)).toBe(1_400_000n);
  });
});

describe("hasOverdue", () => {
  it("기한 경과 + 미입금이면 연체", () => {
    const list = [rec({ dueDate: utc("2026-07-01"), status: ReceivableStatus.PENDING })];
    expect(hasOverdue(list, utc("2026-07-05"))).toBe(true);
  });
  it("기한 전이면 연체 아님", () => {
    const list = [rec({ dueDate: utc("2026-07-10"), status: ReceivableStatus.PENDING })];
    expect(hasOverdue(list, utc("2026-07-05"))).toBe(false);
  });
  it("'오늘'은 VN 캘린더 기준 — 17:00~23:59 UTC(다음 VN일 새벽)에도 어제 만기는 연체", () => {
    // dueDate 07-01(VN). asOf=2026-07-01T18:00Z = VN 07-02 01:00 → VN 오늘=07-02 > 만기 07-01.
    // 과거 UTC-일 계산은 오늘=07-01로 봐 연체 누락(여신 게이트 오작동). VN-일 전환으로 교정.
    const list = [rec({ dueDate: utc("2026-07-01"), status: ReceivableStatus.PENDING })];
    expect(hasOverdue(list, new Date("2026-07-01T18:00:00.000Z"))).toBe(true);
  });
  it("OVERDUE 상태는 즉시 연체로 취급", () => {
    const list = [rec({ dueDate: utc("2026-08-01"), status: ReceivableStatus.OVERDUE })];
    expect(hasOverdue(list, utc("2026-07-05"))).toBe(true);
  });
  it("완납 채권은 기한 지나도 연체 아님", () => {
    const list = [
      rec({
        totalVnd: 1_000_000n,
        depositPaidVnd: 1_000_000n,
        dueDate: utc("2026-07-01"),
        status: ReceivableStatus.PAID,
      }),
    ];
    expect(hasOverdue(list, utc("2026-07-30"))).toBe(false);
  });
});

describe("canCreateBookingFor", () => {
  const base = {
    creditLimitVnd: 10_000_000n,
    currentOutstandingVnd: 0n,
    overdue: false,
    newCreditVnd: 5_000_000n,
  };

  it("BLOCKED는 무조건 차단", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.A,
      status: PartnerStatus.BLOCKED,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("BLOCKED");
  });

  it("SUSPENDED 차단", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.B,
      status: PartnerStatus.SUSPENDED,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SUSPENDED");
  });

  it("연체 존재 시 차단(자동 제재)", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.B,
      status: PartnerStatus.ACTIVE,
      overdue: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("OVERDUE");
  });

  it("등급 A는 선불 — 한도 무관 통과(노출 0)", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.A,
      status: PartnerStatus.ACTIVE,
      currentOutstandingVnd: 0n,
      newCreditVnd: 99_000_000n, // 한도 초과해도
    });
    expect(r.allowed).toBe(true);
    expect(r.projectedExposureVnd).toBe(0n);
  });

  it("등급 B — 한도 내면 통과", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.B,
      status: PartnerStatus.ACTIVE,
      currentOutstandingVnd: 3_000_000n,
      newCreditVnd: 5_000_000n,
    });
    expect(r.allowed).toBe(true);
    expect(r.projectedExposureVnd).toBe(8_000_000n);
  });

  it("등급 B — 한도 초과면 차단", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.B,
      status: PartnerStatus.ACTIVE,
      currentOutstandingVnd: 8_000_000n,
      newCreditVnd: 5_000_000n,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("LIMIT_EXCEEDED");
    expect(r.projectedExposureVnd).toBe(13_000_000n);
  });

  it("한도 정확히 일치(경계)는 통과", () => {
    const r = canCreateBookingFor({
      ...base,
      tier: CreditTier.B,
      status: PartnerStatus.ACTIVE,
      currentOutstandingVnd: 5_000_000n,
      newCreditVnd: 5_000_000n,
    });
    expect(r.allowed).toBe(true);
  });
});

describe("agingBuckets", () => {
  it("경과 일수로 버킷 분류 + 합계", () => {
    const asOf = utc("2026-08-01");
    const list = [
      rec({ totalVnd: 100_000n, dueDate: utc("2026-07-30") }), // 2일 경과 → 0-7
      rec({ totalVnd: 200_000n, dueDate: utc("2026-07-20") }), // 12일 → 8-15
      rec({ totalVnd: 400_000n, dueDate: utc("2026-07-10") }), // 22일 → 16-30
      rec({ totalVnd: 800_000n, dueDate: utc("2026-06-01") }), // 61일 → 30+
      rec({ totalVnd: 999_000n, dueDate: utc("2026-07-31"), status: ReceivableStatus.PAID }), // 제외
    ];
    const b = agingBuckets(list, asOf);
    expect(b["0-7"]).toBe(100_000n);
    expect(b["8-15"]).toBe(200_000n);
    expect(b["16-30"]).toBe(400_000n);
    expect(b["30+"]).toBe(800_000n);
    expect(b.total).toBe(1_500_000n);
  });

  it("미경과(기한 전) 채권은 0-7(현행)로 집계", () => {
    const asOf = utc("2026-07-01");
    const list = [rec({ totalVnd: 500_000n, dueDate: utc("2026-07-15") })];
    const b = agingBuckets(list, asOf);
    expect(b["0-7"]).toBe(500_000n);
    expect(b.total).toBe(500_000n);
  });

  it("버킷 경계 일수차는 정수로 정확 (7/8·30/31) — −7h 시프트 없음", () => {
    const asOf = utc("2026-08-01"); // VN 오늘 = 2026-08-01 (UTC 자정)
    const list = [
      rec({ totalVnd: 7n, dueDate: utc("2026-07-25") }), // 정확히 7일 → 0-7
      rec({ totalVnd: 8n, dueDate: utc("2026-07-24") }), // 정확히 8일 → 8-15 (버그면 7로 새어 0-7)
      rec({ totalVnd: 30n, dueDate: utc("2026-07-02") }), // 30일 → 16-30
      rec({ totalVnd: 31n, dueDate: utc("2026-07-01") }), // 31일 → 30+ (버그면 30으로 새어 16-30)
    ];
    const b = agingBuckets(list, asOf);
    expect(b["0-7"]).toBe(7n);
    expect(b["8-15"]).toBe(8n);
    expect(b["16-30"]).toBe(30n);
    expect(b["30+"]).toBe(31n);
  });

  it("VN 자정 직후(17:00~23:59 UTC)에도 일수차 정수 유지", () => {
    // asOf=2026-08-01T18:00Z = VN 2026-08-02 01:00 → VN 오늘 2026-08-02
    const asOf = new Date("2026-08-01T18:00:00.000Z");
    const list = [rec({ totalVnd: 8n, dueDate: utc("2026-07-25") })]; // VN오늘 08-02 − 07-25 = 8일
    const b = agingBuckets(list, asOf);
    expect(b["8-15"]).toBe(8n);
    expect(b["0-7"]).toBe(0n);
  });
});
