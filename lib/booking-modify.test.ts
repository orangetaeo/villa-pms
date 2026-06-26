import { describe, expect, it, vi } from "vitest";
import { BookingStatus, CreditTier, Currency } from "@prisma/client";
import {
  BookingModifyRejectedError,
  modifiableKind,
  modifyBooking,
  touchesNonCheckoutFields,
  type ModifyBookingInput,
} from "./booking-modify";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ===================== 순수 함수 =====================

describe("modifiableKind", () => {
  it("HOLD·CONFIRMED → FULL", () => {
    expect(modifiableKind(BookingStatus.HOLD)).toBe("FULL");
    expect(modifiableKind(BookingStatus.CONFIRMED)).toBe("FULL");
  });
  it("CHECKED_IN → CHECKOUT_ONLY", () => {
    expect(modifiableKind(BookingStatus.CHECKED_IN)).toBe("CHECKOUT_ONLY");
  });
  it("종결 상태 → NONE", () => {
    for (const s of [
      BookingStatus.CHECKED_OUT,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
      BookingStatus.NO_SHOW,
    ]) {
      expect(modifiableKind(s)).toBe("NONE");
    }
  });
});

describe("touchesNonCheckoutFields", () => {
  const base: ModifyBookingInput = { bookingId: "b1", actorUserId: "u1", now: utc("2026-07-01") };
  it("checkOut만 변경 → false", () => {
    expect(touchesNonCheckoutFields({ ...base, checkOut: utc("2026-07-05") })).toBe(false);
  });
  it("checkIn 변경 → true", () => {
    expect(touchesNonCheckoutFields({ ...base, checkIn: utc("2026-07-02") })).toBe(true);
  });
  it("villaId·인원·이름·전화·조식 변경 → true", () => {
    expect(touchesNonCheckoutFields({ ...base, villaId: "v2" })).toBe(true);
    expect(touchesNonCheckoutFields({ ...base, guestCount: 3 })).toBe(true);
    expect(touchesNonCheckoutFields({ ...base, guestName: "x" })).toBe(true);
    expect(touchesNonCheckoutFields({ ...base, guestPhone: "1" })).toBe(true);
    expect(touchesNonCheckoutFields({ ...base, breakfastIncluded: true })).toBe(true);
  });
});

// ===================== DB 트랜잭션 (tx mock) =====================

interface BookingRow {
  id: string;
  status: BookingStatus;
  villaId: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guestName: string;
  guestCount: number;
  guestPhone: string | null;
  breakfastIncluded: boolean;
  saleCurrency: Currency;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  supplierCostVnd: bigint;
  villa: { supplierId: string };
  receivable: { id: string } | null;
  partner: { creditTier: CreditTier; paymentTermDays: number } | null;
}

function defaultBooking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: "b1",
    status: BookingStatus.CONFIRMED,
    villaId: "v1",
    checkIn: utc("2026-07-10"),
    checkOut: utc("2026-07-13"),
    nights: 3,
    guestName: "Original",
    guestCount: 2,
    guestPhone: null,
    breakfastIncluded: false,
    saleCurrency: Currency.VND,
    totalSaleKrw: null,
    totalSaleVnd: 3_000_000n,
    supplierCostVnd: 2_400_000n,
    villa: { supplierId: "sup1" },
    receivable: null,
    partner: null,
    ...over,
  };
}

interface FakeTxOpts {
  booking: BookingRow;
  /** 자기 예약 제외 후 다른 예약 겹침 수 (booking.count 두 번째 호출용) */
  otherOverlapCount?: number;
  /** checkAvailability가 보는 villa.status / isSellable */
  villaStatus?: "ACTIVE" | "INACTIVE" | "DRAFT" | "PENDING_REVIEW" | "REJECTED";
  isSellable?: boolean;
  /** calendarBlock 겹침 수 */
  blockCount?: number;
  /** 견적 — 재계산 시 quoteStayForVilla가 읽는 VillaRatePeriod base */
  baseRate?: { supplierCostVnd: bigint; salePriceVnd: bigint; salePriceKrw: number };
  /** 알림 빌라명/공급자 (notifyVilla findUnique) */
  notifyVilla?: { supplierId: string; name: string } | null;
  /** 기존 채권 dueDate (partnerReceivable.findUnique 반환) */
  receivableDueDate?: Date;
}

function makeTx(opts: FakeTxOpts) {
  const updateMany = vi.fn(
    async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
      count: 1,
    })
  );
  const notifCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const auditCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const rcvUpdate = vi.fn(async (_args: { where: { id: string }; data: { dueDate: Date } }) => ({}));
  const base = opts.baseRate ?? {
    supplierCostVnd: 800_000n,
    salePriceVnd: 1_000_000n,
    salePriceKrw: 0,
  };

  // booking.count는 availability(BOOKING_OVERLAP)용 + 자기제외용 두 번 호출될 수 있다.
  // checkAvailability 내부 count는 selfExcludedOverlapWhere가 아니므로, where에 id:{not}이
  // 있으면 "자기 제외" 호출로 간주해 otherOverlapCount, 아니면 availability 내부 호출(0 가정)로 본다.
  const bookingCount = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (where && "id" in where) return opts.otherOverlapCount ?? 0;
    return 0; // checkAvailability 내부 점유 count — 자기제외 분기가 진짜 판정
  });

  const villaFindUnique = vi.fn(async ({ select }: { select?: Record<string, unknown> }) => {
    // checkAvailability: select { status, isSellable }
    if (select && "status" in select) {
      return {
        status: opts.villaStatus ?? "ACTIVE",
        isSellable: opts.isSellable ?? true,
      };
    }
    // notifyVilla: select { supplierId, name }
    if (opts.notifyVilla === null) return null;
    return opts.notifyVilla ?? { supplierId: "sup1", name: "Villa One" };
  });

  const tx = {
    // lockVillaInventory(pg_advisory_xact_lock) — 트랜잭션 락 no-op
    $executeRaw: vi.fn(async () => 0),
    booking: {
      findUnique: vi.fn(async () => opts.booking),
      count: bookingCount,
      updateMany,
      findUniqueOrThrow: vi.fn(async () => {
        // updateMany에 넘긴 data를 반영한 행을 돌려줌(단순화: 마지막 data 머지)
        const lastData = updateMany.mock.calls.at(-1)?.[0]?.data ?? {};
        return { ...opts.booking, ...lastData };
      }),
    },
    villa: { findUnique: villaFindUnique },
    calendarBlock: { count: vi.fn(async () => opts.blockCount ?? 0) },
    villaRatePeriod: {
      findFirst: vi.fn(async () => ({
        season: "LOW",
        isBase: true,
        startDate: null,
        endDate: null,
        ...base,
      })),
      findMany: vi.fn(async () => []),
    },
    notification: { create: notifCreate },
    auditLog: { create: auditCreate },
    partnerReceivable: {
      findUnique: vi.fn(async () => ({
        dueDate: opts.receivableDueDate ?? utc("2026-07-10"),
      })),
      update: rcvUpdate,
    },
  };

  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as never;

  return { prisma, tx, updateMany, notifCreate, auditCreate, bookingCount, rcvUpdate };
}

describe("modifyBooking — 상태 게이트", () => {
  it("종결 상태(CHECKED_OUT)는 STATUS_NOT_MODIFIABLE", async () => {
    const { prisma } = makeTx({ booking: defaultBooking({ status: BookingStatus.CHECKED_OUT }) });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        checkOut: utc("2026-07-14"),
      })
    ).rejects.toMatchObject({ reason: "STATUS_NOT_MODIFIABLE" });
  });

  it("CANCELLED·EXPIRED·NO_SHOW도 거부", async () => {
    for (const status of [BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.NO_SHOW]) {
      const { prisma } = makeTx({ booking: defaultBooking({ status }) });
      await expect(
        modifyBooking(prisma, {
          bookingId: "b1",
          actorUserId: "u1",
          now: utc("2026-07-01"),
          checkOut: utc("2026-07-14"),
        })
      ).rejects.toBeInstanceOf(BookingModifyRejectedError);
    }
  });

  it("CHECKED_IN은 checkOut 외 필드 변경 시 CHECKED_IN_FIELD_LOCKED", async () => {
    const { prisma } = makeTx({ booking: defaultBooking({ status: BookingStatus.CHECKED_IN }) });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        guestCount: 4, // 인원 변경 → 잠금
      })
    ).rejects.toMatchObject({ reason: "CHECKED_IN_FIELD_LOCKED" });
  });

  it("CHECKED_IN + checkOut만 연장 → 허용(재계산·갱신)", async () => {
    const { prisma, updateMany, notifCreate } = makeTx({
      booking: defaultBooking({ status: BookingStatus.CHECKED_IN }),
      baseRate: { supplierCostVnd: 800_000n, salePriceVnd: 1_000_000n, salePriceKrw: 0 },
    });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      checkOut: utc("2026-07-15"), // 3박 → 5박 연장
    });
    expect(res.recalculated).toBe(true);
    expect(res.changedFields).toContain("checkOut");
    // 5박 × 1,000,000 = 5,000,000 VND 재계산
    expect(res.booking.totalSaleVnd).toBe(5_000_000n);
    expect(res.booking.nights).toBe(5);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(notifCreate).toHaveBeenCalledOnce();
  });
});

describe("modifyBooking — 자기 예약 제외 가용성", () => {
  it("자기 구간과만 겹치고 다른 예약 없음 → 통과(겹쳐도 SOLD_OUT 아님)", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking(),
      otherOverlapCount: 0, // 자기 제외 후 0건
    });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      checkOut: utc("2026-07-14"), // 같은 빌라에서 연장
    });
    expect(res.booking.nights).toBe(4);
  });

  it("자기 제외 후에도 다른 예약 겹침 → SOLD_OUT", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking(),
      otherOverlapCount: 1, // 다른 예약 1건 겹침
    });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        checkOut: utc("2026-07-20"),
      })
    ).rejects.toMatchObject({ reason: "SOLD_OUT" });
  });

  it("대상 빌라 차단(BLOCK_OVERLAP) → SOLD_OUT", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking(),
      otherOverlapCount: 0,
      blockCount: 1, // CalendarBlock 겹침
    });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        villaId: "v2",
        checkIn: utc("2026-08-01"),
        checkOut: utc("2026-08-03"),
      })
    ).rejects.toMatchObject({ reason: "SOLD_OUT" });
  });

  it("대상 빌라 판매불가(NOT_SELLABLE) → SOLD_OUT", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking(),
      otherOverlapCount: 0,
      isSellable: false,
    });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        villaId: "v2",
        checkIn: utc("2026-08-01"),
        checkOut: utc("2026-08-03"),
      })
    ).rejects.toMatchObject({ reason: "SOLD_OUT" });
  });

  it("인원만 변경(날짜·빌라 불변) → 가용성 재검증 생략, 재계산 없음", async () => {
    const { prisma, tx } = makeTx({ booking: defaultBooking() });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      guestCount: 5,
    });
    expect(res.recalculated).toBe(false);
    expect(res.changedFields).toEqual(["guestCount"]);
    // calendarBlock.count는 호출되지 않아야 함(가용성 스킵)
    expect(tx.calendarBlock.count).not.toHaveBeenCalled();
    // 금액 컬럼은 그대로(재계산 안 함)
    expect(res.booking.totalSaleVnd).toBe(3_000_000n);
  });
});

describe("modifyBooking — 금액 재계산·통화 정합", () => {
  it("VND 예약: 날짜 연장 시 VND만 채우고 KRW는 null", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking({ saleCurrency: Currency.VND, totalSaleVnd: 3_000_000n, totalSaleKrw: null }),
      baseRate: { supplierCostVnd: 800_000n, salePriceVnd: 1_000_000n, salePriceKrw: 0 },
    });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      checkOut: utc("2026-07-14"), // 4박
    });
    expect(res.booking.totalSaleVnd).toBe(4_000_000n);
    expect(res.booking.totalSaleKrw).toBeNull();
    expect(res.booking.supplierCostVnd).toBe(3_200_000n);
  });

  it("KRW 예약: 날짜 변경 시 KRW만 채우고 VND는 null (assertSaleAmountColumns 정합)", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking({
        saleCurrency: Currency.KRW,
        totalSaleKrw: 900_000,
        totalSaleVnd: null,
      }),
      baseRate: { supplierCostVnd: 800_000n, salePriceVnd: 0n, salePriceKrw: 300_000 },
    });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      checkOut: utc("2026-07-12"), // 2박
    });
    expect(res.booking.totalSaleKrw).toBe(600_000);
    expect(res.booking.totalSaleVnd).toBeNull();
  });
});

describe("modifyBooking — 파트너 채권 정합", () => {
  it("채권 존재 + 빌라 변경 → RECEIVABLE_EXISTS", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking({ receivable: { id: "rcv1" } }),
      otherOverlapCount: 0,
    });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        villaId: "v2",
      })
    ).rejects.toMatchObject({ reason: "RECEIVABLE_EXISTS" });
  });

  it("채권 존재 + 금액 변하는 날짜 변경 → RECEIVABLE_EXISTS", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking({ receivable: { id: "rcv1" }, totalSaleVnd: 3_000_000n }),
      otherOverlapCount: 0,
      baseRate: { supplierCostVnd: 800_000n, salePriceVnd: 1_000_000n, salePriceKrw: 0 },
    });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        checkOut: utc("2026-07-14"), // 4박 → 4,000,000 (≠ 3,000,000)
      })
    ).rejects.toMatchObject({ reason: "RECEIVABLE_EXISTS" });
  });

  it("채권 존재 + 인원만 변경(금액·빌라 불변) → 허용", async () => {
    const { prisma } = makeTx({
      booking: defaultBooking({ receivable: { id: "rcv1" } }),
    });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      guestCount: 3,
    });
    expect(res.changedFields).toEqual(["guestCount"]);
  });

  it("채권 존재 + 체류 시프트(체크인 변경·박수/금액 동일) → 허용 + dueDate 재산정(등급A=새 체크인일)", async () => {
    const { prisma, rcvUpdate } = makeTx({
      booking: defaultBooking({
        receivable: { id: "rcv1" },
        partner: { creditTier: CreditTier.A, paymentTermDays: 0 },
      }),
      receivableDueDate: utc("2026-07-10"),
      otherOverlapCount: 0,
    });
    const res = await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      checkIn: utc("2026-07-11"),
      checkOut: utc("2026-07-14"), // 여전히 3박 → 금액 동일(허용)
    });
    expect(res.changedFields).toContain("checkIn");
    expect(rcvUpdate).toHaveBeenCalledOnce();
    expect(rcvUpdate.mock.calls[0][0].data.dueDate.toISOString().slice(0, 10)).toBe("2026-07-11");
  });

  it("채권 존재(등급B termDays=7) + 체류 시프트 → dueDate = 새 체크인일 + 7", async () => {
    const { prisma, rcvUpdate } = makeTx({
      booking: defaultBooking({
        receivable: { id: "rcv1" },
        partner: { creditTier: CreditTier.B, paymentTermDays: 7 },
      }),
      receivableDueDate: utc("2026-07-17"),
      otherOverlapCount: 0,
    });
    await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      checkIn: utc("2026-07-11"),
      checkOut: utc("2026-07-14"),
    });
    expect(rcvUpdate).toHaveBeenCalledOnce();
    expect(rcvUpdate.mock.calls[0][0].data.dueDate.toISOString().slice(0, 10)).toBe("2026-07-18");
  });

  it("채권 존재 + 인원만 변경(날짜 불변) → dueDate 갱신 안 함", async () => {
    const { prisma, rcvUpdate } = makeTx({
      booking: defaultBooking({
        receivable: { id: "rcv1" },
        partner: { creditTier: CreditTier.A, paymentTermDays: 0 },
      }),
    });
    await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      guestCount: 3,
    });
    expect(rcvUpdate).not.toHaveBeenCalled();
  });
});

describe("modifyBooking — 동시성·변경없음·감사로그", () => {
  it("변경할 필드가 없으면 NO_CHANGES", async () => {
    const { prisma } = makeTx({ booking: defaultBooking({ guestCount: 2 }) });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        guestCount: 2, // 동일값
      })
    ).rejects.toMatchObject({ reason: "NO_CHANGES" });
  });

  it("status 가드 실패(updateMany 0건) → CONCURRENT_MODIFICATION", async () => {
    const { prisma, updateMany } = makeTx({ booking: defaultBooking() });
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      modifyBooking(prisma, {
        bookingId: "b1",
        actorUserId: "u1",
        now: utc("2026-07-01"),
        guestCount: 9,
      })
    ).rejects.toMatchObject({ reason: "CONCURRENT_MODIFICATION" });
  });

  it("AuditLog가 old→new 변경필드로 기록된다", async () => {
    const { prisma, auditCreate } = makeTx({ booking: defaultBooking() });
    await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      guestCount: 6,
      reason: "고객 요청",
    });
    expect(auditCreate).toHaveBeenCalledOnce();
    const data = auditCreate.mock.calls[0][0].data as {
      action: string;
      entity: string;
      changes: Record<string, { old?: unknown; new?: unknown }>;
    };
    expect(data.action).toBe("UPDATE");
    expect(data.entity).toBe("Booking");
    expect(data.changes.guestCount).toEqual({ old: 2, new: 6 });
    expect(data.changes.reason).toEqual({ new: "고객 요청" });
  });

  it("알림 payload에 판매가·마진·원가가 없다(마진 비공개)", async () => {
    const { prisma, notifCreate } = makeTx({ booking: defaultBooking() });
    await modifyBooking(prisma, {
      bookingId: "b1",
      actorUserId: "u1",
      now: utc("2026-07-01"),
      guestCount: 6,
    });
    const notifData = notifCreate.mock.calls[0][0].data as {
      type: string;
      payload: Record<string, unknown>;
    };
    const json = JSON.stringify(notifData.payload);
    expect(json).not.toContain("totalSale");
    expect(json).not.toContain("supplierCost");
    expect(json).not.toContain("margin");
    expect(notifData.type).toBe("BOOKING_MODIFIED");
  });
});
