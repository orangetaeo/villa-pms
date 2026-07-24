import { describe, it, expect, beforeEach, vi } from "vitest";
import { Currency, B2cScheduleStatus } from "@prisma/client";

// enqueue 캡처 + FX 고정(1원=18.5동) — vi.hoisted로 mock보다 먼저 초기화
const { enqueued } = vi.hoisted(() => ({ enqueued: [] as { type: string; payload: Record<string, unknown> }[] }));
vi.mock("./fx-effective", () => ({
  getEffectiveFxVndPerKrw: async () => "18.5",
  getEffectiveFxVndPerUsd: async () => "25400",
}));
vi.mock("./operator-notify", () => ({
  enqueueOperatorNotification: async (p: { type: string; payload: Record<string, unknown> }) => {
    enqueued.push(p);
    return 1;
  },
}));

import { notifyB2cBalancesDue } from "./b2c-schedule";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function fakeDb(schedules: unknown[]) {
  return { b2cPaymentSchedule: { findMany: async () => schedules } } as never;
}

const krwSchedule = {
  balanceDueVnd: 9_250_000n,
  booking: {
    id: "bk1",
    saleCurrency: Currency.KRW,
    guestName: "김학태",
    checkIn: d("2026-09-14"),
    villa: { name: "선셋 빌라" },
  },
};

describe("notifyB2cBalancesDue — D-14 잔금 도래 운영자 알림", () => {
  beforeEach(() => {
    enqueued.length = 0;
  });

  it("KRW 잔금 도래 1건 → 운영자 알림 1건(추정 원화 + VND 앵커)", async () => {
    const res = await notifyB2cBalancesDue(fakeDb([krwSchedule]), d("2026-08-31"));
    expect(res).toEqual({ targetCount: 1, notificationCount: 1 });
    expect(enqueued).toHaveLength(1);
    const n = enqueued[0];
    expect(n.type).toBe("B2C_BALANCE_DUE");
    expect(n.payload.bookingId).toBe("bk1");
    expect(n.payload.billingCurrency).toBe(Currency.KRW);
    expect(n.payload.balanceDueVnd).toBe("9250000");
    // 9,250,000동 ÷ 18.5 = 500,000원 (현재 환율 추정)
    expect(n.payload.balanceBilledApprox).toBe(500_000);
    expect(n.payload.villaName).toBe("선셋 빌라");
  });

  it("VND 잔금 → 추정 환산 없이 VND만(balanceBilledApprox=null)", async () => {
    const vndSchedule = {
      balanceDueVnd: 10_000_000n,
      booking: { ...krwSchedule.booking, saleCurrency: Currency.VND },
    };
    await notifyB2cBalancesDue(fakeDb([vndSchedule]), d("2026-08-31"));
    expect(enqueued[0].payload.balanceBilledApprox).toBeNull();
    expect(enqueued[0].payload.balanceDueVnd).toBe("10000000");
  });

  it("도래 0건 → 알림 없음", async () => {
    const res = await notifyB2cBalancesDue(fakeDb([]), d("2026-08-31"));
    expect(res).toEqual({ targetCount: 0, notificationCount: 0 });
    expect(enqueued).toHaveLength(0);
  });
});
