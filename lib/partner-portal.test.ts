import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 파트너 포털 로더 단위 테스트 (ADR-0028 PP3).
 * 책임 검증:
 *  1. 누수 경계(사업원칙 2) — 모든 쿼리가 where: { partnerId } 스코프 강제(IDOR 차단),
 *     select에 totalSaleKrw·supplierCostVnd·마진 등 운영 전용 필드 비포함.
 *  2. BigInt 미수 합산 정확성 — Number() 변환 없이 totalVnd/paid/outstanding 누적.
 * prisma는 mock — 순수 변환·집계 로직만 검증(DB 무관).
 */

const mockBookingFindMany = vi.fn();
const mockReceivableFindMany = vi.fn();
const mockInvoiceFindMany = vi.fn();
const mockProposalFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: (...a: unknown[]) => mockBookingFindMany(...a) },
    partnerReceivable: { findMany: (...a: unknown[]) => mockReceivableFindMany(...a) },
    partnerInvoice: { findMany: (...a: unknown[]) => mockInvoiceFindMany(...a) },
    proposal: { findMany: (...a: unknown[]) => mockProposalFindMany(...a) },
  },
}));

import {
  loadPartnerBookings,
  loadPartnerReceivables,
  loadPartnerProposals,
} from "./partner-portal";

/** select 객체의 모든 키를 재귀적으로 평탄화(중첩 relation select 포함) — 누수 필드 검사용. */
function flattenSelectKeys(select: unknown, acc: string[] = []): string[] {
  if (select && typeof select === "object") {
    for (const [k, v] of Object.entries(select as Record<string, unknown>)) {
      acc.push(k);
      if (v && typeof v === "object") flattenSelectKeys((v as { select?: unknown }).select, acc);
    }
  }
  return acc;
}

/** 어떤 경계로도 새면 안 되는 운영 전용 필드(원칙 2). */
const FORBIDDEN_FIELDS = [
  "totalSaleKrw",
  "supplierCostVnd",
  "salePriceKrw",
  "salePriceVnd",
  "marginValue",
  "marginType",
  "fxVndPerKrw",
];

beforeEach(() => {
  vi.clearAllMocks();
  mockBookingFindMany.mockResolvedValue([]);
  mockReceivableFindMany.mockResolvedValue([]);
  mockInvoiceFindMany.mockResolvedValue([]);
  mockProposalFindMany.mockResolvedValue([]);
});

describe("loadPartnerBookings — 스코프·객실료·누수", () => {
  it("where: { partnerId } 로만 조회한다(IDOR 차단)", async () => {
    await loadPartnerBookings("partner-1");
    const arg = mockBookingFindMany.mock.calls[0][0] as { where: unknown };
    expect(arg.where).toEqual({ partnerId: "partner-1" });
  });

  it("select에 판매가(KRW)·원가·마진 필드를 포함하지 않는다(누수 차단)", async () => {
    await loadPartnerBookings("partner-1");
    const arg = mockBookingFindMany.mock.calls[0][0] as { select: unknown };
    const keys = flattenSelectKeys(arg.select);
    for (const f of FORBIDDEN_FIELDS) expect(keys).not.toContain(f);
  });

  it("객실료 = receivable.totalVnd 우선(string 변환)", async () => {
    mockBookingFindMany.mockResolvedValue([
      {
        id: "b1",
        checkIn: new Date("2026-07-01"),
        checkOut: new Date("2026-07-03"),
        nights: 2,
        guestName: "Kim",
        guestCount: 2,
        status: "CONFIRMED",
        totalSaleVnd: 9_000_000n,
        villa: { name: "쏘나씨 V11", nameVi: "Sonasea V11", complex: "Sonasea" },
        receivable: { totalVnd: 8_000_000n },
      },
    ]);
    const rows = await loadPartnerBookings("partner-1");
    expect(rows[0].roomChargeVnd).toBe("8000000");
    expect(rows[0].villaName).toBe("쏘나씨 V11");
  });

  it("receivable 없으면 totalSaleVnd 폴백, 둘 다 없으면 null", async () => {
    mockBookingFindMany.mockResolvedValue([
      {
        id: "b2",
        checkIn: new Date("2026-07-01"),
        checkOut: new Date("2026-07-03"),
        nights: 2,
        guestName: "Lee",
        guestCount: 1,
        status: "HOLD",
        totalSaleVnd: 5_000_000n,
        villa: { name: "V12", nameVi: null, complex: null },
        receivable: null,
      },
      {
        id: "b3",
        checkIn: new Date("2026-07-10"),
        checkOut: new Date("2026-07-12"),
        nights: 2,
        guestName: "Park",
        guestCount: 3,
        status: "HOLD",
        totalSaleVnd: null, // KRW 채널 — VND 없음
        villa: { name: "V25", nameVi: null, complex: null },
        receivable: null,
      },
    ]);
    const rows = await loadPartnerBookings("partner-1");
    expect(rows[0].roomChargeVnd).toBe("5000000");
    expect(rows[1].roomChargeVnd).toBeNull();
  });
});

describe("loadPartnerReceivables — 스코프·BigInt 합산", () => {
  it("채권·청구서 모두 where: { partnerId } 스코프", async () => {
    await loadPartnerReceivables("partner-9");
    const recArg = mockReceivableFindMany.mock.calls[0][0] as { where: unknown };
    const invArg = mockInvoiceFindMany.mock.calls[0][0] as { where: unknown };
    expect(recArg.where).toEqual({ partnerId: "partner-9" });
    expect(invArg.where).toEqual({ partnerId: "partner-9" });
  });

  it("미수 요약 = Σtotal, Σ(deposit+balance), Σ(total-deposit-balance) — BigInt 정확", async () => {
    mockReceivableFindMany.mockResolvedValue([
      {
        id: "r1",
        totalVnd: 10_000_000n,
        depositDueVnd: 3_000_000n,
        depositPaidVnd: 3_000_000n,
        balancePaidVnd: 2_000_000n,
        dueDate: new Date("2026-07-20"),
        status: "PARTIAL",
        booking: { checkIn: new Date("2026-07-01"), checkOut: new Date("2026-07-05"), villa: { name: "V11", nameVi: null } },
      },
      {
        id: "r2",
        totalVnd: 7_000_000n,
        depositDueVnd: 0n,
        depositPaidVnd: 0n,
        balancePaidVnd: 0n,
        dueDate: new Date("2026-07-25"),
        status: "UNPAID",
        booking: { checkIn: new Date("2026-07-10"), checkOut: new Date("2026-07-12"), villa: { name: "V12", nameVi: null } },
      },
    ]);
    const res = await loadPartnerReceivables("partner-9");
    // 행별 미수 = total - (deposit+balance)
    expect(res.receivables[0].outstandingVnd).toBe("5000000"); // 10M - 5M
    expect(res.receivables[1].outstandingVnd).toBe("7000000"); // 7M - 0
    // 요약 합산
    expect(res.summary.totalBilledVnd).toBe("17000000"); // 10M + 7M
    expect(res.summary.totalPaidVnd).toBe("5000000"); // (3M+2M) + 0
    expect(res.summary.outstandingVnd).toBe("12000000"); // 5M + 7M
  });

  it("청구서 행은 totalVnd·paidVnd를 string으로 직렬화", async () => {
    mockInvoiceFindMany.mockResolvedValue([
      {
        id: "inv1",
        periodStart: new Date("2026-06-01"),
        periodEnd: new Date("2026-06-30"),
        dueDate: new Date("2026-07-10"),
        totalVnd: 12_345_000n,
        paidVnd: 12_000_000n,
        status: "ISSUED",
        issuedAt: new Date("2026-07-01"),
      },
    ]);
    const res = await loadPartnerReceivables("partner-9");
    expect(res.invoices[0].totalVnd).toBe("12345000");
    expect(res.invoices[0].paidVnd).toBe("12000000");
  });

  it("채권 select에 운영 전용 누수 필드를 포함하지 않는다", async () => {
    await loadPartnerReceivables("partner-9");
    const arg = mockReceivableFindMany.mock.calls[0][0] as { select: unknown };
    const keys = flattenSelectKeys(arg.select);
    for (const f of FORBIDDEN_FIELDS) expect(keys).not.toContain(f);
  });
});

describe("loadPartnerProposals — 스코프·개수만 노출", () => {
  it("where: { partnerId } 스코프 + itemCount 매핑(상세·가격 미노출)", async () => {
    mockProposalFindMany.mockResolvedValue([
      { token: "tok1", expiresAt: new Date("2026-07-30"), status: "ACTIVE", _count: { items: 3 } },
    ]);
    const rows = await loadPartnerProposals("partner-3");
    const arg = mockProposalFindMany.mock.calls[0][0] as { where: unknown };
    expect(arg.where).toEqual({ partnerId: "partner-3" });
    expect(rows[0]).toEqual({
      token: "tok1",
      expiresAt: new Date("2026-07-30"),
      status: "ACTIVE",
      itemCount: 3,
    });
  });
});
