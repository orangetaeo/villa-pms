import { describe, expect, it } from "vitest";
import { BookingStatus, Currency } from "@prisma/client";
import { previewBookingModify } from "./booking-modify-preview";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface Opts {
  status?: BookingStatus;
  totalSaleVnd?: bigint | null;
  guestCount?: number;
  maxGuests?: number;
  otherOverlap?: number;
  isSellable?: boolean;
  payments?: { vndEquivalent: bigint | null }[];
  receivable?: { id: string; invoiceId: string | null } | null;
}

function makePrisma(opts: Opts = {}) {
  const booking = {
    id: "b1",
    status: opts.status ?? BookingStatus.CHECKED_IN,
    villaId: "v1",
    checkIn: utc("2026-07-10"),
    checkOut: utc("2026-07-13"), // 3박
    nights: 3,
    guestCount: opts.guestCount ?? 2,
    saleCurrency: Currency.VND,
    totalSaleKrw: null,
    totalSaleVnd: opts.totalSaleVnd ?? 3_000_000n,
    supplierCostVnd: 2_400_000n,
    fxVndPerKrw: null,
    receivable: opts.receivable ?? null,
    payments: opts.payments ?? [],
  };
  return {
    booking: {
      findUnique: async () => booking,
      count: async ({ where }: { where: Record<string, unknown> }) =>
        where && "id" in where ? (opts.otherOverlap ?? 0) : 0,
    },
    villa: {
      findUnique: async ({ select }: { select?: Record<string, unknown> }) => {
        if (select && "status" in select) {
          return {
            status: "ACTIVE",
            isSellable: opts.isSellable ?? true,
            maxGuests: opts.maxGuests ?? 10,
          };
        }
        return { maxGuests: opts.maxGuests ?? 10 };
      },
    },
    calendarBlock: { count: async () => 0 },
    villaRatePeriod: {
      findFirst: async () => ({
        season: "LOW",
        isBase: true,
        startDate: null,
        endDate: null,
        supplierCostVnd: 800_000n,
        salePriceVnd: 1_000_000n,
        salePriceKrw: 0,
      }),
      findMany: async () => [],
    },
  } as never;
}

describe("previewBookingModify (ADR-0030 T-B)", () => {
  it("CHECKED_IN 연장 → 추가청구(+2M), ok", async () => {
    const p = await previewBookingModify(makePrisma(), {
      bookingId: "b1",
      checkOut: utc("2026-07-15"), // 3박 → 5박
    });
    expect(p.ok).toBe(true);
    expect(p.recalculated).toBe(true);
    expect(p.nightsNew).toBe(5);
    expect(p.newSaleVnd).toBe(5_000_000n);
    expect(p.additionalVnd).toBe(2_000_000n);
  });

  it("CHECKED_IN 단축 → 감액 없음(추가청구 0)", async () => {
    const p = await previewBookingModify(makePrisma(), {
      bookingId: "b1",
      checkOut: utc("2026-07-12"), // 3박 → 2박
    });
    expect(p.newSaleVnd).toBe(3_000_000n); // 하한 유지
    expect(p.additionalVnd).toBe(0n);
    expect(p.nightsNew).toBe(2);
  });

  it("인원 정원 초과 → capacityOk=false, blockers OVER_CAPACITY", async () => {
    const p = await previewBookingModify(
      makePrisma({ status: BookingStatus.CONFIRMED, maxGuests: 4 }),
      { bookingId: "b1", guestCount: 6 }
    );
    expect(p.capacityOk).toBe(false);
    expect(p.blockers).toContain("OVER_CAPACITY");
    expect(p.ok).toBe(false);
  });

  it("과수납 감지 — 기수납 > 새 총액", async () => {
    // 확정 상태에서 단축(3박→2박=2M)인데 이미 3M 수납 → 과수납
    const p = await previewBookingModify(
      makePrisma({ status: BookingStatus.CONFIRMED, payments: [{ vndEquivalent: 3_000_000n }] }),
      { bookingId: "b1", checkOut: utc("2026-07-12") }
    );
    expect(p.newSaleVnd).toBe(2_000_000n); // 확정은 감액됨
    expect(p.collectedVnd).toBe(3_000_000n);
    expect(p.overpayment).toBe(true);
  });

  it("파트너 채권 + 같은 빌라 연장(증액) → ok (RECEIVABLE_EXISTS 없음, ADR-0030 §11)", async () => {
    const p = await previewBookingModify(
      makePrisma({ receivable: { id: "rcv1", invoiceId: null } }),
      { bookingId: "b1", checkOut: utc("2026-07-15") } // CHECKED_IN 연장(증액)
    );
    expect(p.blockers).not.toContain("RECEIVABLE_EXISTS");
    expect(p.ok).toBe(true);
    expect(p.additionalVnd).toBe(2_000_000n);
  });

  it("파트너 채권 + 확정 단축(감액) → RECEIVABLE_EXISTS 차단", async () => {
    const p = await previewBookingModify(
      makePrisma({ status: BookingStatus.CONFIRMED, receivable: { id: "rcv1", invoiceId: null } }),
      { bookingId: "b1", checkOut: utc("2026-07-12") } // 감액
    );
    expect(p.blockers).toContain("RECEIVABLE_EXISTS");
  });

  it("CHECKED_IN 인원 변경 시도 → CHECKED_IN_FIELD_LOCKED (D0)", async () => {
    const p = await previewBookingModify(makePrisma({ status: BookingStatus.CHECKED_IN }), {
      bookingId: "b1",
      guestCount: 3,
    });
    expect(p.blockers).toContain("CHECKED_IN_FIELD_LOCKED");
    expect(p.ok).toBe(false);
  });
});
