// 벤더 발주 목록 GET — serviceDate 날짜 필터(from/to) 테스트 (vendor-board-date-search)
//   - 4탭(inbox·proposal·schedule·settlement) 목록 where에 serviceDate gte/lte(양끝 포함) 반영
//   - schedule의 cancelled 배너 목록에도 날짜 필터 적용
//   - 탭 뱃지 카운트(inboxCount·proposalPendingCount)·settlement 전역합계(settleTotals)는 날짜 무관 전역 유지
//   - 불량 날짜(형식 오류·실존하지 않는 날짜)는 무시(400 아님)
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
const soCount = vi.fn();
const soFindMany = vi.fn();
const soAggregate = vi.fn();
const catalogFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      count: (...a: unknown[]) => soCount(...a),
      findMany: (...a: unknown[]) => soFindMany(...a),
      aggregate: (...a: unknown[]) => soAggregate(...a),
    },
    serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) },
  },
}));

// 인증/인가
const authFn = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => authFn(...a) }));
vi.mock("@/lib/permissions", () => ({ isVendor: (r?: string) => r === "VENDOR" }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a) }));

vi.mock("@/lib/locale", () => ({ getSupplierLocale: vi.fn(async () => "vi") }));
vi.mock("@/lib/service-display", () => ({
  pickI18n: () => "item",
  selectedOptionLabels: () => [],
}));
vi.mock("@/lib/villa-name", () => ({ formatVillaName: () => "villa" }));

import { GET } from "@/app/api/vendor/orders/route";

const call = (qs: string) => GET(new Request(`http://local/api/vendor/orders?${qs}`));

// where 트리(AND/OR 중첩 포함) 안에 serviceDate 범위 제약이 있는지 재귀 탐색.
function hasServiceDate(w: unknown): boolean {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  const sd = o.serviceDate as { gte?: unknown; lte?: unknown } | undefined;
  if (sd && (sd.gte != null || sd.lte != null)) return true;
  for (const key of ["AND", "OR"] as const) {
    const arr = o[key];
    if (Array.isArray(arr) && arr.some(hasServiceDate)) return true;
  }
  return false;
}

// findMany 호출 중 목록(select=ROW_SELECT) 조회들의 where만 수집.
const listWheres = () => soFindMany.mock.calls.map((c) => (c[0] as { where: unknown }).where);
const countWheres = () => soCount.mock.calls.map((c) => (c[0] as { where: unknown }).where);
const aggregateWheres = () => soAggregate.mock.calls.map((c) => (c[0] as { where: unknown }).where);

beforeEach(() => {
  vi.clearAllMocks();
  authFn.mockResolvedValue({ user: { id: "vu-1", role: "VENDOR", locale: "vi" } });
  getVendorIdForUser.mockResolvedValue("vd-1");
  soCount.mockResolvedValue(0);
  soFindMany.mockResolvedValue([]);
  soAggregate.mockResolvedValue({ _sum: { costVnd: null }, _count: 0 });
  catalogFindMany.mockResolvedValue([]);
});

describe("vendor orders — 날짜 필터(serviceDate from/to)", () => {
  it("inbox: 목록 where에 serviceDate gte/lte 반영, 뱃지 카운트는 날짜 무관", async () => {
    const res = await call("tab=inbox&from=2026-07-01&to=2026-07-31");
    expect(res.status).toBe(200);
    // 목록 findMany 1건 — 날짜 필터 포함
    expect(listWheres().every(hasServiceDate)).toBe(true);
    expect(listWheres().length).toBeGreaterThan(0);
    // 뱃지 카운트(inbox·proposal 미해결) — 어느 count에도 serviceDate 없어야 함
    const badgeCounts = countWheres().filter((w) => {
      const o = w as Record<string, unknown>;
      // 뱃지는 최상위(AND 래핑 아님)로 vendorStatus/proposedServiceDate 직접 포함
      return o.vendorStatus === "PENDING_VENDOR" || o.proposedServiceDate != null;
    });
    expect(badgeCounts.length).toBeGreaterThanOrEqual(2);
    expect(badgeCounts.some(hasServiceDate)).toBe(false);
  });

  it("proposal: 목록 where에 날짜 필터 반영", async () => {
    await call("tab=proposal&from=2026-07-10&to=2026-07-10");
    expect(listWheres().every(hasServiceDate)).toBe(true);
    expect(listWheres().length).toBe(1);
  });

  it("schedule: 목록 + cancelled 배너 목록 모두 날짜 필터 반영", async () => {
    await call("tab=schedule&from=2026-07-01");
    // schedule은 목록 findMany + cancelled findMany 2건 — 둘 다 날짜 필터
    const wheres = listWheres();
    expect(wheres.length).toBe(2);
    expect(wheres.every(hasServiceDate)).toBe(true);
  });

  it("settlement: 목록 where는 날짜 필터, 전역 합계(aggregate)는 날짜 무관", async () => {
    await call("tab=settlement&from=2026-07-01&to=2026-07-31");
    expect(listWheres().every(hasServiceDate)).toBe(true);
    // settleTotals aggregate 2건 — serviceDate 없어야 함(전역 정의)
    expect(aggregateWheres().length).toBe(2);
    expect(aggregateWheres().some(hasServiceDate)).toBe(false);
  });

  it("from만/to만 단방향도 반영", async () => {
    await call("tab=inbox&from=2026-07-05");
    expect(listWheres().every(hasServiceDate)).toBe(true);
  });

  it("불량 날짜(형식 오류·실존하지 않는 날짜)는 무시 — where에 serviceDate 없음, 200", async () => {
    const res = await call("tab=inbox&from=not-a-date&to=2026-13-40");
    expect(res.status).toBe(200);
    expect(listWheres().some(hasServiceDate)).toBe(false);
  });

  it("날짜 파라미터 없으면 필터 미적용", async () => {
    await call("tab=schedule");
    expect(listWheres().some(hasServiceDate)).toBe(false);
  });
});

describe("vendor orders — 이용자 이름 폴백 매핑(customerName)", () => {
  // mapRows가 접근하는 최소 필드셋(null 기본). costVnd는 bigint(.toString()).
  const rowBase = {
    id: "so-1",
    type: "MASSAGE",
    status: "REQUESTED",
    vendorStatus: "PENDING_VENDOR",
    serviceDate: null,
    serviceTime: null,
    quantity: 1,
    costVnd: 0n,
    vendorSettledAt: null,
    vendorSettleMethod: null,
    vendorSettleNote: null,
    poSentAt: null,
    vendorRespondedAt: null,
    vendorCompletedAt: null,
    proposedServiceDate: null,
    proposedServiceTime: null,
    vendorProposalNote: null,
    vendorProposalRespondedAt: null,
    vendorProposalOutcome: null,
    createdAt: null,
    catalogItemId: null,
    vendorName: null,
    guestNote: null,
    customerName: null as string | null,
    selectedOptions: null,
    ticketUrls: [],
    booking: { checkIn: null, checkOut: null, guestCount: 2, guestName: "대표자", villa: null },
  };

  it("주문 스냅샷 우선, 없으면 예약 대표자(guestName) 폴백. 이름만 단일 필드 노출", async () => {
    soFindMany.mockResolvedValueOnce([
      { ...rowBase, id: "so-1", customerName: "김철수" }, // 스냅샷 우선
      { ...rowBase, id: "so-2", customerName: null }, // 폴백 → guestName
    ]);
    const res = await call("tab=inbox");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0].customerName).toBe("김철수");
    expect(json.orders[1].customerName).toBe("대표자");
    // ★이름만 — 전화 등 다른 게스트 PII는 응답에 없어야 함
    expect(json.orders[0]).not.toHaveProperty("guestPhone");
  });
});

describe("vendor orders — 이용자 이름 검색(search)", () => {
  it("search가 customerName + (customerName null → guestName 폴백) 조건을 OR에 포함", async () => {
    const res = await call("tab=inbox&search=김민준");
    expect(res.status).toBe(200);
    const flat = JSON.stringify(listWheres());
    // 스냅샷 직접 매칭
    expect(flat).toContain('"customerName":{"contains":"김민준"');
    // 폴백 매칭 — customerName null인 주문만 대표자명으로(표시 규칙과 동일)
    expect(flat).toContain('"customerName":null');
    expect(flat).toContain('"guestName":{"contains":"김민준"');
  });
});
