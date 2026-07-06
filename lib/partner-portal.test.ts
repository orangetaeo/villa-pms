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
const mockBookingCount = vi.fn();
const mockBookingFindFirst = vi.fn();
const mockReceivableFindMany = vi.fn();
const mockInvoiceFindMany = vi.fn();
const mockProposalFindMany = vi.fn();
const mockPaymentFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: (...a: unknown[]) => mockBookingFindMany(...a),
      count: (...a: unknown[]) => mockBookingCount(...a),
      findFirst: (...a: unknown[]) => mockBookingFindFirst(...a),
    },
    partnerReceivable: { findMany: (...a: unknown[]) => mockReceivableFindMany(...a) },
    partnerInvoice: { findMany: (...a: unknown[]) => mockInvoiceFindMany(...a) },
    proposal: { findMany: (...a: unknown[]) => mockProposalFindMany(...a) },
    payment: { findMany: (...a: unknown[]) => mockPaymentFindMany(...a) },
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
  mockBookingCount.mockResolvedValue(0);
  mockBookingFindFirst.mockResolvedValue(null);
  mockReceivableFindMany.mockResolvedValue([]);
  mockInvoiceFindMany.mockResolvedValue([]);
  mockProposalFindMany.mockResolvedValue([]);
  mockPaymentFindMany.mockResolvedValue([]);
});

describe("loadPartnerBookings — 스코프·객실료·누수", () => {
  it("where: { partnerId } 로만 조회한다(IDOR 차단)", async () => {
    await loadPartnerBookings("partner-1", { skip: 0, take: 10 });
    const arg = mockBookingFindMany.mock.calls[0][0] as { where: unknown };
    expect(arg.where).toMatchObject({ partnerId: "partner-1" });
  });

  it("select에 판매가(KRW)·원가·마진 필드를 포함하지 않는다(누수 차단)", async () => {
    await loadPartnerBookings("partner-1", { skip: 0, take: 10 });
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
        parentBookingId: null,
        _count: { extensions: 0 },
        villa: { name: "쏘나씨 V11", nameVi: "Sonasea V11", complex: "Sonasea" },
        receivable: { totalVnd: 8_000_000n },
      },
    ]);
    const { rows } = await loadPartnerBookings("partner-1", { skip: 0, take: 10 });
    expect(rows[0].roomChargeVnd).toBe("8000000");
    expect(rows[0].villaName).toBe("쏘나씨 V11");
    expect(rows[0].isExtension).toBe(false);
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
        parentBookingId: null,
        _count: { extensions: 0 },
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
        parentBookingId: "b2", // 연장 자식 케이스
        _count: { extensions: 0 },
        villa: { name: "V25", nameVi: null, complex: null },
        receivable: null,
      },
    ]);
    const { rows } = await loadPartnerBookings("partner-1", { skip: 0, take: 10 });
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
        status: "PENDING", // 미입금(ReceivableStatus 실제 값 — "UNPAID"는 채권 상태가 아님)
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

  it("미수 잔액은 완납·대손(WRITTEN_OFF) 제외 — 운영자 outstandingForPartner와 일치(H2)", async () => {
    // 파트너 자기화면이 대손 채권을 미수에 포함해 운영자 화면보다 큰 잔액을 보이던 버그(H2) 회귀 가드.
    mockReceivableFindMany.mockResolvedValue([
      {
        id: "open", // 미입금 — 미수 집계 대상
        totalVnd: 10_000_000n,
        depositDueVnd: 0n,
        depositPaidVnd: 0n,
        balancePaidVnd: 0n,
        dueDate: new Date("2026-07-20"),
        status: "PENDING",
        booking: { checkIn: new Date("2026-07-01"), checkOut: new Date("2026-07-05"), villa: { name: "V11", nameVi: null } },
      },
      {
        id: "writtenoff", // 대손 — 미수 제외(이력으로 총청구·총납부엔 남음)
        totalVnd: 8_000_000n,
        depositDueVnd: 0n,
        depositPaidVnd: 1_000_000n,
        balancePaidVnd: 0n,
        dueDate: new Date("2026-05-10"),
        status: "WRITTEN_OFF",
        booking: { checkIn: new Date("2026-05-01"), checkOut: new Date("2026-05-03"), villa: { name: "V12", nameVi: null } },
      },
    ]);
    const res = await loadPartnerReceivables("partner-9");
    expect(res.summary.outstandingVnd).toBe("10000000"); // 대손 7M(8M-1M) 제외, open 10M만
    expect(res.summary.totalBilledVnd).toBe("18000000"); // 이력: 10M + 8M
    expect(res.summary.totalPaidVnd).toBe("1000000"); // 이력: 0 + 1M
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

describe("loadPartnerProposals — 스코프·아이템 스냅샷 (T-partner-info 1)", () => {
  it("where: { partnerId } 스코프 + 아이템(빌라·기간·제안가·예약상태) 매핑", async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        token: "tok1",
        expiresAt: new Date("2026-07-30"),
        status: "ACTIVE",
        saleCurrency: "VND",
        items: [
          {
            id: "it1",
            checkIn: new Date("2026-08-01T00:00:00Z"),
            checkOut: new Date("2026-08-04T00:00:00Z"),
            totalKrw: null,
            totalVnd: 12_000_000n,
            totalUsd: null,
            bookingId: "b1", // 이미 가예약됨
            villa: { name: "쏘나씨 V11", nameVi: "Sonasea V11" },
          },
        ],
      },
    ]);
    const rows = await loadPartnerProposals("partner-3");
    const arg = mockProposalFindMany.mock.calls[0][0] as {
      where: unknown;
      select: unknown;
    };
    expect(arg.where).toEqual({ partnerId: "partner-3" });
    // 누수 차단 — 아이템 select에 원가·마진·consumer가 없음
    const keys = flattenSelectKeys(arg.select);
    for (const f of FORBIDDEN_FIELDS) expect(keys).not.toContain(f);
    expect(keys).not.toContain("consumerSalePriceVnd");

    expect(rows[0].itemCount).toBe(1);
    expect(rows[0].saleCurrency).toBe("VND");
    expect(rows[0].items[0]).toMatchObject({
      villaName: "쏘나씨 V11",
      nights: 3,
      totalVnd: "12000000",
      booked: true,
    });
  });
});

// T-partner-polish 4 — 연체 일수 순수함수
import { overdueDaysFor } from "./partner-portal";

describe("overdueDaysFor", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it("기한 경과 일수 — UTC 자정 기준", () => {
    expect(overdueDaysFor(d("2026-07-01"), d("2026-07-03"), 1n)).toBe(2);
  });
  it("당일·미래 기한은 0", () => {
    expect(overdueDaysFor(d("2026-07-03"), d("2026-07-03"), 1n)).toBe(0);
    expect(overdueDaysFor(d("2026-07-10"), d("2026-07-03"), 1n)).toBe(0);
  });
  it("잔액 0이면 기한 지나도 0 (완납 채권은 연체 아님)", () => {
    expect(overdueDaysFor(d("2026-06-01"), d("2026-07-03"), 0n)).toBe(0);
  });
});

// T-partner-info 3 — 입금 이력 쿼리 스코프·누수 가드
describe("loadPartnerReceivables — 입금 이력(Payment)", () => {
  it("receivableId in(본인 채권) + partnerId 이중 스코프, select에 note(내부 메모) 미포함", async () => {
    mockReceivableFindMany.mockResolvedValue([
      {
        id: "rcv1",
        totalVnd: 10_000_000n,
        depositDueVnd: 3_000_000n,
        depositPaidVnd: 3_000_000n,
        balancePaidVnd: 0n,
        dueDate: new Date("2026-07-10"),
        status: "PARTIAL",
        booking: {
          id: "b1",
          checkIn: new Date("2026-07-10"),
          checkOut: new Date("2026-07-12"),
          parentBookingId: null,
          villa: { name: "V11", nameVi: null },
        },
      },
    ]);
    mockPaymentFindMany.mockResolvedValue([
      {
        id: "pay1",
        receivableId: "rcv1",
        receivedAt: new Date("2026-07-01T05:00:00Z"),
        currency: "VND",
        amount: 3_000_000n,
        purpose: "DEPOSIT",
      },
    ]);

    const result = await loadPartnerReceivables("partner-7");
    const arg = mockPaymentFindMany.mock.calls[0][0] as {
      where: { receivableId: { in: string[] }; partnerId: string };
      select: Record<string, unknown>;
    };
    expect(arg.where.partnerId).toBe("partner-7"); // 이중 스코프
    expect(arg.where.receivableId.in).toEqual(["rcv1"]);
    // 내부 메모·환율 등 운영 필드 미노출(누수 가드) — select 화이트리스트 고정
    expect(Object.keys(arg.select)).toEqual(
      expect.arrayContaining(["id", "receivableId", "receivedAt", "currency", "amount", "purpose"])
    );
    expect(arg.select.note).toBeUndefined();
    expect(arg.select.fxRateToVnd).toBeUndefined();

    expect(result.receivables[0].payments).toEqual([
      {
        id: "pay1",
        receivedAt: new Date("2026-07-01T05:00:00Z"),
        currency: "VND",
        amount: "3000000",
        purpose: "DEPOSIT",
      },
    ]);
  });

  it("채권 0건이면 Payment 쿼리를 아예 하지 않는다", async () => {
    mockReceivableFindMany.mockResolvedValue([]);
    await loadPartnerReceivables("partner-7");
    expect(mockPaymentFindMany).not.toHaveBeenCalled();
  });
});

// T-partner-scale 1 — 서버 페이지네이션·필터
describe("loadPartnerBookings — 서버 페이지네이션 (T-partner-scale 1)", () => {
  it("skip/take 전달 + count 기반 total, 어떤 필터에도 partnerId 유지", async () => {
    mockBookingCount.mockResolvedValue(37);
    const { total } = await loadPartnerBookings("partner-1", {
      q: "쏘나",
      from: "2026-07-01",
      to: "2026-07-31",
      skip: 20,
      take: 10,
    });
    expect(total).toBe(37);
    const arg = mockBookingFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
    };
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    expect(arg.where.partnerId).toBe("partner-1"); // ★ 필터가 와도 IDOR 스코프 유지
    expect(arg.where.OR).toBeDefined(); // q → 게스트/빌라 contains
    expect(arg.where.checkOut).toEqual({ gte: new Date("2026-07-01T00:00:00Z") });
    expect(arg.where.checkIn).toEqual({ lte: new Date("2026-07-31T00:00:00Z") });
    // count도 동일 where — 페이지네이션 정합
    const countArg = mockBookingCount.mock.calls[0][0] as { where: unknown };
    expect(countArg.where).toEqual(arg.where);
  });
});

// T-partner-scale 2 — 상세 select 누수 가드(체크인·서비스요청 확장 후에도 금액·PII 미노출)
describe("loadPartnerBookingDetail — select 누수 가드", () => {
  it("select에 서비스 금액(costVnd·priceKrw/Vnd)·옵션·vendor·여권 PII가 없다", async () => {
    const { loadPartnerBookingDetail } = await import("./partner-portal");
    const r = await loadPartnerBookingDetail("partner-1", "b1");
    expect(r).toBeNull(); // mock findFirst → null (미소유 404 경로)
    const arg = mockBookingFindFirst.mock.calls[0][0] as {
      where: unknown;
      select: unknown;
    };
    expect(arg.where).toEqual({ id: "b1", partnerId: "partner-1" });
    const keys = flattenSelectKeys(arg.select);
    for (const f of FORBIDDEN_FIELDS) expect(keys).not.toContain(f);
    for (const f of [
      "costVnd",
      "priceKrw",
      "priceVnd",
      "selectedOptions",
      "vendorId",
      "vendorName",
      "passportPhotoUrls",
      "passportOcrJson",
      "signatureUrl",
      "paperDocUrls",
      "notes",
    ])
      expect(keys).not.toContain(f);
    // 정당 노출 필드는 존재
    for (const f of ["guestNote", "serviceDate", "agreementSignedAt"])
      expect(keys).toContain(f);
  });
});
