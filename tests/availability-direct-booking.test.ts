import { describe, it, expect } from "vitest";
import { getAvailabilityBoard } from "@/lib/availability";

// T-availability-direct-booking-popover — 공실 보드의 DIRECT 빌라 예약맵 + 재무 누수 게이트 검증.
// getAvailabilityBoard(db, …) 는 db 클라이언트만 의존하므로 손수 만든 fake db 로 단위 테스트한다.

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

interface FakeSeed {
  villas: Array<{
    id: string;
    name: string;
    complex: string | null;
    availabilityCheckedAt: Date | null;
    source: "SUPPLIER" | "DIRECT";
  }>;
  blocks?: Array<{ id: string; villaId: string; startDate: Date; endDate: Date; source: "MANUAL" | "ICAL" }>;
  bookings?: Array<Record<string, unknown>>;
}

function makeDb(seed: FakeSeed) {
  const calls: { villaSelect?: unknown; bookingArgs?: { where?: unknown; select?: Record<string, unknown> } } = {};
  const db = {
    villa: {
      findMany: async (args: { select?: unknown }) => {
        calls.villaSelect = args.select;
        return seed.villas;
      },
    },
    calendarBlock: {
      findMany: async () => seed.blocks ?? [],
    },
    booking: {
      findMany: async (args: { where?: unknown; select?: Record<string, unknown> }) => {
        calls.bookingArgs = args;
        // 실제 prisma 처럼 select 에 없는 필드는 결과에서 제거해 "DB 단계 제외"를 재현
        const sel = args.select ?? {};
        return (seed.bookings ?? []).map((b) => {
          const row: Record<string, unknown> = {};
          for (const k of Object.keys(sel)) if (sel[k]) row[k] = b[k];
          return row;
        });
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, calls };
}

const baseBooking = {
  id: "bk1",
  villaId: "v-direct",
  seller: "OPERATOR",
  status: "CONFIRMED",
  channel: "TRAVEL_AGENCY",
  agencyName: "ABC투어",
  checkIn: D(2026, 7, 10),
  checkOut: D(2026, 7, 13),
  nights: 3,
  guestName: "김민수",
  guestCount: 2,
  supplierCostVnd: BigInt(4_500_000),
  depositStatus: "HELD",
  holdExpiresAt: null,
  saleCurrency: "KRW",
  totalSaleKrw: 1_250_000,
  totalSaleVnd: null,
};

const params = { startMonth: "2026-07", monthCount: 1 as const };

function cellAt(board: Awaited<ReturnType<typeof getAvailabilityBoard>>, villaId: string, dayIso: string) {
  const v = board.villas.find((x) => x.id === villaId)!;
  const idx = board.columns.indexOf(dayIso);
  return v.days[idx];
}

describe("getAvailabilityBoard — DIRECT 빌라 예약맵", () => {
  it("DIRECT 빌라의 점유 예약이 BOOKING 셀로 채워지고 요약을 담는다", async () => {
    const { db } = makeDb({
      villas: [{ id: "v-direct", name: "빌라A", complex: null, availabilityCheckedAt: null, source: "DIRECT" }],
      bookings: [baseBooking],
    });
    const board = await getAvailabilityBoard(db, { ...params, canViewFinance: true });

    // 체크인일(포함)~체크아웃 전일까지 BOOKING, 체크아웃일(제외)은 다시 AVAILABLE
    expect(cellAt(board, "v-direct", iso(2026, 7, 10)).status).toBe("BOOKING");
    expect(cellAt(board, "v-direct", iso(2026, 7, 12)).status).toBe("BOOKING");
    expect(cellAt(board, "v-direct", iso(2026, 7, 13)).status).toBe("AVAILABLE");

    const cell = cellAt(board, "v-direct", iso(2026, 7, 10));
    expect(cell.booking).toMatchObject({
      id: "bk1",
      status: "CONFIRMED",
      guestName: "김민수",
      guestCount: 2,
      channel: "TRAVEL_AGENCY",
      supplierCostVnd: "4500000",
      checkIn: iso(2026, 7, 10),
      checkOut: iso(2026, 7, 13),
    });
  });

  it("SUPPLIER 빌라 예약도 BOOKING 셀로 표시된다 (관리자 전체 조망, 2026-07-02)", async () => {
    const { db, calls } = makeDb({
      villas: [{ id: "v-sup", name: "빌라S", complex: null, availabilityCheckedAt: null, source: "SUPPLIER" }],
      bookings: [{ ...baseBooking, villaId: "v-sup", seller: "SUPPLIER" }],
    });
    const board = await getAvailabilityBoard(db, { ...params, canViewFinance: true });

    // 이제 모든 빌라의 예약을 조회한다(관리자 전용 보드 — 원칙1)
    expect(calls.bookingArgs).toBeDefined();
    const cell = cellAt(board, "v-sup", iso(2026, 7, 10));
    expect(cell.status).toBe("BOOKING");
    // 공급자 직접판매 예약으로 표시(seller 구분)
    expect(cell.booking?.seller).toBe("SUPPLIER");
  });

  it("예약은 잠금(MANUAL)보다 우선 표시된다", async () => {
    const { db } = makeDb({
      villas: [{ id: "v-direct", name: "빌라A", complex: null, availabilityCheckedAt: null, source: "DIRECT" }],
      blocks: [{ id: "blk1", villaId: "v-direct", startDate: D(2026, 7, 10), endDate: D(2026, 7, 12), source: "MANUAL" }],
      bookings: [baseBooking],
    });
    const board = await getAvailabilityBoard(db, { ...params, canViewFinance: true });
    // 같은 날 블록+예약이 겹치면 BOOKING 이 최종
    expect(cellAt(board, "v-direct", iso(2026, 7, 10)).status).toBe("BOOKING");
  });

  describe("재무 누수 게이트 (S-RBAC-3)", () => {
    it("canViewFinance=false 면 판매가 필드를 select 에서 제외하고 요약도 null", async () => {
      const { db, calls } = makeDb({
        villas: [{ id: "v-direct", name: "빌라A", complex: null, availabilityCheckedAt: null, source: "DIRECT" }],
        bookings: [baseBooking], // 원본엔 판매가가 있어도
      });
      const board = await getAvailabilityBoard(db, { ...params, canViewFinance: false });

      // 1차 방어: DB select 에 판매가 키가 아예 없음
      const sel = calls.bookingArgs!.select!;
      expect(sel.totalSaleKrw).toBeUndefined();
      expect(sel.totalSaleVnd).toBeUndefined();
      expect(sel.saleCurrency).toBeUndefined();
      // 원가는 STAFF 도 가시
      expect(sel.supplierCostVnd).toBe(true);

      // 2차 방어: 요약 객체의 판매가 필드가 전부 null
      const cell = cellAt(board, "v-direct", iso(2026, 7, 10));
      expect(cell.booking!.totalSaleKrw).toBeNull();
      expect(cell.booking!.totalSaleVnd).toBeNull();
      expect(cell.booking!.saleCurrency).toBeNull();
      // 원가는 그대로 노출
      expect(cell.booking!.supplierCostVnd).toBe("4500000");
    });

    it("canViewFinance=true 면 판매가가 채워진다", async () => {
      const { db } = makeDb({
        villas: [{ id: "v-direct", name: "빌라A", complex: null, availabilityCheckedAt: null, source: "DIRECT" }],
        bookings: [baseBooking],
      });
      const board = await getAvailabilityBoard(db, { ...params, canViewFinance: true });
      const cell = cellAt(board, "v-direct", iso(2026, 7, 10));
      expect(cell.booking!.saleCurrency).toBe("KRW");
      expect(cell.booking!.totalSaleKrw).toBe(1_250_000);
    });

    it("canViewFinance 미지정(기본값)은 비노출로 동작한다", async () => {
      const { db, calls } = makeDb({
        villas: [{ id: "v-direct", name: "빌라A", complex: null, availabilityCheckedAt: null, source: "DIRECT" }],
        bookings: [baseBooking],
      });
      await getAvailabilityBoard(db, params); // canViewFinance 생략
      expect(calls.bookingArgs!.select!.totalSaleKrw).toBeUndefined();
    });
  });
});
