import { describe, expect, it, vi } from "vitest";
import ko from "@/messages/ko.json";
import viMsg from "@/messages/vi.json";
import { countNights } from "@/lib/hold";
import { countOverlapReasons, type UnavailableReason } from "@/lib/availability";
import {
  SupplierDirectRejectedError,
  createSupplierDirectBooking,
} from "@/lib/supplier-direct-booking";

// T10.2 공급자 직접예약 (F10, ADR-0021) — 순수 로직·권한 가드·누수 비공개 단위 검증.
// DB 트랜잭션은 tx 클라이언트를 모킹해 분기만 확인(가용성 게이트는 lib/availability 자체 테스트가 커버).

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("countNights — 직접예약 박 수 [checkIn, checkOut)", () => {
  it("1박 (단일 날짜 탭 = date~date+1)", () => {
    expect(countNights({ checkIn: D("2026-07-14"), checkOut: D("2026-07-15") })).toBe(1);
  });
  it("2박", () => {
    expect(countNights({ checkIn: D("2026-07-14"), checkOut: D("2026-07-16") })).toBe(2);
  });
  it("0박·역전 구간은 거부 (RangeError)", () => {
    expect(() => countNights({ checkIn: D("2026-07-14"), checkOut: D("2026-07-14") })).toThrow(
      RangeError
    );
    expect(() => countNights({ checkIn: D("2026-07-16"), checkOut: D("2026-07-14") })).toThrow(
      RangeError
    );
  });
});

describe("countOverlapReasons — 점유(선착순 패배) 판정만 카운트", () => {
  it("예약·차단 겹침만 센다 (검수 게이트 NOT_SELLABLE은 D4로 무시)", () => {
    const reasons: UnavailableReason[] = ["NOT_SELLABLE"];
    expect(countOverlapReasons(reasons)).toBe(0); // 직접판매는 isSellable 무시(D4)
  });
  it("BOOKING_OVERLAP / BLOCK_OVERLAP 은 점유로 카운트", () => {
    expect(countOverlapReasons(["BOOKING_OVERLAP"])).toBe(1);
    expect(countOverlapReasons(["BLOCK_OVERLAP"])).toBe(1);
    expect(countOverlapReasons(["BOOKING_OVERLAP", "BLOCK_OVERLAP", "NOT_SELLABLE"])).toBe(2);
  });
});

// ── createSupplierDirectBooking 분기 (tx 모킹) ──
// $transaction(cb) → cb(tx) 즉시 실행하는 가짜 prisma. lockVillaInventory($executeRaw) no-op.
function makeFakePrisma(opts: {
  villa: { id: string; name: string; status: string } | null;
  overlapReasons?: UnavailableReason[];
  operators?: { id: string }[];
}) {
  const created: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    villa: {
      findFirst: vi.fn().mockResolvedValue(opts.villa),
      // checkAvailability가 내부에서 호출하는 findUnique/count
      findUnique: vi.fn().mockResolvedValue(
        opts.villa ? { status: opts.villa.status, isSellable: true } : null
      ),
    },
    booking: {
      count: vi.fn().mockImplementation(() =>
        Promise.resolve((opts.overlapReasons ?? []).includes("BOOKING_OVERLAP") ? 1 : 0)
      ),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "bk_1", nights: data.nights, ...data };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    calendarBlock: {
      count: vi.fn().mockImplementation(() =>
        Promise.resolve((opts.overlapReasons ?? []).includes("BLOCK_OVERLAP") ? 1 : 0)
      ),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    user: { findMany: vi.fn().mockResolvedValue(opts.operators ?? []) },
    notification: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        notifications.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { prisma: prisma as any, tx, created, notifications };
}

const baseInput = {
  villaId: "v1",
  supplierId: "sup1",
  range: { checkIn: D("2026-07-14"), checkOut: D("2026-07-16") },
  guestName: "Trần Minh",
  guestCount: 6,
};

describe("createSupplierDirectBooking — 권한·가드 분기", () => {
  it("타인/없는 빌라 → VILLA_NOT_FOUND (존재 비노출)", async () => {
    const { prisma } = makeFakePrisma({ villa: null });
    await expect(createSupplierDirectBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "VILLA_NOT_FOUND",
    });
  });

  it("ACTIVE 아닌 빌라 → VILLA_NOT_ACTIVE", async () => {
    const { prisma } = makeFakePrisma({
      villa: { id: "v1", name: "Sonasea V12", status: "INACTIVE" },
    });
    await expect(createSupplierDirectBooking(prisma, baseInput)).rejects.toMatchObject({
      reason: "VILLA_NOT_ACTIVE",
    });
  });

  it("점유(운영자 예약/차단 겹침) → OCCUPIED (선착순 패배, 상세 비노출)", async () => {
    const { prisma } = makeFakePrisma({
      villa: { id: "v1", name: "Sonasea V12", status: "ACTIVE" },
      overlapReasons: ["BOOKING_OVERLAP"],
    });
    const err = await createSupplierDirectBooking(prisma, baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(SupplierDirectRejectedError);
    expect(err.reason).toBe("OCCUPIED");
  });

  it("정상 → seller=SUPPLIER·CONFIRMED·DIRECT·VND·원가 0·supplierCostVnd BigInt", async () => {
    const { prisma, created } = makeFakePrisma({
      villa: { id: "v1", name: "Sonasea V12", status: "ACTIVE" },
    });
    const booking = await createSupplierDirectBooking(prisma, {
      ...baseInput,
      supplierSalePriceVnd: 4_500_000n,
    });
    expect(booking.id).toBe("bk_1");
    const data = created[0];
    expect(data.seller).toBe("SUPPLIER");
    expect(data.status).toBe("CONFIRMED");
    expect(data.channel).toBe("DIRECT");
    expect(data.saleCurrency).toBe("VND");
    expect(data.supplierCostVnd).toBe(0n); // 우리 매입 없음 (BigInt 0)
    expect(data.supplierSalePriceVnd).toBe(4_500_000n);
    expect(data.nights).toBe(2);
    // 운영자 통지 payload에 판매가·마진·공급자 받은 금액 절대 미포함 (누수 0)
    expect(data.totalSaleKrw).toBeUndefined();
  });

  it("supplierSalePriceVnd 미입력 시 null", async () => {
    const { prisma, created } = makeFakePrisma({
      villa: { id: "v1", name: "Sonasea V12", status: "ACTIVE" },
    });
    await createSupplierDirectBooking(prisma, baseInput);
    expect(created[0].supplierSalePriceVnd).toBeNull();
  });

  it("운영자 통지 payload — 판매가·마진 키 없음(villaName·날짜·인원만)", async () => {
    const { prisma, notifications } = makeFakePrisma({
      villa: { id: "v1", name: "Sonasea V12", status: "ACTIVE" },
      operators: [{ id: "op1" }],
    });
    await createSupplierDirectBooking(prisma, { ...baseInput, supplierSalePriceVnd: 9_999n });
    expect(notifications).toHaveLength(1);
    const payload = notifications[0].payload as Record<string, unknown>;
    expect(payload).toEqual({
      villaName: "Sonasea V12",
      checkIn: "2026-07-14",
      checkOut: "2026-07-16",
      guestCount: 6,
    });
    // 공급자 받은 금액·판매가·마진 키가 통지에 새지 않는다
    expect(payload.supplierSalePriceVnd).toBeUndefined();
    expect(payload.totalSaleKrw).toBeUndefined();
  });

  it("빈 고객명·잘못된 인원은 RangeError", async () => {
    const { prisma } = makeFakePrisma({
      villa: { id: "v1", name: "Sonasea V12", status: "ACTIVE" },
    });
    await expect(
      createSupplierDirectBooking(prisma, { ...baseInput, guestName: "  " })
    ).rejects.toThrow(RangeError);
    await expect(
      createSupplierDirectBooking(prisma, { ...baseInput, guestCount: 0 })
    ).rejects.toThrow(RangeError);
  });
});

// ── i18n 키 동기 (next-intl 누락 키 throw 방지) ──
const DIRECT_KEYS = [
  "recordOption",
  "dateLabel",
  "checkIn",
  "checkOut",
  "guestName",
  "guestNamePlaceholder",
  "guestCount",
  "guestsWord",
  "decrease",
  "increase",
  "amountLabel",
  "contactLabel",
  "contactPlaceholder",
  "optional",
  "save",
  "saving",
  // F10 T10.2b 다박(기간) 선택
  "nightsLabel",
  "nights",
  "decreaseNights",
  "increaseNights",
] as const;

// 다박 폼 요일 힌트 — calendar.direct.weekdayShort (중첩 객체, 7개 요일)
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

describe("i18n 키 — calendar.direct (F10 직접예약 폼)", () => {
  it("ko/vi 모두 calendar.direct 네임스페이스 보유", () => {
    expect((ko.calendar as Record<string, unknown>).direct).toBeDefined();
    expect((viMsg.calendar as Record<string, unknown>).direct).toBeDefined();
  });
  it.each(DIRECT_KEYS)("키 '%s' 존재 (ko·vi 비어있지 않음)", (key) => {
    const k = (ko.calendar as unknown as { direct: Record<string, string> }).direct;
    const v = (viMsg.calendar as unknown as { direct: Record<string, string> }).direct;
    expect(k[key]?.length).toBeGreaterThan(0);
    expect(v[key]?.length).toBeGreaterThan(0);
  });
  it.each(WEEKDAY_KEYS)("weekdayShort.%s 존재 (ko·vi 비어있지 않음)", (key) => {
    const k = (ko.calendar as unknown as { direct: { weekdayShort: Record<string, string> } })
      .direct.weekdayShort;
    const v = (viMsg.calendar as unknown as { direct: { weekdayShort: Record<string, string> } })
      .direct.weekdayShort;
    expect(k[key]?.length).toBeGreaterThan(0);
    expect(v[key]?.length).toBeGreaterThan(0);
  });
});
