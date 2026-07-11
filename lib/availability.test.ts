import { describe, expect, it } from "vitest";
import { BookingStatus, VillaStatus } from "@prisma/client";
import {
  OCCUPYING_BOOKING_STATUSES,
  assertValidStayRange,
  evaluateAvailability,
  findFreeVillaIds,
  findSellableVillaIds,
  getAvailabilityBoard,
  overlapsHalfOpen,
} from "./availability";
import type { DbClient } from "./availability";

/** @db.Date 규약과 동일하게 UTC 자정 Date 생성 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("overlapsHalfOpen — [start, end) half-open 겹침", () => {
  it("완전 분리 구간은 겹치지 않는다", () => {
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-10"), d("2026-07-15"))).toBe(false);
    expect(overlapsHalfOpen(d("2026-07-10"), d("2026-07-15"), d("2026-07-01"), d("2026-07-05"))).toBe(false);
  });

  it("체크아웃일 = 다음 체크인일이면 겹치지 않는다 (back-to-back 허용)", () => {
    // 기존 예약 7/1~7/5(체크아웃), 신규 7/5 체크인 — 같은 날 교대 가능해야 함
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-05"), d("2026-07-08"))).toBe(false);
    expect(overlapsHalfOpen(d("2026-07-05"), d("2026-07-08"), d("2026-07-01"), d("2026-07-05"))).toBe(false);
  });

  it("하루라도 숙박일이 겹치면 겹침", () => {
    // 기존 7/1~7/5, 신규 7/4~7/6 — 7/4 밤이 겹침
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-04"), d("2026-07-06"))).toBe(true);
  });

  it("포함 관계·동일 구간은 겹침", () => {
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-10"), d("2026-07-03"), d("2026-07-04"))).toBe(true);
    expect(overlapsHalfOpen(d("2026-07-03"), d("2026-07-04"), d("2026-07-01"), d("2026-07-10"))).toBe(true);
    expect(overlapsHalfOpen(d("2026-07-01"), d("2026-07-05"), d("2026-07-01"), d("2026-07-05"))).toBe(true);
  });

  it("시즌 경계(연말연시)를 걸친 구간도 정상 판정", () => {
    expect(overlapsHalfOpen(d("2026-12-30"), d("2027-01-02"), d("2027-01-01"), d("2027-01-03"))).toBe(true);
    expect(overlapsHalfOpen(d("2026-12-30"), d("2027-01-01"), d("2027-01-01"), d("2027-01-03"))).toBe(false);
  });
});

describe("assertValidStayRange", () => {
  it("checkIn < checkOut 이면 통과", () => {
    expect(() => assertValidStayRange({ checkIn: d("2026-07-01"), checkOut: d("2026-07-02") })).not.toThrow();
  });

  it("0박(동일 날짜)은 거부", () => {
    expect(() => assertValidStayRange({ checkIn: d("2026-07-01"), checkOut: d("2026-07-01") })).toThrow(RangeError);
  });

  it("역전 구간은 거부", () => {
    expect(() => assertValidStayRange({ checkIn: d("2026-07-05"), checkOut: d("2026-07-01") })).toThrow(RangeError);
  });
});

describe("evaluateAvailability — SPEC F2 판정식", () => {
  const base = {
    villaStatus: VillaStatus.ACTIVE,
    isSellable: true,
    overlappingBookingCount: 0,
    overlappingBlockCount: 0,
  };

  it("ACTIVE + 겹침 없음 + 검수 통과 → available·sellable", () => {
    expect(evaluateAvailability(base)).toEqual({ available: true, sellable: true, reasons: [] });
  });

  it("예약 겹침 → 불가 (BOOKING_OVERLAP)", () => {
    const r = evaluateAvailability({ ...base, overlappingBookingCount: 1 });
    expect(r.available).toBe(false);
    expect(r.sellable).toBe(false);
    expect(r.reasons).toContain("BOOKING_OVERLAP");
  });

  it("차단 겹침 → 불가 (BLOCK_OVERLAP)", () => {
    const r = evaluateAvailability({ ...base, overlappingBlockCount: 2 });
    expect(r.available).toBe(false);
    expect(r.reasons).toContain("BLOCK_OVERLAP");
  });

  it.each([VillaStatus.DRAFT, VillaStatus.PENDING_REVIEW, VillaStatus.INACTIVE])(
    "villa.status=%s → 불가 (VILLA_NOT_ACTIVE)",
    (status) => {
      const r = evaluateAvailability({ ...base, villaStatus: status });
      expect(r.available).toBe(false);
      expect(r.sellable).toBe(false);
      expect(r.reasons).toContain("VILLA_NOT_ACTIVE");
    }
  );

  it("검수 게이트: available이어도 isSellable=false면 sellable=false", () => {
    const r = evaluateAvailability({ ...base, isSellable: false });
    expect(r.available).toBe(true); // 재고 자체는 비어 있음 (ADMIN 조망용)
    expect(r.sellable).toBe(false); // 판매는 검수 승인 전 금지
    expect(r.reasons).toEqual(["NOT_SELLABLE"]);
  });

  it("복합 사유는 모두 수집된다", () => {
    const r = evaluateAvailability({
      villaStatus: VillaStatus.INACTIVE,
      isSellable: false,
      overlappingBookingCount: 1,
      overlappingBlockCount: 1,
    });
    expect(r.reasons).toEqual(
      expect.arrayContaining(["VILLA_NOT_ACTIVE", "BOOKING_OVERLAP", "BLOCK_OVERLAP", "NOT_SELLABLE"])
    );
    expect(r.available).toBe(false);
    expect(r.sellable).toBe(false);
  });

  // ── 정원 검증 (ADR-0030 T-A) ──
  it("maxGuests·guestCount 미지정 시 정원 판정 생략 (하위호환)", () => {
    expect(evaluateAvailability(base)).toEqual({ available: true, sellable: true, reasons: [] });
  });

  it("인원 ≤ 정원 → OVER_CAPACITY 없음", () => {
    const r = evaluateAvailability({ ...base, maxGuests: 6, guestCount: 6 });
    expect(r.sellable).toBe(true);
    expect(r.reasons).not.toContain("OVER_CAPACITY");
  });

  it("인원 > 정원 → OVER_CAPACITY, sellable=false (재고 available은 유지)", () => {
    const r = evaluateAvailability({ ...base, maxGuests: 4, guestCount: 5 });
    expect(r.available).toBe(true); // 재고 자체는 비어 있음 (ADMIN 조망용)
    expect(r.sellable).toBe(false); // 정원 초과라 판매 불가
    expect(r.reasons).toContain("OVER_CAPACITY");
  });

  it("guestCount만 있고 maxGuests 없으면 판정 생략", () => {
    const r = evaluateAvailability({ ...base, guestCount: 99 });
    expect(r.reasons).not.toContain("OVER_CAPACITY");
    expect(r.sellable).toBe(true);
  });
});

describe("findSellableVillaIds — excludeBookingId (ADR-0030 예약변경 셀렉터)", () => {
  const range = { checkIn: d("2026-08-01"), checkOut: d("2026-08-03") };
  // v1은 예약 B1이 점유, v2는 공실. B1 제외 시 v1도 후보가 되어야 한다.
  const stubDb = (): DbClient =>
    ({
      villa: { findMany: async () => [{ id: "v1" }, { id: "v2" }] },
      booking: {
        findMany: async ({ where }: { where: { id?: { not?: string } } }) =>
          where.id?.not === "B1" ? [] : [{ villaId: "v1" }], // B1 제외하면 v1 점유 사라짐
      },
      calendarBlock: { findMany: async () => [] },
    }) as unknown as DbClient;

  it("excludeBookingId 없으면 점유 빌라(v1) 제외 → [v2]", async () => {
    const ids = await findSellableVillaIds(stubDb(), range);
    expect(ids).toEqual(["v2"]);
  });

  it("excludeBookingId=B1이면 자기 점유 제외 → 현재 빌라(v1)도 후보 [v1, v2]", async () => {
    const ids = await findSellableVillaIds(stubDb(), range, undefined, undefined, "B1");
    expect(ids.sort()).toEqual(["v1", "v2"]);
  });
});

describe("getAvailabilityBoard — minDate 과거 컬럼 클램프", () => {
  // getAvailabilityBoard 는 db.villa.findMany / db.calendarBlock.findMany 만 호출.
  // 그 둘만 구현한 최소 스텁으로 컬럼/days 생성 로직(순수)을 검증한다 (실 DB 불필요).
  const stubDb = (villas: { id: string; name: string }[]): DbClient =>
    ({
      villa: {
        findMany: async () =>
          villas.map((v) => ({
            ...v,
            complex: null,
            availabilityCheckedAt: null,
          })),
      },
      calendarBlock: {
        findMany: async () => [],
      },
      booking: { findMany: async () => [] }, // 보드는 이제 모든 빌라의 예약을 조회(overlay)
    }) as unknown as DbClient;

  it("minDate 미지정 시 기간 시작(월 1일)부터 컬럼 생성 (하위호환)", async () => {
    const board = await getAvailabilityBoard(stubDb([{ id: "v1", name: "A" }]), {
      startMonth: "2026-07",
      monthCount: 1,
    });
    expect(board.startDate).toBe("2026-07-01");
    expect(board.columns[0]).toBe("2026-07-01");
    expect(board.columns).toHaveLength(31); // 7월 31일
    expect(board.villas[0].days).toHaveLength(31); // days 인덱스 1:1
  });

  it("minDate 가 기간 시작 이후면 그 날짜로 컬럼 시작 클램프 + days 길이 일치", async () => {
    const board = await getAvailabilityBoard(stubDb([{ id: "v1", name: "A" }]), {
      startMonth: "2026-07",
      monthCount: 1,
      minDate: "2026-07-10",
    });
    expect(board.startDate).toBe("2026-07-10");
    expect(board.columns[0]).toBe("2026-07-10");
    expect(board.columns).toHaveLength(22); // 7/10 ~ 7/31 = 22일
    expect(board.villas[0].days).toHaveLength(22); // columns 와 동일
    expect(board.columns).not.toContain("2026-07-09"); // 과거 컬럼 미생성
  });

  it("minDate 가 기간 시작 이전이면 클램프 없음 (기간 시작 유지)", async () => {
    const board = await getAvailabilityBoard(stubDb([{ id: "v1", name: "A" }]), {
      startMonth: "2026-07",
      monthCount: 1,
      minDate: "2026-06-01",
    });
    expect(board.startDate).toBe("2026-07-01");
    expect(board.columns).toHaveLength(31);
  });
});

describe("getAvailabilityBoard — 모든 빌라 예약 표시 + seller 구분 (2026-07-02)", () => {
  const boardDb = (bookings: Record<string, unknown>[]): DbClient =>
    ({
      villa: {
        findMany: async () => [
          { id: "v1", name: "A", complex: null, availabilityCheckedAt: null, qualityScore: 0 },
        ],
      },
      calendarBlock: { findMany: async () => [] },
      booking: { findMany: async () => bookings },
    }) as unknown as DbClient;

  const bk = (over: Record<string, unknown>) => ({
    id: "b1",
    villaId: "v1",
    seller: "OPERATOR",
    status: "CONFIRMED",
    channel: "DIRECT",
    agencyName: null,
    checkIn: d("2026-07-02"),
    checkOut: d("2026-07-04"),
    nights: 2,
    guestName: "G",
    guestCount: 2,
    supplierCostVnd: 0n,
    depositStatus: "NONE",
    holdExpiresAt: null,
    ...over,
  });

  it("SUPPLIER 직접판매 예약도 BOOKING 셀로 표시하고 seller=SUPPLIER", async () => {
    const board = await getAvailabilityBoard(boardDb([bk({ seller: "SUPPLIER" })]), {
      startMonth: "2026-07",
      monthCount: 1,
    });
    const day = board.villas[0].days[1]; // 2026-07-02
    expect(day.status).toBe("BOOKING");
    expect(day.booking?.seller).toBe("SUPPLIER");
  });

  it("OPERATOR 우리 예약도 BOOKING 셀로 표시하고 seller=OPERATOR", async () => {
    const board = await getAvailabilityBoard(boardDb([bk({ seller: "OPERATOR" })]), {
      startMonth: "2026-07",
      monthCount: 1,
    });
    expect(board.villas[0].days[1].booking?.seller).toBe("OPERATOR");
  });
});

describe("getAvailabilityBoard — 판매 후순위 정렬 (품질점수 desc, Phase 2)", () => {
  // findMany 에 넘긴 orderBy 를 포착하고, DB 반환 순서를 board.villas 가 보존하는지 본다.
  const captureDb = (villas: { id: string; name: string; qualityScore: number }[]) => {
    let orderBy: unknown = null;
    const db = {
      villa: {
        findMany: async (args: { orderBy?: unknown }) => {
          orderBy = args.orderBy ?? null;
          return villas.map((v) => ({
            ...v,
            complex: null,
            availabilityCheckedAt: null,
            source: null,
          }));
        },
      },
      calendarBlock: { findMany: async () => [] },
      booking: { findMany: async () => [] },
    } as unknown as DbClient;
    return { db, orderBy: () => orderBy };
  };

  it("findMany 를 [{qualityScore:desc},{name:asc}] 로 정렬 요청한다", async () => {
    const { db, orderBy } = captureDb([{ id: "v1", name: "A", qualityScore: 100 }]);
    await getAvailabilityBoard(db, { startMonth: "2026-07", monthCount: 1 });
    expect(orderBy()).toEqual([{ qualityScore: "desc" }, { name: "asc" }]);
  });

  it("DB 가 점수 desc 로 준 순서를 board.villas 가 그대로 보존한다", async () => {
    // DB(정렬 위임) 반환 순서: 높은 점수 먼저
    const { db } = captureDb([
      { id: "high", name: "B", qualityScore: 100 },
      { id: "mid", name: "A", qualityScore: 67 },
      { id: "low", name: "C", qualityScore: 0 },
    ]);
    const board = await getAvailabilityBoard(db, { startMonth: "2026-07", monthCount: 1 });
    expect(board.villas.map((v) => v.id)).toEqual(["high", "mid", "low"]);
    expect(board.villas.map((v) => v.qualityScore)).toEqual([100, 67, 0]);
  });
});

describe("findFreeVillaIds — 날짜별 공실 (ADMIN 전용, T-villa-search-expansion §A)", () => {
  // where 조건을 실제로 적용하는 픽스처 스텁 — 겹침 경계를 정확히 검증하기 위함.
  type VillaFx = {
    id: string;
    status?: VillaStatus;
    isSellable?: boolean;
    maxGuests?: number;
    bedrooms?: number;
    hasPool?: boolean;
    breakfastAvailable?: boolean;
    smokingAllowed?: boolean;
    petsAllowed?: boolean;
    partyAllowed?: boolean;
    extraBedAvailable?: boolean;
  };
  type BookingFx = { villaId: string; status: BookingStatus; checkIn: Date; checkOut: Date };
  type BlockFx = { villaId: string; startDate: Date; endDate: Date };

  // boolean 스칼라 필터(수영장·조식·이용규칙 4종) — 전부 `{ field: true }` 동일 패턴
  const BOOL_KEYS = [
    "hasPool",
    "breakfastAvailable",
    "isSellable",
    "smokingAllowed",
    "petsAllowed",
    "partyAllowed",
    "extraBedAvailable",
  ] as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchVillaWhere = (v: VillaFx, where: any): boolean => {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (k === "status" && v.status !== cond) return false;
      if ((BOOL_KEYS as readonly string[]).includes(k) && (v as Record<string, unknown>)[k] !== cond)
        return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (k === "maxGuests" && !((v.maxGuests ?? 0) >= (cond as any).gte)) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (k === "bedrooms" && !((v.bedrooms ?? 0) >= (cond as any).gte)) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (k === "id" && !(cond as any).in?.includes(v.id)) return false;
    }
    return true;
  };

  const freeStubDb = (opts: {
    villas: VillaFx[];
    bookings?: BookingFx[];
    blocks?: BlockFx[];
  }): DbClient =>
    ({
      villa: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: async ({ where }: any) =>
          opts.villas.filter((v) => matchVillaWhere(v, where)).map((v) => ({ id: v.id })),
      },
      booking: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: async ({ where }: any) => {
          const ids: string[] = where.villaId?.in ?? [];
          return (opts.bookings ?? [])
            .filter(
              (b) =>
                ids.includes(b.villaId) &&
                where.status.in.includes(b.status) &&
                b.checkIn.getTime() < where.checkIn.lt.getTime() && // checkIn < range.checkOut
                b.checkOut.getTime() > where.checkOut.gt.getTime() // checkOut > range.checkIn
            )
            .map((b) => ({ villaId: b.villaId }));
        },
      },
      calendarBlock: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: async ({ where }: any) => {
          const ids: string[] = where.villaId?.in ?? [];
          return (opts.blocks ?? [])
            .filter(
              (bl) =>
                ids.includes(bl.villaId) &&
                bl.startDate.getTime() < where.startDate.lt.getTime() &&
                bl.endDate.getTime() > where.endDate.gt.getTime()
            )
            .map((bl) => ({ villaId: bl.villaId }));
        },
      },
    }) as unknown as DbClient;

  const search = { checkIn: d("2026-07-03"), checkOut: d("2026-07-05") };

  it("예약[7/1,7/3) + 검색[7/3,7/5) → back-to-back, 공실로 표시", async () => {
    const db = freeStubDb({
      villas: [{ id: "v1" }],
      bookings: [
        { villaId: "v1", status: BookingStatus.CONFIRMED, checkIn: d("2026-07-01"), checkOut: d("2026-07-03") },
      ],
    });
    expect(await findFreeVillaIds(db, search)).toEqual(["v1"]);
  });

  it("예약[7/2,7/4) + 검색[7/3,7/5) → 겹침, 제외", async () => {
    const db = freeStubDb({
      villas: [{ id: "v1" }],
      bookings: [
        { villaId: "v1", status: BookingStatus.CONFIRMED, checkIn: d("2026-07-02"), checkOut: d("2026-07-04") },
      ],
    });
    expect(await findFreeVillaIds(db, search)).toEqual([]);
  });

  it("차단[7/2,7/4) 도 예약과 동일하게 점유로 제외", async () => {
    const db = freeStubDb({
      villas: [{ id: "v1" }],
      blocks: [{ villaId: "v1", startDate: d("2026-07-02"), endDate: d("2026-07-04") }],
    });
    expect(await findFreeVillaIds(db, search)).toEqual([]);
  });

  it("차단[7/1,7/3) back-to-back → 공실", async () => {
    const db = freeStubDb({
      villas: [{ id: "v1" }],
      blocks: [{ villaId: "v1", startDate: d("2026-07-01"), endDate: d("2026-07-03") }],
    });
    expect(await findFreeVillaIds(db, search)).toEqual(["v1"]);
  });

  it("살아있는 HOLD 는 점유(제외), 만료·취소·퇴실 상태는 무시(공실)", async () => {
    const holdDb = freeStubDb({
      villas: [{ id: "v1" }],
      bookings: [
        { villaId: "v1", status: BookingStatus.HOLD, checkIn: d("2026-07-03"), checkOut: d("2026-07-05") },
      ],
    });
    expect(await findFreeVillaIds(holdDb, search)).toEqual([]); // HOLD=점유 (만료 미수거도 status=HOLD면 점유)

    for (const st of [
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
      BookingStatus.CHECKED_OUT,
      BookingStatus.NO_SHOW,
    ]) {
      const db = freeStubDb({
        villas: [{ id: "v1" }],
        bookings: [{ villaId: "v1", status: st, checkIn: d("2026-07-03"), checkOut: d("2026-07-05") }],
      });
      expect(await findFreeVillaIds(db, search)).toEqual(["v1"]);
    }
  });

  it("기본은 상태 무관(검수대기·비ACTIVE 포함)으로 조망", async () => {
    const db = freeStubDb({
      villas: [
        { id: "active-sellable", status: VillaStatus.ACTIVE, isSellable: true, maxGuests: 8 },
        { id: "not-sellable", status: VillaStatus.ACTIVE, isSellable: false, maxGuests: 8 },
        { id: "pending", status: VillaStatus.PENDING_REVIEW, isSellable: false, maxGuests: 8 },
      ],
    });
    expect((await findFreeVillaIds(db, search)).sort()).toEqual(
      ["active-sellable", "not-sellable", "pending"].sort()
    );
  });

  it("requireSellable=true + guestCount 로 ACTIVE+isSellable+정원 후보로 좁힌다", async () => {
    const db = freeStubDb({
      villas: [
        { id: "active-sellable", status: VillaStatus.ACTIVE, isSellable: true, maxGuests: 8 },
        { id: "not-sellable", status: VillaStatus.ACTIVE, isSellable: false, maxGuests: 8 },
        { id: "pending", status: VillaStatus.PENDING_REVIEW, isSellable: false, maxGuests: 8 },
        { id: "too-small", status: VillaStatus.ACTIVE, isSellable: true, maxGuests: 2 },
      ],
    });
    expect(await findFreeVillaIds(db, search, { requireSellable: true, guestCount: 6 })).toEqual([
      "active-sellable",
    ]);
  });

  it("villaWhere 로 후보를 선반영해 freeIds 를 축소한다", async () => {
    const db = freeStubDb({
      villas: [
        { id: "v-pool", hasPool: true },
        { id: "v-nopool", hasPool: false },
      ],
    });
    expect(await findFreeVillaIds(db, search, { villaWhere: { hasPool: true } })).toEqual(["v-pool"]);
  });

  it("이용규칙 boolean 필터(흡연·반려동물·파티·엑스트라베드) villaWhere 선반영 — 각각 true 만 통과", async () => {
    const db = freeStubDb({
      villas: [
        { id: "all", smokingAllowed: true, petsAllowed: true, partyAllowed: true, extraBedAvailable: true },
        { id: "smoke", smokingAllowed: true, petsAllowed: false, partyAllowed: false, extraBedAvailable: false },
        { id: "none", smokingAllowed: false, petsAllowed: false, partyAllowed: false, extraBedAvailable: false },
      ],
    });
    // 단독 필터
    expect((await findFreeVillaIds(db, search, { villaWhere: { smokingAllowed: true } })).sort()).toEqual(
      ["all", "smoke"].sort()
    );
    expect(await findFreeVillaIds(db, search, { villaWhere: { petsAllowed: true } })).toEqual(["all"]);
    expect(await findFreeVillaIds(db, search, { villaWhere: { partyAllowed: true } })).toEqual(["all"]);
    expect(await findFreeVillaIds(db, search, { villaWhere: { extraBedAvailable: true } })).toEqual(["all"]);
    // 조합(AND) — 4종 모두 참인 빌라만
    expect(
      await findFreeVillaIds(db, search, {
        villaWhere: {
          smokingAllowed: true,
          petsAllowed: true,
          partyAllowed: true,
          extraBedAvailable: true,
        },
      })
    ).toEqual(["all"]);
  });

  it("역전·0박 구간은 RangeError 로 거부(호출부는 이 케이스를 미적용 처리해 500 방지)", async () => {
    const db = freeStubDb({ villas: [{ id: "v1" }] });
    await expect(
      findFreeVillaIds(db, { checkIn: d("2026-07-05"), checkOut: d("2026-07-03") })
    ).rejects.toThrow(RangeError);
    await expect(
      findFreeVillaIds(db, { checkIn: d("2026-07-05"), checkOut: d("2026-07-05") })
    ).rejects.toThrow(RangeError);
  });
});

describe("findSellableVillaIds — 리팩터 후 시그니처·동작 무변경 회귀", () => {
  const range = { checkIn: d("2026-08-01"), checkOut: d("2026-08-03") };
  it("ACTIVE+isSellable 후보 중 점유 빌라를 제외한다 (내부 헬퍼 공유 후에도 동일)", async () => {
    const db = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      villa: { findMany: async ({ where }: any) => {
        // findSellableVillaIds 는 status=ACTIVE·isSellable=true 를 후보 where 로 넣는다
        expect(where.status).toBe(VillaStatus.ACTIVE);
        expect(where.isSellable).toBe(true);
        return [{ id: "v1" }, { id: "v2" }];
      } },
      booking: { findMany: async () => [{ villaId: "v1" }] },
      calendarBlock: { findMany: async () => [] },
    } as unknown as DbClient;
    expect(await findSellableVillaIds(db, range)).toEqual(["v2"]);
  });
});

describe("OCCUPYING_BOOKING_STATUSES — 점유 상태 정의", () => {
  it("HOLD·CONFIRMED·CHECKED_IN만 점유", () => {
    expect([...OCCUPYING_BOOKING_STATUSES].sort()).toEqual(
      [BookingStatus.HOLD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN].sort()
    );
  });

  it("EXPIRED·CANCELLED·CHECKED_OUT·NO_SHOW는 점유가 아니다 (재고 복귀)", () => {
    const occupying = OCCUPYING_BOOKING_STATUSES as readonly BookingStatus[];
    for (const s of [
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
      BookingStatus.CHECKED_OUT,
      BookingStatus.NO_SHOW,
    ]) {
      expect(occupying).not.toContain(s);
    }
  });
});
