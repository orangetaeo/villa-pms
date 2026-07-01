import { describe, expect, it, vi } from "vitest";
import { BookingStatus, CreditTier, Currency } from "@prisma/client";
import { createLinkedExtensionBooking } from "./booking-extend";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface Opts {
  parent?: Record<string, unknown> | null;
  maxGuests?: number;
  overlap?: number; // checkAvailability 내부 점유 count
  isSellable?: boolean;
  villaStatus?: string;
}

function defaultParent(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    status: BookingStatus.CHECKED_IN,
    villaId: "v1",
    channel: "AGENCY",
    seller: "OPERATOR",
    guestName: "Guest",
    guestCount: 2,
    guestPhone: null,
    breakfastIncluded: false,
    saleCurrency: Currency.VND,
    fxVndPerKrw: null,
    fxVndPerUsd: null,
    partnerId: null,
    ...over,
  };
}

function makePrisma(opts: Opts = {}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "child1",
    ...data,
  }));
  const notifCreate = vi.fn(async () => ({}));
  const auditCreate = vi.fn(async () => ({}));
  const rcvCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rcv1", ...data }));
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    booking: {
      findUnique: vi.fn(async () =>
        opts.parent === undefined ? defaultParent() : opts.parent
      ),
      count: vi.fn(async () => opts.overlap ?? 0),
      create,
    },
    villa: {
      findUnique: vi.fn(async ({ select }: { select?: Record<string, unknown> }) => {
        if (select && "status" in select) {
          return {
            status: opts.villaStatus ?? "ACTIVE",
            isSellable: opts.isSellable ?? true,
            maxGuests: opts.maxGuests ?? 10,
          };
        }
        return { supplierId: "sup2", name: "Villa Two" };
      }),
    },
    calendarBlock: { count: vi.fn(async () => 0) },
    villaRatePeriod: {
      findFirst: vi.fn(async () => ({
        season: "LOW",
        isBase: true,
        startDate: null,
        endDate: null,
        supplierCostVnd: 800_000n,
        salePriceVnd: 1_000_000n,
        salePriceKrw: 0,
      })),
      findMany: vi.fn(async () => []),
    },
    notification: { create: notifCreate },
    auditLog: { create: auditCreate },
    partnerReceivable: { create: rcvCreate },
  };
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as never;
  return { prisma, tx, create, notifCreate, auditCreate, rcvCreate };
}

describe("createLinkedExtensionBooking (ADR-0030 T-E)", () => {
  const baseInput = {
    parentBookingId: "p1",
    villaId: "v2",
    checkIn: utc("2026-07-13"),
    checkOut: utc("2026-07-16"), // 3박
    actorUserId: "u1",
    now: utc("2026-07-12"),
  };

  it("정상: 자식 예약 생성 + parentBookingId 연결 + 전체 견적", async () => {
    const { prisma, create, notifCreate, auditCreate } = makePrisma();
    const res = await createLinkedExtensionBooking(prisma, baseInput);
    expect(res.booking.villaId).toBe("v2");
    expect(res.booking.parentBookingId).toBe("p1");
    expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
    expect(res.booking.nights).toBe(3);
    expect(res.booking.totalSaleVnd).toBe(3_000_000n);
    expect(res.booking.guestCount).toBe(2); // 부모 상속
    expect(create).toHaveBeenCalledOnce();
    expect(notifCreate).toHaveBeenCalledOnce(); // 새 빌라 공급자 알림
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it("역전 구간 → INVALID_RANGE", async () => {
    const { prisma } = makePrisma();
    await expect(
      createLinkedExtensionBooking(prisma, {
        ...baseInput,
        checkIn: utc("2026-07-16"),
        checkOut: utc("2026-07-13"),
      })
    ).rejects.toMatchObject({ reason: "INVALID_RANGE" });
  });

  it("부모 없음 → PARENT_NOT_FOUND", async () => {
    const { prisma } = makePrisma({ parent: null });
    await expect(createLinkedExtensionBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "PARENT_NOT_FOUND",
    });
  });

  it("부모가 HOLD → PARENT_NOT_EXTENDABLE", async () => {
    const { prisma } = makePrisma({ parent: defaultParent({ status: BookingStatus.HOLD }) });
    await expect(createLinkedExtensionBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "PARENT_NOT_EXTENDABLE",
    });
  });

  it("대체 빌라가 부모와 동일 → SAME_VILLA", async () => {
    const { prisma } = makePrisma();
    await expect(
      createLinkedExtensionBooking(prisma, { ...baseInput, villaId: "v1" })
    ).rejects.toMatchObject({ reason: "SAME_VILLA" });
  });

  it("인원 > 대체 빌라 정원 → OVER_CAPACITY", async () => {
    const { prisma } = makePrisma({ maxGuests: 1 }); // 부모 인원 2 > 1
    await expect(createLinkedExtensionBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "OVER_CAPACITY",
    });
  });

  it("대체 빌라 점유 겹침 → SOLD_OUT", async () => {
    const { prisma } = makePrisma({ overlap: 1 });
    await expect(createLinkedExtensionBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "SOLD_OUT",
    });
  });

  it("대체 빌라 미검수(isSellable=false) → SOLD_OUT", async () => {
    const { prisma } = makePrisma({ isSellable: false });
    await expect(createLinkedExtensionBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "SOLD_OUT",
    });
  });

  it("파트너 없는 부모 → 자식 채권 미생성", async () => {
    const { prisma, rcvCreate } = makePrisma();
    await createLinkedExtensionBooking(prisma, baseInput);
    expect(rcvCreate).not.toHaveBeenCalled();
  });

  it("파트너 부모 → 자식 예약도 채권 생성(청구서 추가라인, T-F)", async () => {
    const partnerParent = defaultParent({
      partnerId: "pt1",
      partner: { creditTier: CreditTier.A, depositRatePct: 30, paymentTermDays: 0 },
      totalSaleVnd: 3_000_000n,
      checkIn: utc("2026-07-10"),
      receivable: null,
    });
    const { prisma, rcvCreate } = makePrisma({ parent: partnerParent });
    const res = await createLinkedExtensionBooking(prisma, baseInput);
    expect(res.booking.parentBookingId).toBe("p1");
    expect(rcvCreate).toHaveBeenCalledOnce();
  });
});
