import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingSeller, ProposalStatus } from "@prisma/client";

// DB·부수효과 모듈 차단 (T1.6 패턴) — DB층 createHoldFromProposalItem 테스트용
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
const mockQuoteStay = vi.fn();
vi.mock("./availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./availability")>();
  return {
    ...actual,
    lockVillaInventory: vi.fn(async () => {}),
    checkAvailability: vi.fn(async () => ({ available: true, sellable: true, reasons: [] })),
  };
});
vi.mock("./pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pricing")>();
  return { ...actual, quoteStayForVilla: (...a: unknown[]) => mockQuoteStay(...a) };
});
vi.mock("./partner-booking", () => ({
  ensureReceivableForBooking: vi.fn(async () => {}),
  evaluateConfirmCredit: vi.fn(async () => ({ allowed: true })),
}));
const mockEnqueueInApp = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("./inapp-notification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inapp-notification")>();
  return { ...actual, enqueueInAppNotification: (...a: unknown[]) => mockEnqueueInApp(...a) };
});

import {
  cancelBooking,
  DEFAULT_HOLD_HOURS,
  computeHoldExpiresAt,
  countNights,
  createHoldFromProposalItem,
  evaluateProposalForHold,
  resolveHoldHours,
} from "./hold";

/** @db.Date 규약과 동일하게 UTC 자정 Date 생성 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-07-01T10:00:00.000Z");

describe("resolveHoldHours — 우선순위: override > AppSetting > 기본 48", () => {
  it("override(제안별 24/48h 선택)가 최우선", () => {
    expect(resolveHoldHours("72", 24)).toBe(24);
    expect(resolveHoldHours(null, 48)).toBe(48);
  });

  it("override 범위 밖·비정수는 RangeError (조용한 폴백 금지 — 호출부 버그)", () => {
    expect(() => resolveHoldHours(null, 0)).toThrow(RangeError);
    expect(() => resolveHoldHours(null, 169)).toThrow(RangeError);
    expect(() => resolveHoldHours(null, 24.5)).toThrow(RangeError);
    expect(() => resolveHoldHours(null, -24)).toThrow(RangeError);
  });

  it("override 없으면 AppSetting 값", () => {
    expect(resolveHoldHours("72")).toBe(72);
    expect(resolveHoldHours("24")).toBe(24);
  });

  it("AppSetting 오염(비숫자·범위 밖)은 기본 48로 폴백 (서비스 중단 금지)", () => {
    expect(resolveHoldHours("abc")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours("0")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours("999")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours("48.5")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours(null)).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours(undefined)).toBe(DEFAULT_HOLD_HOURS);
  });
});

describe("computeHoldExpiresAt", () => {
  it("now + 시간", () => {
    expect(computeHoldExpiresAt(NOW, 48).toISOString()).toBe("2026-07-03T10:00:00.000Z");
    expect(computeHoldExpiresAt(NOW, 24).toISOString()).toBe("2026-07-02T10:00:00.000Z");
  });
});

describe("evaluateProposalForHold — 제안 검증 (SPEC F3)", () => {
  const base = {
    proposalStatus: ProposalStatus.ACTIVE,
    proposalExpiresAt: new Date("2026-07-02T10:00:00.000Z"),
    itemBookingId: null,
    now: NOW,
  };

  it("ACTIVE + 미만료 + 미사용 → 통과(null)", () => {
    expect(evaluateProposalForHold(base)).toBeNull();
  });

  it("이미 가예약된 item → ITEM_ALREADY_BOOKED (상태보다 우선 판정)", () => {
    expect(
      evaluateProposalForHold({ ...base, itemBookingId: "bk_1", proposalStatus: ProposalStatus.USED })
    ).toBe("ITEM_ALREADY_BOOKED");
  });

  it.each([ProposalStatus.USED, ProposalStatus.EXPIRED, ProposalStatus.REVOKED])(
    "제안 status=%s → PROPOSAL_NOT_ACTIVE",
    (status) => {
      expect(evaluateProposalForHold({ ...base, proposalStatus: status })).toBe("PROPOSAL_NOT_ACTIVE");
    }
  );

  it("expiresAt 경과(동시각 포함) → PROPOSAL_EXPIRED — status 갱신 전이라도 시각 기준 거부", () => {
    expect(evaluateProposalForHold({ ...base, proposalExpiresAt: NOW })).toBe("PROPOSAL_EXPIRED");
    expect(
      evaluateProposalForHold({ ...base, proposalExpiresAt: new Date(NOW.getTime() - 1) })
    ).toBe("PROPOSAL_EXPIRED");
  });

  it("expiresAt 미래면 통과", () => {
    expect(
      evaluateProposalForHold({ ...base, proposalExpiresAt: new Date(NOW.getTime() + 1) })
    ).toBeNull();
  });
});

describe("countNights — [checkIn, checkOut) UTC 자정", () => {
  it("박 수 계산", () => {
    expect(countNights({ checkIn: d("2026-07-01"), checkOut: d("2026-07-04") })).toBe(3);
    expect(countNights({ checkIn: d("2026-12-30"), checkOut: d("2027-01-02") })).toBe(3);
  });

  it("0박·역전 거부", () => {
    expect(() => countNights({ checkIn: d("2026-07-01"), checkOut: d("2026-07-01") })).toThrow(RangeError);
    expect(() => countNights({ checkIn: d("2026-07-05"), checkOut: d("2026-07-01") })).toThrow(RangeError);
  });
});

// ===================== createHoldFromProposalItem — seller 전파 (F10 Phase B) =====================

/** proposalItem.findUnique include 결과 — seller 별로 변형 */
function makeHoldTx(opts: { seller: BookingSeller; saleCurrency: "KRW" | "VND" }) {
  const created: Record<string, unknown>[] = [];
  const item = {
    id: "it1",
    villaId: "v1",
    proposalId: "prop1",
    bookingId: null,
    checkIn: d("2026-07-01"),
    checkOut: d("2026-07-04"),
    totalKrw: opts.saleCurrency === "KRW" ? 1_200_000 : null,
    totalVnd: opts.saleCurrency === "VND" ? 6_000_000n : null,
    proposal: {
      status: ProposalStatus.ACTIVE,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      saleCurrency: opts.saleCurrency,
      channel: "DIRECT",
      clientName: "고객",
      seller: opts.seller,
      supplierId: opts.seller === BookingSeller.SUPPLIER ? "sup1" : null,
      fxVndPerKrw: null,
    },
    villa: { supplierId: "sup1", name: "쏘나씨 V1" },
  };
  const tx = {
    proposalItem: {
      findUnique: vi.fn(async () => item),
      update: vi.fn(async () => ({})),
    },
    $executeRaw: vi.fn(async () => 1),
    appSetting: { findUnique: vi.fn(async () => null) },
    booking: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: "bk1", ...args.data };
      }),
    },
    proposal: { updateMany: vi.fn(async () => ({ count: 1 })) },
    notification: { create: vi.fn(async () => ({})) },
    _created: created,
  };
  return tx;
}

function holdPrisma(tx: ReturnType<typeof makeHoldTx>) {
  return {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof createHoldFromProposalItem>[0];
}

const HOLD_INPUT = { proposalItemId: "it1", guestName: "투숙객", guestCount: 2, now: NOW };

describe("createHoldFromProposalItem — seller 전파", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuoteStay.mockResolvedValue({ totalSupplierCostVnd: 4_000_000n });
  });

  it("seller=SUPPLIER: booking.seller=SUPPLIER·supplierSalePriceVnd=item.totalVnd·운영자 원가 견적 생략", async () => {
    const tx = makeHoldTx({ seller: BookingSeller.SUPPLIER, saleCurrency: "VND" });
    await createHoldFromProposalItem(holdPrisma(tx), HOLD_INPUT);
    const data = tx._created[0];
    expect(data.seller).toBe(BookingSeller.SUPPLIER);
    expect(data.supplierSalePriceVnd).toBe(6_000_000n); // item.totalVnd
    expect(data.totalSaleVnd).toBe(6_000_000n);
    expect(data.totalSaleKrw).toBeNull();
    expect(data.supplierCostVnd).toBe(0n); // 우리 원가 무의미 → 0n (스키마 NOT NULL)
    // 운영자 원가 견적 호출 안 됨 (운영자 요율 비참조)
    expect(mockQuoteStay).not.toHaveBeenCalled();
  });

  it("seller=OPERATOR(기존): supplierCostVnd=견적·supplierSalePriceVnd 미설정, 견적 호출됨(회귀 방지)", async () => {
    const tx = makeHoldTx({ seller: BookingSeller.OPERATOR, saleCurrency: "KRW" });
    await createHoldFromProposalItem(holdPrisma(tx), HOLD_INPUT);
    const data = tx._created[0];
    expect(data.seller).toBe(BookingSeller.OPERATOR);
    expect(data.supplierSalePriceVnd).toBeUndefined(); // 설정 안 함
    expect(data.supplierCostVnd).toBe(4_000_000n); // 운영자 원가 견적값
    expect(data.totalSaleKrw).toBe(1_200_000);
    expect(mockQuoteStay).toHaveBeenCalledTimes(1);
  });
});

// ===================== cancelBooking — 부가서비스 연쇄 취소 (A5, admin-ops-gaps) =====================

type OpenOrder = {
  id: string;
  quantity: number;
  serviceDate: Date | null;
  catalogItemId: string | null;
  vendorName: string | null;
  vendorId: string | null;
  vendorStatus: string | null;
  vendor: { userId: string | null; user: { zaloUserId: string | null } | null } | null;
};

function makeCancelTx(openOrders: OpenOrder[]) {
  const notifications: { userId: string; type: string }[] = [];
  const tx = {
    booking: {
      findUnique: vi.fn(async () => ({
        id: "bk1",
        status: "CONFIRMED",
        villaId: "v1",
        checkIn: d("2026-08-10"),
        checkOut: d("2026-08-13"),
        villa: { supplierId: "sup1", name: "썬셋 사나토 A3" },
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ id: "bk1", status: "CANCELLED" })),
    },
    serviceOrder: {
      findMany: vi.fn(async () => openOrders),
      updateMany: vi.fn(async () => ({ count: openOrders.length })),
    },
    serviceCatalogItem: { findUnique: vi.fn(async () => ({ nameKo: "마사지" })) },
    notification: {
      create: vi.fn(async (args: { data: { userId: string; type: string } }) => {
        notifications.push(args.data);
        return {};
      }),
    },
    _notifications: notifications,
  };
  return tx;
}

function cancelPrisma(tx: ReturnType<typeof makeCancelTx>) {
  return {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof cancelBooking>[0];
}

describe("cancelBooking — 미종결 주문 연쇄 취소 + 벤더 통보", () => {
  beforeEach(() => {
    mockEnqueueInApp.mockClear();
  });

  it("REQUESTED·CONFIRMED 주문을 일괄 CANCELLED 처리한다 (DELIVERED 제외 조건으로 조회)", async () => {
    const tx = makeCancelTx([
      { id: "o1", quantity: 1, serviceDate: d("2026-08-11"), catalogItemId: "c1", vendorName: null, vendorId: null, vendorStatus: null, vendor: null },
    ]);
    await cancelBooking(cancelPrisma(tx), { bookingId: "bk1", cancelReason: "테스트", actorUserId: "admin" });
    // 조회 조건이 미종결(REQUESTED·CONFIRMED)만 겨냥하는지
    expect(tx.serviceOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["REQUESTED", "CONFIRMED"] } }),
      })
    );
    expect(tx.serviceOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" }, where: { id: { in: ["o1"] } } })
    );
  });

  it("살아있는 PO(수락됨·Zalo연결)는 벤더에게 VENDOR_PO_CANCELLED Zalo+인앱 통보", async () => {
    const tx = makeCancelTx([
      {
        id: "o2", quantity: 2, serviceDate: d("2026-08-12"), catalogItemId: "c1", vendorName: null,
        vendorId: "sv1", vendorStatus: "VENDOR_ACCEPTED",
        vendor: { userId: "vendor-user", user: { zaloUserId: "z1" } },
      },
    ]);
    await cancelBooking(cancelPrisma(tx), { bookingId: "bk1", cancelReason: "테스트", actorUserId: "admin" });
    const vendorNoti = tx._notifications.filter((n) => n.type === "VENDOR_PO_CANCELLED");
    expect(vendorNoti).toHaveLength(1);
    expect(vendorNoti[0].userId).toBe("vendor-user");
    expect(mockEnqueueInApp).toHaveBeenCalledTimes(1);
  });

  it("발주 안 나간 주문(vendorStatus null)은 벤더 통보 없이 취소만", async () => {
    const tx = makeCancelTx([
      {
        id: "o3", quantity: 1, serviceDate: null, catalogItemId: null, vendorName: null,
        vendorId: "sv1", vendorStatus: null,
        vendor: { userId: "vendor-user", user: { zaloUserId: "z1" } },
      },
    ]);
    await cancelBooking(cancelPrisma(tx), { bookingId: "bk1", cancelReason: "테스트", actorUserId: "admin" });
    expect(tx._notifications.filter((n) => n.type === "VENDOR_PO_CANCELLED")).toHaveLength(0);
    expect(mockEnqueueInApp).not.toHaveBeenCalled();
    expect(tx.serviceOrder.updateMany).toHaveBeenCalled();
  });

  it("주문이 없으면 updateMany를 호출하지 않는다", async () => {
    const tx = makeCancelTx([]);
    await cancelBooking(cancelPrisma(tx), { bookingId: "bk1", cancelReason: "테스트", actorUserId: "admin" });
    expect(tx.serviceOrder.updateMany).not.toHaveBeenCalled();
  });
});
