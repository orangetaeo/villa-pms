import { describe, expect, it } from "vitest";
import { BookingStatus, VillaStatus } from "@prisma/client";
import {
  OCCUPYING_BOOKING_STATUSES,
  assertValidStayRange,
  evaluateAvailability,
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
