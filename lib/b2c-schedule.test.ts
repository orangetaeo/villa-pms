import { describe, it, expect } from "vitest";
import { Prisma, Currency, BookingChannel, BookingSeller } from "@prisma/client";
import { ensureB2cScheduleForBooking, resolveB2cSettings } from "./b2c-schedule";

/** 가짜 Tx — findUnique/appSetting.findMany/create만 구현. create 호출을 캡처. */
function makeTx(opts: {
  booking: Record<string, unknown> | null;
  settings?: { key: string; value: string }[];
}) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    booking: {
      findUnique: async () => opts.booking,
    },
    appSetting: {
      findMany: async () => opts.settings ?? [
        { key: "B2C_DEPOSIT_RATE_PCT", value: "50" },
        { key: "B2C_BALANCE_LEAD_DAYS", value: "14" },
      ],
    },
    b2cPaymentSchedule: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "sched1", ...data };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, created };
}

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// 기본 B2C(직접·KRW) 예약 목 — 앵커 18,500,000동(100만원 × 18.5)
function directKrwBooking(over: Record<string, unknown> = {}) {
  return {
    id: "bk1",
    channel: BookingChannel.DIRECT,
    seller: BookingSeller.OPERATOR,
    partnerId: null,
    saleCurrency: Currency.KRW,
    totalSaleKrw: 1_000_000,
    totalSaleVnd: null,
    totalSaleUsd: null,
    fxVndPerKrw: new Prisma.Decimal("18.5"),
    fxVndPerUsd: null,
    checkIn: d("2026-10-01"),
    b2cSchedule: null,
    ...over,
  };
}

describe("ensureB2cScheduleForBooking — 대상 판정·생성·멱등", () => {
  const now = d("2026-08-01");

  it("DIRECT KRW 예약 → 스케줄 생성(50% 분할, 앵커 보존)", async () => {
    const { tx, created } = makeTx({ booking: directKrwBooking() });
    const res = await ensureB2cScheduleForBooking(tx, "bk1", now);
    expect(res).not.toBeNull();
    expect(created).toHaveLength(1);
    const s = created[0];
    expect(s.totalVnd).toBe(18_500_000n);
    expect(s.depositRatePct).toBe(50);
    expect(s.depositDueVnd).toBe(9_250_000n);
    expect(s.balanceDueVnd).toBe(9_250_000n);
    expect(s.balanceDueDate).toEqual(d("2026-09-17")); // 체크인 − 14
    expect(s.fullPrepay).toBe(false);
  });

  it("파트너 예약 → skip(null, 생성 안 함)", async () => {
    const { tx, created } = makeTx({ booking: directKrwBooking({ partnerId: "p1" }) });
    expect(await ensureB2cScheduleForBooking(tx, "bk1", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("비-DIRECT 채널 → skip", async () => {
    const { tx, created } = makeTx({ booking: directKrwBooking({ channel: BookingChannel.TRAVEL_AGENCY }) });
    expect(await ensureB2cScheduleForBooking(tx, "bk1", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("공급자 직판(seller=SUPPLIER) → skip", async () => {
    const { tx, created } = makeTx({ booking: directKrwBooking({ seller: BookingSeller.SUPPLIER }) });
    expect(await ensureB2cScheduleForBooking(tx, "bk1", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("이미 스케줄 있음 → 멱등 skip", async () => {
    const { tx, created } = makeTx({ booking: directKrwBooking({ b2cSchedule: { id: "existing" } }) });
    expect(await ensureB2cScheduleForBooking(tx, "bk1", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("환율 미설정(앵커 산출 불가) → 생성 보류(null)", async () => {
    const { tx, created } = makeTx({ booking: directKrwBooking({ fxVndPerKrw: null }) });
    expect(await ensureB2cScheduleForBooking(tx, "bk1", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("예약 없음 → null", async () => {
    const { tx } = makeTx({ booking: null });
    expect(await ensureB2cScheduleForBooking(tx, "bk1", now)).toBeNull();
  });

  it("DIRECT VND 예약 → totalSaleVnd 앵커로 생성", async () => {
    const { tx, created } = makeTx({
      booking: directKrwBooking({ saleCurrency: Currency.VND, totalSaleKrw: null, totalSaleVnd: 20_000_000n, fxVndPerKrw: null }),
    });
    const res = await ensureB2cScheduleForBooking(tx, "bk1", now);
    expect(res).not.toBeNull();
    expect(created[0].totalVnd).toBe(20_000_000n);
    expect(created[0].depositDueVnd).toBe(10_000_000n);
  });
});

describe("resolveB2cSettings — AppSetting 파싱·폴백", () => {
  it("설정값 사용", async () => {
    const { tx } = makeTx({ booking: null, settings: [
      { key: "B2C_DEPOSIT_RATE_PCT", value: "30" },
      { key: "B2C_BALANCE_LEAD_DAYS", value: "21" },
    ]});
    expect(await resolveB2cSettings(tx)).toEqual({ depositRatePct: 30, balanceLeadDays: 21 });
  });
  it("미설정·오염값 → 정책 기본(50·14) 폴백", async () => {
    const { tx } = makeTx({ booking: null, settings: [
      { key: "B2C_DEPOSIT_RATE_PCT", value: "abc" },
    ]});
    expect(await resolveB2cSettings(tx)).toEqual({ depositRatePct: 50, balanceLeadDays: 14 });
  });
  it("범위 밖(음수·>100) → 폴백", async () => {
    const { tx } = makeTx({ booking: null, settings: [
      { key: "B2C_DEPOSIT_RATE_PCT", value: "150" },
      { key: "B2C_BALANCE_LEAD_DAYS", value: "-5" },
    ]});
    expect(await resolveB2cSettings(tx)).toEqual({ depositRatePct: 50, balanceLeadDays: 14 });
  });
});
