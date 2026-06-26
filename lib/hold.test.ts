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

import {
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
