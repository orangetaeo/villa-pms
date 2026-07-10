import { describe, expect, it } from "vitest";
import { ServiceOrderStatus, ServiceVendorStatus } from "@prisma/client";
import { resolveStatsPeriod } from "@/lib/statistics";
import {
  acceptanceRateOrNull,
  aggregateVendorStats,
  attributionDate,
  changeRateOrNull,
  formatVndDot,
  isRevenueOrder,
  loadVendorStats,
} from "@/lib/vendor-stats";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-07-15T12:00:00.000Z");

// 평탄화된 OrderRow 빌더 — aggregateVendorStats 직접 테스트용
function row(p: {
  vendorStatus?: ServiceVendorStatus | null;
  status?: ServiceOrderStatus;
  costVnd?: bigint;
  quantity?: number;
  serviceDate?: Date | null;
  checkOut?: Date | null;
  createdAt?: Date;
  vendorSettledAt?: Date | null;
  itemLabel?: string;
}) {
  return {
    vendorStatus: p.vendorStatus ?? ServiceVendorStatus.VENDOR_ACCEPTED,
    status: p.status ?? ServiceOrderStatus.CONFIRMED,
    costVnd: p.costVnd ?? 1_000_000n,
    quantity: p.quantity ?? 1,
    serviceDate: p.serviceDate ?? null,
    checkOut: p.checkOut ?? null,
    createdAt: p.createdAt ?? d("2026-07-10"),
    vendorSettledAt: p.vendorSettledAt ?? null,
    itemLabel: p.itemLabel ?? "과일 플래터",
  };
}

describe("formatVndDot — 공급자 점 구분 표기", () => {
  it("천 단위 점 구분 + ₫", () => {
    expect(formatVndDot(45_000_000n)).toBe("45.000.000₫");
    expect(formatVndDot(0n)).toBe("0₫");
    expect(formatVndDot(1_500n)).toBe("1.500₫");
  });
});

describe("acceptanceRateOrNull — 수락/(수락+거절)", () => {
  it("정상 수락율", () => {
    expect(acceptanceRateOrNull(3, 1)).toBe(75);
    expect(acceptanceRateOrNull(1, 1)).toBe(50);
  });
  it("응답 0건 → null", () => {
    expect(acceptanceRateOrNull(0, 0)).toBeNull();
  });
});

describe("changeRateOrNull — ÷0 방지", () => {
  it("정상 증감률", () => {
    expect(changeRateOrNull(150, 100)).toBe(50);
  });
  it("이전값 0·null → null", () => {
    expect(changeRateOrNull(100, 0)).toBeNull();
    expect(changeRateOrNull(100, null)).toBeNull();
  });
});

describe("isRevenueOrder — 수락 + 확정/이행만", () => {
  it("수락 + CONFIRMED/DELIVERED → true", () => {
    expect(isRevenueOrder({ vendorStatus: ServiceVendorStatus.VENDOR_ACCEPTED, status: ServiceOrderStatus.CONFIRMED })).toBe(true);
    expect(isRevenueOrder({ vendorStatus: ServiceVendorStatus.VENDOR_ACCEPTED, status: ServiceOrderStatus.DELIVERED })).toBe(true);
  });
  it("거절·대기·취소·미응답 → false", () => {
    expect(isRevenueOrder({ vendorStatus: ServiceVendorStatus.VENDOR_REJECTED, status: ServiceOrderStatus.CONFIRMED })).toBe(false);
    expect(isRevenueOrder({ vendorStatus: ServiceVendorStatus.PENDING_VENDOR, status: ServiceOrderStatus.CONFIRMED })).toBe(false);
    expect(isRevenueOrder({ vendorStatus: ServiceVendorStatus.VENDOR_ACCEPTED, status: ServiceOrderStatus.CANCELLED })).toBe(false);
    expect(isRevenueOrder({ vendorStatus: ServiceVendorStatus.VENDOR_ACCEPTED, status: ServiceOrderStatus.REQUESTED })).toBe(false);
    expect(isRevenueOrder({ vendorStatus: null, status: ServiceOrderStatus.CONFIRMED })).toBe(false);
  });
});

describe("attributionDate — serviceDate > checkOut > createdAt", () => {
  it("serviceDate 우선", () => {
    expect(attributionDate({ serviceDate: d("2026-07-05"), checkOut: d("2026-07-09"), createdAt: d("2026-07-01") })).toEqual(d("2026-07-05"));
  });
  it("serviceDate 없으면 checkOut", () => {
    expect(attributionDate({ serviceDate: null, checkOut: d("2026-07-09"), createdAt: d("2026-07-01") })).toEqual(d("2026-07-09"));
  });
  it("둘 다 없으면 createdAt", () => {
    expect(attributionDate({ serviceDate: null, checkOut: null, createdAt: d("2026-07-01") })).toEqual(d("2026-07-01"));
  });
});

const ZERO_SETTLE = { unsettledVnd: 0n, settledVnd: 0n };

describe("aggregateVendorStats — 매출·수락율·품목·정산", () => {
  const period = resolveStatsPeriod({ range: "thisMonth" }, NOW);

  it("매출 = 수락+확정/이행만, 거절·대기·취소 제외", () => {
    const stats = aggregateVendorStats(
      [
        // 매출 산입: 10M (수락+CONFIRMED) + 3M (수락+DELIVERED, 수량 2개지만 costVnd는 이미 라인 총액 — 이중곱 금지)
        row({ serviceDate: d("2026-07-10"), costVnd: 10_000_000n, quantity: 1, itemLabel: "BBQ" }),
        row({ serviceDate: d("2026-07-12"), status: ServiceOrderStatus.DELIVERED, costVnd: 3_000_000n, quantity: 2, itemLabel: "과일" }),
        // 제외: 거절
        row({ serviceDate: d("2026-07-11"), vendorStatus: ServiceVendorStatus.VENDOR_REJECTED, costVnd: 99_000_000n }),
        // 제외: 대기(미응답)
        row({ serviceDate: d("2026-07-13"), vendorStatus: ServiceVendorStatus.PENDING_VENDOR, costVnd: 88_000_000n }),
        // 제외: 수락이나 취소 상태
        row({ serviceDate: d("2026-07-14"), status: ServiceOrderStatus.CANCELLED, costVnd: 77_000_000n }),
      ],
      period,
      ZERO_SETTLE
    );

    expect(stats.totalVnd).toBe(13_000_000); // 10M + 3M(라인 총액 그대로 — ×quantity 이중곱 없음)
    expect(stats.totalVndText).toBe("13.000.000₫");
    expect(stats.orderCount).toBe(2);
    // 수락율: ACCEPTED vendorStatus 3건(BBQ·과일·취소상태행) / (수락 3 + 거절 1) = 75
    expect(stats.acceptanceRatePct).toBe(75);
    // 평균 단가 = 13M / 2 = 6.5M
    expect(stats.avgUnitVnd).toBe(6_500_000);
    // 품목 Top: BBQ 10M > 과일 3M
    expect(stats.topItems.map((i) => i.itemLabel)).toEqual(["BBQ", "과일"]);
    expect(stats.topItems[1].quantity).toBe(2);
    expect(stats.revenueTrend.length).toBe(period.buckets.length);
  });

  it("정산 잔액 = settle 인자 패스스루(전역 잔액은 loadVendorStats가 정산탭과 동일 쿼리로 공급)", () => {
    const stats = aggregateVendorStats(
      [
        // 수락 + REQUESTED(고객확정 전) — 매출엔 미산입(정산 잔액은 이 함수 밖에서 전역 계산)
        row({ serviceDate: d("2026-07-10"), status: ServiceOrderStatus.REQUESTED, costVnd: 3_000_000n }),
        row({ serviceDate: d("2026-07-11"), costVnd: 5_000_000n }),
      ],
      period,
      { unsettledVnd: 8_000_000n, settledVnd: 6_000_000n }
    );
    expect(stats.unsettledVnd).toBe(8_000_000);
    expect(stats.unsettledVndText).toBe("8.000.000₫");
    expect(stats.settledVnd).toBe(6_000_000);
    expect(stats.totalVnd).toBe(5_000_000); // 매출은 CONFIRMED만
  });

  it("빈 데이터 → 0 그레이스풀", () => {
    const stats = aggregateVendorStats([], period, ZERO_SETTLE);
    expect(stats.totalVnd).toBe(0);
    expect(stats.orderCount).toBe(0);
    expect(stats.acceptanceRatePct).toBeNull();
    expect(stats.avgUnitVnd).toBe(0);
    expect(stats.topItems).toEqual([]);
    expect(stats.unsettledVnd).toBe(0);
    expect(stats.settledVnd).toBe(0);
  });

  it("누수 가드 — 반환 객체에 금지 필드 키 0개", () => {
    const stats = aggregateVendorStats(
      [row({ serviceDate: d("2026-07-10"), costVnd: 5_000_000n })],
      period,
      ZERO_SETTLE
    );
    const json = JSON.stringify(stats);
    expect(json).not.toMatch(/sale|margin|priceKrw|priceVnd|krw/i);
  });
});

// ── 가짜 PrismaClient — vendorId 스코프 강제 검증 ──
type AnyArgs = { where?: { vendorId?: string; id?: { in: string[] } } };

function fakeDb(opts: {
  orders: Array<{
    vendorId: string;
    vendorStatus: ServiceVendorStatus | null;
    status: ServiceOrderStatus;
    costVnd: bigint;
    quantity: number;
    serviceDate: Date | null;
    vendorSettledAt: Date | null;
    createdAt: Date;
    type: ServiceOrderStatus | string;
    vendorName: string | null;
    catalogItemId: string | null;
    booking: { checkOut: Date } | null;
  }>;
}) {
  return {
    serviceOrder: {
      findMany: async (args: AnyArgs) => {
        // ★ 스코프 강제 검증 — vendorId 필수
        expect(args.where?.vendorId).toBeDefined();
        const vid = args.where!.vendorId!;
        return opts.orders.filter((o) => o.vendorId === vid);
      },
    },
    serviceCatalogItem: {
      findMany: async () => [],
    },
  } as never;
}

// fakeDb에 aggregate 추가 — 전역 정산 잔액 쿼리(vendorId 스코프 강제 검증 포함)
function fakeDbWithAggregate(opts: Parameters<typeof fakeDb>[0]) {
  const base = fakeDb(opts) as Record<string, unknown>;
  const so = base.serviceOrder as Record<string, unknown>;
  so.aggregate = async (args: {
    where?: { vendorId?: string; vendorSettledAt?: null | { not: null } };
  }) => {
    expect(args.where?.vendorId).toBeDefined();
    const vid = args.where!.vendorId!;
    const wantSettled = args.where?.vendorSettledAt !== null;
    const sum = opts.orders
      .filter(
        (o) =>
          o.vendorId === vid &&
          o.vendorStatus === ServiceVendorStatus.VENDOR_ACCEPTED &&
          o.status !== ServiceOrderStatus.CANCELLED &&
          (wantSettled ? o.vendorSettledAt !== null : o.vendorSettledAt === null)
      )
      .reduce((acc, o) => acc + o.costVnd, 0n);
    return { _sum: { costVnd: sum } };
  };
  // 시간 제안 스냅샷 count(ADR-0035) — vendorId 스코프 강제. 여기선 0 기본(제안 없는 케이스).
  so.count = async (args: { where?: { vendorId?: string } }) => {
    expect(args.where?.vendorId).toBeDefined();
    return 0;
  };
  return base as never;
}

describe("loadVendorStats — vendorId 스코프 강제", () => {
  const period = resolveStatsPeriod({ range: "thisMonth" }, NOW);

  it("자기 발주만 집계(타 공급자 99M 제외)", async () => {
    const stats = await loadVendorStats(
      "ven1",
      period,
      "vi",
      fakeDbWithAggregate({
        orders: [
          {
            vendorId: "ven1",
            vendorStatus: ServiceVendorStatus.VENDOR_ACCEPTED,
            status: ServiceOrderStatus.CONFIRMED,
            costVnd: 7_000_000n,
            quantity: 1,
            serviceDate: d("2026-07-10"),
            vendorSettledAt: null,
            createdAt: d("2026-07-01"),
            type: "FRUIT",
            vendorName: "현지 과일",
            catalogItemId: null,
            booking: null,
          },
          {
            // 다른 공급자 — 절대 집계되면 안 됨
            vendorId: "ven2",
            vendorStatus: ServiceVendorStatus.VENDOR_ACCEPTED,
            status: ServiceOrderStatus.DELIVERED,
            costVnd: 99_000_000n,
            quantity: 1,
            serviceDate: d("2026-07-12"),
            vendorSettledAt: null,
            createdAt: d("2026-07-01"),
            type: "BBQ",
            vendorName: "타 공급자",
            catalogItemId: null,
            booking: null,
          },
        ],
      })
    );
    expect(stats.totalVnd).toBe(7_000_000);
    expect(stats.topItems.map((i) => i.itemLabel)).toEqual(["현지 과일"]);
    // 전역 정산 잔액도 본인(ven1) 것만 — 타 공급자 99M 미포함
    expect(stats.unsettledVnd).toBe(7_000_000);
    expect(stats.settledVnd).toBe(0);
  });
});
