import { describe, expect, it } from "vitest";
import {
  BookingChannel,
  Currency,
  ServiceType,
  type PrismaClient,
} from "@prisma/client";
import {
  buildRoomTxn,
  buildMinibarTxn,
  buildServiceTxn,
  computeMarginVnd,
  sumRevenueTotals,
  loadRevenueTxns,
  type RevenueTxn,
} from "./revenue-ledger";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ───────────────────────────────────────────────────────────
// computeMarginVnd — VND 마진, null 경계
// ───────────────────────────────────────────────────────────
describe("computeMarginVnd — VND 마진 (KRW 채널·원가 미입력은 null, ADR-0003)", () => {
  it("saleVnd·costVnd 둘 다 있으면 차액", () => {
    expect(computeMarginVnd(1_000_000n, 700_000n)).toBe(300_000n);
  });
  it("saleVnd가 null(KRW 채널 객실료)이면 null", () => {
    expect(computeMarginVnd(null, 700_000n)).toBeNull();
  });
  it("costVnd가 null(원가 미입력)이면 null", () => {
    expect(computeMarginVnd(1_000_000n, null)).toBeNull();
  });
  it("음수 마진(원가 > 매출)도 그대로 계산", () => {
    expect(computeMarginVnd(500_000n, 700_000n)).toBe(-200_000n);
  });
});

// ───────────────────────────────────────────────────────────
// buildRoomTxn — saleCurrency 분리(ADR-0003)
// ───────────────────────────────────────────────────────────
describe("buildRoomTxn — 객실료 통화 분리·마진 게이트", () => {
  const base = {
    id: "b1",
    checkOut: D("2026-07-10"),
    villaId: "v1",
    villaName: "쏘나씨 V12",
    channel: BookingChannel.TRAVEL_AGENCY,
    partnerName: null,
    agencyName: null,
    guestName: "김학태",
    supplierCostVnd: 700_000n,
  };

  it("KRW 채널: saleKrw만, saleVnd=null, marginVnd=null(통화 혼합 금지)", () => {
    const t = buildRoomTxn({
      ...base,
      saleCurrency: Currency.KRW,
      totalSaleKrw: 450_000,
      totalSaleVnd: null,
    });
    expect(t.saleKrw).toBe(450_000);
    expect(t.saleVnd).toBeNull();
    expect(t.costVnd).toBe(700_000n); // 원가는 항상 VND
    expect(t.marginVnd).toBeNull(); // KRW 매출 - VND 원가 마진은 무의미 → null
    expect(t.id).toBe("ROOM:b1");
    expect(t.date).toBe("2026-07-10");
    expect(t.type).toBe("ROOM");
  });

  it("VND 채널: saleVnd만, marginVnd = saleVnd - costVnd", () => {
    const t = buildRoomTxn({
      ...base,
      channel: BookingChannel.DIRECT,
      saleCurrency: Currency.VND,
      totalSaleKrw: null,
      totalSaleVnd: 2_000_000n,
    });
    expect(t.saleKrw).toBeNull();
    expect(t.saleVnd).toBe(2_000_000n);
    expect(t.marginVnd).toBe(1_300_000n);
  });

  it("partnerName 우선, 없으면 agencyName 폴백(dual-read)", () => {
    expect(
      buildRoomTxn({ ...base, partnerName: "하나투어", agencyName: "구텍스트", saleCurrency: Currency.KRW, totalSaleKrw: 1, totalSaleVnd: null }).partnerName
    ).toBe("하나투어");
    expect(
      buildRoomTxn({ ...base, partnerName: null, agencyName: "구텍스트", saleCurrency: Currency.KRW, totalSaleKrw: 1, totalSaleVnd: null }).partnerName
    ).toBe("구텍스트");
    expect(
      buildRoomTxn({ ...base, partnerName: null, agencyName: null, saleCurrency: Currency.KRW, totalSaleKrw: 1, totalSaleVnd: null }).partnerName
    ).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// buildMinibarTxn — VND 전용
// ───────────────────────────────────────────────────────────
describe("buildMinibarTxn — VND 전용·원가 null 처리", () => {
  it("원가 있는 라인: marginVnd 계산", () => {
    const t = buildMinibarTxn({
      id: "m1",
      checkOut: D("2026-07-05"),
      villaId: "v1",
      villaName: "V12",
      nameKo: "코카콜라",
      consumedQty: 3,
      lineVnd: 90_000n,
      lineCostVnd: 45_000n,
    });
    expect(t.type).toBe("MINIBAR");
    expect(t.channel).toBeNull();
    expect(t.saleVnd).toBe(90_000n);
    expect(t.marginVnd).toBe(45_000n);
    expect(t.label).toBe("코카콜라 ×3");
  });
  it("원가 미입력(lineCostVnd=null): marginVnd=null, 수량 1이면 ×표기 없음", () => {
    const t = buildMinibarTxn({
      id: "m2",
      checkOut: D("2026-07-05"),
      villaId: "v1",
      villaName: "V12",
      nameKo: "생수",
      consumedQty: 1,
      lineVnd: 20_000n,
      lineCostVnd: null,
    });
    expect(t.marginVnd).toBeNull();
    expect(t.costVnd).toBeNull();
    expect(t.label).toBe("생수");
  });
});

// ───────────────────────────────────────────────────────────
// buildServiceTxn — VND/KRW 인식 + 라인 합계
// ───────────────────────────────────────────────────────────
describe("buildServiceTxn — priceVnd 유무로 통화 인식", () => {
  it("priceVnd 있으면 VND 매출·VND 마진", () => {
    const t = buildServiceTxn({
      id: "s1",
      checkOut: D("2026-07-08"),
      villaId: "v1",
      villaName: "V12",
      serviceType: ServiceType.BBQ,
      serviceLabel: "통돼지 바베큐",
      quantity: 2,
      priceKrw: 100_000,
      priceVnd: 3_000_000n,
      costVnd: 1_800_000n,
    });
    expect(t.type).toBe("SERVICE");
    expect(t.saleVnd).toBe(3_000_000n);
    expect(t.saleKrw).toBeNull();
    expect(t.marginVnd).toBe(1_200_000n);
    expect(t.label).toBe("통돼지 바베큐 ×2");
  });
  it("priceVnd 없으면 KRW 매출·marginVnd=null(통화 혼합 금지)", () => {
    const t = buildServiceTxn({
      id: "s2",
      checkOut: D("2026-07-08"),
      villaId: "v1",
      villaName: "V12",
      serviceType: ServiceType.TICKET,
      serviceLabel: "입장권",
      quantity: 1,
      priceKrw: 50_000,
      priceVnd: null,
      costVnd: 30_000n,
    });
    expect(t.saleKrw).toBe(50_000);
    expect(t.saleVnd).toBeNull();
    expect(t.marginVnd).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// sumRevenueTotals — BigInt 합산·통화 분리
// ───────────────────────────────────────────────────────────
describe("sumRevenueTotals — BigInt 누적·KRW/VND 분리(합산 금지)", () => {
  const mk = (over: Partial<RevenueTxn>): RevenueTxn => ({
    id: "x",
    date: "2026-07-01",
    type: "ROOM",
    villaId: "v1",
    villaName: "V12",
    channel: null,
    partnerName: null,
    label: "L",
    saleKrw: null,
    saleVnd: null,
    costVnd: null,
    marginVnd: null,
    ...over,
  });

  it("KRW·VND 매출을 분리 합산, null은 건너뜀", () => {
    const totals = sumRevenueTotals([
      mk({ saleKrw: 450_000 }),
      mk({ saleKrw: 300_000 }),
      mk({ saleVnd: 2_000_000n, costVnd: 1_500_000n, marginVnd: 500_000n }),
      mk({ saleVnd: 1_000_000n, costVnd: null, marginVnd: null }), // 원가 미입력
    ]);
    expect(totals.count).toBe(4);
    expect(totals.saleKrw).toBe(750_000);
    expect(totals.saleVnd).toBe(3_000_000n);
    expect(totals.costVnd).toBe(1_500_000n);
    expect(totals.marginVnd).toBe(500_000n);
  });

  it("BigInt 안전정수 초과 합산도 정확(부동소수점 오차 없음)", () => {
    const big = 9_000_000_000_000_000n; // > Number.MAX_SAFE_INTEGER
    const totals = sumRevenueTotals([
      mk({ saleVnd: big, costVnd: 0n, marginVnd: big }),
      mk({ saleVnd: big, costVnd: 0n, marginVnd: big }),
    ]);
    expect(totals.saleVnd).toBe(18_000_000_000_000_000n);
    expect(totals.marginVnd).toBe(18_000_000_000_000_000n);
  });

  it("빈 배열: 0/0n", () => {
    const totals = sumRevenueTotals([]);
    expect(totals).toEqual({ count: 0, saleKrw: 0, saleVnd: 0n, costVnd: 0n, marginVnd: 0n });
  });
});

// ───────────────────────────────────────────────────────────
// loadRevenueTxns — 3소스 통합 (mock PrismaClient)
// ───────────────────────────────────────────────────────────
function mockDb(data: {
  bookings?: unknown[];
  minibarLines?: unknown[];
  serviceOrders?: unknown[];
}): { db: PrismaClient; calls: Record<string, number> } {
  const calls = { booking: 0, minibar: 0, service: 0 };
  const db = {
    booking: {
      findMany: async () => {
        calls.booking++;
        return data.bookings ?? [];
      },
    },
    checkoutMinibarLine: {
      findMany: async () => {
        calls.minibar++;
        return data.minibarLines ?? [];
      },
    },
    serviceOrder: {
      findMany: async () => {
        calls.service++;
        return data.serviceOrders ?? [];
      },
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

describe("loadRevenueTxns — 3소스 통합·필터·정렬", () => {
  const bookings = [
    {
      id: "b-krw",
      checkOut: D("2026-07-10"),
      villaId: "v1",
      channel: BookingChannel.TRAVEL_AGENCY,
      agencyName: null,
      guestName: "김학태",
      saleCurrency: Currency.KRW,
      totalSaleKrw: 450_000,
      totalSaleVnd: null,
      supplierCostVnd: 5_000_000n,
      villa: { name: "V12" },
      partner: { name: "하나투어" },
    },
    {
      id: "b-vnd",
      checkOut: D("2026-07-15"),
      villaId: "v2",
      channel: BookingChannel.DIRECT,
      agencyName: null,
      guestName: "Nguyen",
      saleCurrency: Currency.VND,
      totalSaleKrw: null,
      totalSaleVnd: 8_000_000n,
      supplierCostVnd: 5_000_000n,
      villa: { name: "V11" },
      partner: null,
    },
  ];
  const minibarLines = [
    {
      id: "m1",
      nameKo: "콜라",
      consumedQty: 2,
      lineVnd: 60_000n,
      lineCostVnd: 30_000n,
      checkOutRecord: { booking: { checkOut: D("2026-07-11"), villaId: "v1", villa: { name: "V12" } } },
    },
  ];
  const serviceOrders = [
    {
      id: "s1",
      type: ServiceType.BBQ,
      quantity: 2,
      priceKrw: 0,
      priceVnd: 1_500_000n,
      costVnd: 800_000n,
      booking: { checkOut: D("2026-07-12"), villaId: "v1", villa: { name: "V12" } },
    },
  ];

  it("3소스를 모두 합쳐 4행(객실 2·미니바 1·서비스 1)·귀속일 desc 정렬", async () => {
    const { db } = mockDb({ bookings, minibarLines, serviceOrders });
    const { txns, totals } = await loadRevenueTxns(db, { from: D("2026-07-01"), to: D("2026-08-01") });
    expect(txns).toHaveLength(4);
    // 정렬: 07-15(room) > 07-12(service) > 07-11(minibar) > 07-10(room)
    expect(txns.map((t) => t.date)).toEqual(["2026-07-15", "2026-07-12", "2026-07-11", "2026-07-10"]);
    // 합계: KRW=450,000 / VND=8,000,000(room) + 60,000(minibar) + 1,500,000(service 라인합계, ×수량 안 함)
    expect(totals.saleKrw).toBe(450_000);
    expect(totals.saleVnd).toBe(8_000_000n + 60_000n + 1_500_000n);
    // 서비스: priceVnd/costVnd는 DB 라인 합계 그대로(statistics.ts와 동일, 이중계산 금지)
    const svc = txns.find((t) => t.type === "SERVICE")!;
    expect(svc.saleVnd).toBe(1_500_000n);
    expect(svc.costVnd).toBe(800_000n);
    expect(svc.marginVnd).toBe(700_000n);
  });

  it("types=['ROOM']이면 미니바·서비스 쿼리 자체를 건너뜀(불필요 쿼리 회피)", async () => {
    const { db, calls } = mockDb({ bookings, minibarLines, serviceOrders });
    const { txns } = await loadRevenueTxns(db, {
      from: D("2026-07-01"),
      to: D("2026-08-01"),
      types: ["ROOM"],
    });
    expect(txns.every((t) => t.type === "ROOM")).toBe(true);
    expect(calls.booking).toBe(1);
    expect(calls.minibar).toBe(0);
    expect(calls.service).toBe(0);
  });

  it("channel 필터 지정 시 ROOM만(미니바·서비스 제외)", async () => {
    const { db, calls } = mockDb({ bookings, minibarLines, serviceOrders });
    const { txns } = await loadRevenueTxns(db, {
      from: D("2026-07-01"),
      to: D("2026-08-01"),
      channel: BookingChannel.DIRECT,
    });
    expect(calls.minibar).toBe(0);
    expect(calls.service).toBe(0);
    expect(txns.every((t) => t.type === "ROOM")).toBe(true);
  });

  it("partnerId 필터 지정 시 미니바·서비스 제외(파트너 귀속 없음)", async () => {
    const { db, calls } = mockDb({ bookings, minibarLines, serviceOrders });
    await loadRevenueTxns(db, {
      from: D("2026-07-01"),
      to: D("2026-08-01"),
      partnerId: "p1",
    });
    expect(calls.booking).toBe(1);
    expect(calls.minibar).toBe(0);
    expect(calls.service).toBe(0);
  });

  it("currency=VND 필터: KRW 매출 행(객실 b-krw)은 제외", async () => {
    const { db } = mockDb({ bookings, minibarLines, serviceOrders });
    const { txns } = await loadRevenueTxns(db, {
      from: D("2026-07-01"),
      to: D("2026-08-01"),
      currency: Currency.VND,
    });
    expect(txns.find((t) => t.id === "ROOM:b-krw")).toBeUndefined();
    expect(txns.every((t) => t.saleVnd !== null)).toBe(true);
  });

  it("currency=KRW 필터: VND 매출 행 전부 제외, KRW 객실만", async () => {
    const { db } = mockDb({ bookings, minibarLines, serviceOrders });
    const { txns } = await loadRevenueTxns(db, {
      from: D("2026-07-01"),
      to: D("2026-08-01"),
      currency: Currency.KRW,
    });
    expect(txns).toHaveLength(1);
    expect(txns[0].id).toBe("ROOM:b-krw");
  });

  it("serviceLabeler 주입 시 서비스 라벨 번역 적용", async () => {
    const { db } = mockDb({ serviceOrders });
    const { txns } = await loadRevenueTxns(
      db,
      { from: D("2026-07-01"), to: D("2026-08-01"), types: ["SERVICE"] },
      (t) => (t === ServiceType.BBQ ? "BBQ 바베큐" : t)
    );
    expect(txns[0].label).toBe("BBQ 바베큐 ×2");
  });
});
