import { beforeEach, describe, expect, it, vi } from "vitest";

// rate-calendar-ux — POST /api/villas/[id]/rate-periods/batch (ADJUST·SET·COPY_YEAR) 배선 검증.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));

// rate-calendar-fixes §4 — 읽기·구간화는 $transaction 밖(prisma.*), 캡 count·createMany·audit만 tx.
const tx = {
  villa: { findUnique: vi.fn() },
  villaRatePeriod: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(async () => 0),
    createMany: vi.fn(async () => ({})),
  },
};
vi.mock("@/lib/prisma", () => ({
  // getter로 지연 접근 — 팩토리는 호이스팅되어 tx 초기화 전 실행되므로 즉시 tx.* 접근 불가.
  prisma: {
    get villa() {
      return tx.villa;
    },
    get villaRatePeriod() {
      return tx.villaRatePeriod;
    },
    $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { POST } from "@/app/api/villas/[id]/rate-periods/batch/route";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const baseRow = {
  id: "base", season: "LOW", isBase: true, startDate: null, endDate: null, label: null,
  supplierCostVnd: 1_000_000n, marginType: "PERCENT", marginValue: 20n,
  salePriceVnd: 1_200_000n, salePriceKrw: 60_000,
  consumerMarginType: "PERCENT", consumerMarginValue: 0n, consumerSalePriceVnd: null, consumerSalePriceKrw: null,
  supplierSalePriceVnd: null,
  premiumSupplierCostVnd: null, premiumSalePriceVnd: null, premiumSalePriceKrw: null,
  premiumConsumerSalePriceVnd: null, premiumConsumerSalePriceKrw: null, premiumSupplierSalePriceVnd: null,
};
const highRow = {
  ...baseRow, id: "high", season: "HIGH", isBase: false,
  startDate: utc("2027-01-01"), endDate: utc("2027-01-31"),
  supplierCostVnd: 3_000_000n, salePriceVnd: 3_600_000n, salePriceKrw: 180_000,
};
const peakRow = {
  ...baseRow, id: "peak", season: "PEAK", isBase: false,
  startDate: utc("2027-01-10"), endDate: utc("2027-01-13"),
  supplierCostVnd: 8_000_000n, salePriceVnd: 10_000_000n, salePriceKrw: 500_000,
};

const req = (body: unknown) =>
  POST(
    new Request("http://local/api/villas/v1/rate-periods/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  tx.villa.findUnique.mockResolvedValue({ id: "v1" });
});

describe("권한", () => {
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req({ action: "SET", ranges: [{ start: "2027-01-01", end: "2027-01-05" }], season: "HIGH", prices: { supplierCostVnd: "3000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "3600000", salePriceKrw: 180000 } })).status).toBe(401);
  });
  it("STAFF 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "STAFF" } });
    expect((await req({ action: "SET", ranges: [{ start: "2027-01-01", end: "2027-01-05" }], season: "HIGH", prices: { supplierCostVnd: "3000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "3600000", salePriceKrw: 180000 } })).status).toBe(403);
  });
});

describe("ADJUST — 승자 구간화 + 조정 레이어", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("base+HIGH+PEAK 걸친 range → 3개 레이어, net +10% 반올림, 한 batchId", async () => {
    tx.villaRatePeriod.findFirst.mockResolvedValue(baseRow); // base
    tx.villaRatePeriod.findMany.mockResolvedValue([highRow, peakRow]); // non-base
    const res = await req({
      action: "ADJUST",
      ranges: [{ start: "2026-12-30", end: "2027-01-13" }],
      pct: 10,
      targets: { net: true },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(3);
    expect(json.batchId).toMatch(/^batch_/);
    const rows = (tx.villaRatePeriod.createMany.mock.calls as unknown as [[{ data: any[] }]])[0][0].data;
    expect(rows).toHaveLength(3);
    // 모두 같은 batchId, isBase=false
    expect(new Set(rows.map((r: { batchId: string }) => r.batchId)).size).toBe(1);
    expect(rows.every((r: { isBase: boolean }) => r.isBase === false)).toBe(true);
    // 구간 승자: base(LOW), HIGH, PEAK
    expect(rows.map((r: { season: string }) => r.season)).toEqual(["LOW", "HIGH", "PEAK"]);
    // net +10%: base 1,200,000→1,320,000 · HIGH 3,600,000→3,960,000 · PEAK 10,000,000→11,000,000
    expect(rows.map((r: { salePriceVnd: bigint }) => r.salePriceVnd)).toEqual([1_320_000n, 3_960_000n, 11_000_000n]);
    // cost는 비대상 → 원본 유지
    expect(rows[2].supplierCostVnd).toBe(8_000_000n);
  });

  it("base 없으면 400 BASE_REQUIRED", async () => {
    tx.villaRatePeriod.findFirst.mockResolvedValue(null);
    tx.villaRatePeriod.findMany.mockResolvedValue([]);
    const res = await req({ action: "ADJUST", ranges: [{ start: "2027-01-01", end: "2027-01-03" }], pct: 10, targets: { net: true } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BASE_REQUIRED");
  });

  it("대상 축 없으면 400 NO_TARGET", async () => {
    const res = await req({ action: "ADJUST", ranges: [{ start: "2027-01-01", end: "2027-01-03" }], pct: 10, targets: {} });
    expect(res.status).toBe(400);
  });
});

describe("COPY_YEAR — 연도 시프트 + pct", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("선택 레이어 +1년 시프트, pct +5% 전 컬럼 조정", async () => {
    tx.villaRatePeriod.findMany.mockResolvedValue([peakRow]);
    const res = await req({ action: "COPY_YEAR", srcYear: 2027, dstYear: 2028, layerIds: ["peak"], pct: 5 });
    expect(res.status).toBe(200);
    const rows = (tx.villaRatePeriod.createMany.mock.calls as unknown as [[{ data: any[] }]])[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].startDate).toEqual(utc("2028-01-10"));
    expect(rows[0].endDate).toEqual(utc("2028-01-13"));
    // 8,000,000 × 1.05 = 8,400,000 · 10,000,000 × 1.05 = 10,500,000
    expect(rows[0].supplierCostVnd).toBe(8_400_000n);
    expect(rows[0].salePriceVnd).toBe(10_500_000n);
  });

  it("srcYear==dstYear 400 SAME_YEAR", async () => {
    const res = await req({ action: "COPY_YEAR", srcYear: 2027, dstYear: 2027, layerIds: ["peak"] });
    expect(res.status).toBe(400);
  });
});

describe("SET — range당 레이어 1개", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("2개 range → 2개 레이어, 고정가", async () => {
    const res = await req({
      action: "SET",
      ranges: [
        { start: "2027-03-01", end: "2027-03-05" },
        { start: "2027-04-01", end: "2027-04-03" },
      ],
      season: "SHOULDER",
      label: "이벤트",
      prices: { supplierCostVnd: "2000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "2400000", salePriceKrw: 120000 },
    });
    expect(res.status).toBe(200);
    const rows = (tx.villaRatePeriod.createMany.mock.calls as unknown as [[{ data: any[] }]])[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.every((r: { season: string }) => r.season === "SHOULDER")).toBe(true);
    expect(rows[0].salePriceVnd).toBe(2_400_000n);
  });

  it("start>=end 400 INVALID_RANGE", async () => {
    const res = await req({
      action: "SET",
      ranges: [{ start: "2027-03-05", end: "2027-03-01" }],
      season: "HIGH",
      prices: { supplierCostVnd: "2000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "2400000", salePriceKrw: 120000 },
    });
    expect(res.status).toBe(400);
  });
});

// ── rate-calendar-fixes 후속 수정 ──
describe("§1 pct 하한 검증", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("pct=-150 → 400 VALIDATION_FAILED (gt(-100))", async () => {
    tx.villaRatePeriod.findFirst.mockResolvedValue(baseRow);
    tx.villaRatePeriod.findMany.mockResolvedValue([]);
    const res = await req({
      action: "ADJUST",
      ranges: [{ start: "2027-01-01", end: "2027-01-03" }],
      pct: -150,
      targets: { net: true },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION_FAILED");
    expect(tx.villaRatePeriod.createMany).not.toHaveBeenCalled();
  });

  it("pct=600 → 400 (max(500))", async () => {
    const res = await req({
      action: "ADJUST",
      ranges: [{ start: "2027-01-01", end: "2027-01-03" }],
      pct: 600,
      targets: { net: true },
    });
    expect(res.status).toBe(400);
  });
});

describe("§2 레이어 총량 캡 LAYER_LIMIT", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("기존 non-base 200행 + 신규 1행 → 400 LAYER_LIMIT (사전 count 검사)", async () => {
    tx.villaRatePeriod.count.mockResolvedValue(200); // 이미 캡 도달
    const res = await req({
      action: "SET",
      ranges: [{ start: "2027-03-01", end: "2027-03-05" }],
      season: "HIGH",
      prices: { supplierCostVnd: "2000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "2400000", salePriceKrw: 120000 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("LAYER_LIMIT");
    expect(tx.villaRatePeriod.createMany).not.toHaveBeenCalled();
  });

  it("기존 199행 + 신규 1행 = 200 → 정상(캡 이내)", async () => {
    tx.villaRatePeriod.count.mockResolvedValue(199);
    const res = await req({
      action: "SET",
      ranges: [{ start: "2027-03-01", end: "2027-03-05" }],
      season: "HIGH",
      prices: { supplierCostVnd: "2000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "2400000", salePriceKrw: 120000 },
    });
    expect(res.status).toBe(200);
    expect(tx.villaRatePeriod.createMany).toHaveBeenCalled();
  });
});

describe("§4 range 밤 수 상한 RANGE_TOO_LONG", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("range 1101박(> 1100) → 400 RANGE_TOO_LONG", async () => {
    // 2027-01-01 + 1101일 = 2030-01-06
    const res = await req({
      action: "SET",
      ranges: [{ start: "2027-01-01", end: "2030-01-06" }],
      season: "HIGH",
      prices: { supplierCostVnd: "2000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "2400000", salePriceKrw: 120000 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("RANGE_TOO_LONG");
  });

  it("range 1100박(경계) → 정상", async () => {
    // 2027-01-01 + 1100일 = 2030-01-05
    const res = await req({
      action: "SET",
      ranges: [{ start: "2027-01-01", end: "2030-01-05" }],
      season: "HIGH",
      prices: { supplierCostVnd: "2000000", marginType: "PERCENT", marginValue: "20", salePriceVnd: "2400000", salePriceKrw: 120000 },
    });
    expect(res.status).toBe(200);
  });
});

describe("§3 COPY_YEAR 윤년 경계 — 밤 수 보존", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } }));

  it("[2024-01-01, 2024-02-29) +1년 → [2025-01-01, 2025-03-01) (59박 보존)", async () => {
    const leapRow = {
      ...baseRow, id: "leap", season: "HIGH", isBase: false,
      startDate: utc("2024-01-01"), endDate: utc("2024-02-29"),
    };
    tx.villaRatePeriod.findMany.mockResolvedValue([leapRow]);
    const res = await req({ action: "COPY_YEAR", srcYear: 2024, dstYear: 2025, layerIds: ["leap"] });
    expect(res.status).toBe(200);
    const rows = (tx.villaRatePeriod.createMany.mock.calls as unknown as [[{ data: any[] }]])[0][0].data;
    expect(rows[0].startDate).toEqual(utc("2025-01-01"));
    expect(rows[0].endDate).toEqual(utc("2025-03-01"));
  });
});
