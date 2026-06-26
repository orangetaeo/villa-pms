import { describe, expect, it } from "vitest";
import { BookingSeller, BookingStatus } from "@prisma/client";
import {
  buildDayAxis,
  computeVillaRow,
  formatDayLabel,
  todayInVillaTimezone,
  TIMELINE_DAYS,
  type TimelineCellState,
  type TimelineVillaInput,
} from "@/lib/timeline";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const SELLABLE: TimelineVillaInput = { id: "v1", name: "쏘나씨 V12", isSellable: true };
const NOT_SELLABLE_VILLA: TimelineVillaInput = {
  id: "v2",
  name: "쏘나씨 V11",
  isSellable: false,
};

const AXIS_10 = buildDayAxis(d("2026-07-01"), 10); // 7/1 ~ 7/10

function cellsOf(
  villa: TimelineVillaInput,
  bookings: Parameters<typeof computeVillaRow>[1],
  blocks: Parameters<typeof computeVillaRow>[2],
  axis = AXIS_10
): TimelineCellState[] {
  return computeVillaRow(villa, bookings, blocks, axis);
}

describe("buildDayAxis / formatDayLabel", () => {
  it("from부터 30일 UTC 자정 축을 만든다 (기본값)", () => {
    const axis = buildDayAxis(d("2026-07-17"));
    expect(axis).toHaveLength(TIMELINE_DAYS);
    expect(axis[0]).toEqual(d("2026-07-17"));
    expect(axis[29]).toEqual(d("2026-08-15"));
    // 전부 UTC 자정
    expect(axis.every((day) => day.getUTCHours() === 0 && day.getUTCMinutes() === 0)).toBe(true);
  });

  it("월 경계를 넘어 이어진다 (b1 모크 7/17~8/15)", () => {
    const labels = buildDayAxis(d("2026-07-17")).map(formatDayLabel);
    expect(labels[0]).toBe("7/17");
    expect(labels[14]).toBe("7/31");
    expect(labels[15]).toBe("8/1");
    expect(labels[29]).toBe("8/15");
  });

  it("M/D 라벨은 getUTC* 기반 — 서버 로컬 TZ 비의존 (QA 조건 1)", () => {
    // UTC 자정 Date의 라벨은 로컬 TZ가 무엇이든 UTC 날짜를 표기해야 한다
    expect(formatDayLabel(d("2026-12-31"))).toBe("12/31");
    expect(formatDayLabel(d("2027-01-01"))).toBe("1/1");
  });
});

describe("todayInVillaTimezone — Asia/Ho_Chi_Minh 기준 오늘 (QA 조건 1)", () => {
  it("UTC 18:00 = VN 다음날 01:00 → VN 날짜의 UTC 자정", () => {
    const now = new Date("2026-06-30T18:00:00.000Z");
    expect(todayInVillaTimezone(now)).toEqual(d("2026-07-01"));
  });

  it("UTC 10:00 = VN 17:00 같은 날 → 같은 날짜", () => {
    const now = new Date("2026-06-30T10:00:00.000Z");
    expect(todayInVillaTimezone(now)).toEqual(d("2026-06-30"));
  });
});

describe("computeVillaRow — half-open·클리핑", () => {
  it("7/2~7/5 확정 예약: 7/2~7/4 점유, 체크아웃일 7/5는 공실 (half-open)", () => {
    const cells = cellsOf(
      SELLABLE,
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-07-02"), checkOut: d("2026-07-05") }],
      []
    );
    expect(cells[0]).toBe("EMPTY"); // 7/1
    expect(cells[1]).toBe("CONFIRMED"); // 7/2
    expect(cells[3]).toBe("CONFIRMED"); // 7/4
    expect(cells[4]).toBe("EMPTY"); // 7/5 체크아웃일
  });

  it("back-to-back: 7/5 체크아웃 + 7/5 체크인 → 7/5는 다음 예약 점유", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        { status: BookingStatus.CONFIRMED, checkIn: d("2026-07-02"), checkOut: d("2026-07-05") },
        { status: BookingStatus.HOLD, checkIn: d("2026-07-05"), checkOut: d("2026-07-07") },
      ],
      []
    );
    expect(cells[3]).toBe("CONFIRMED"); // 7/4
    expect(cells[4]).toBe("HOLD"); // 7/5
    expect(cells[6]).toBe("EMPTY"); // 7/7
  });

  it("축 시작 전 시작~축 안으로 걸친 예약과 축 끝을 넘는 차단이 클리핑된다 (QA 권고 1)", () => {
    const cells = cellsOf(
      SELLABLE,
      [{ status: BookingStatus.CHECKED_IN, checkIn: d("2026-06-28"), checkOut: d("2026-07-03") }],
      [{ startDate: d("2026-07-09"), endDate: d("2026-08-20") }]
    );
    expect(cells[0]).toBe("CHECKED_IN"); // 7/1 (6/28 시작 예약)
    expect(cells[1]).toBe("CHECKED_IN"); // 7/2
    expect(cells[2]).toBe("EMPTY"); // 7/3 체크아웃일
    expect(cells[8]).toBe("BLOCKED"); // 7/9
    expect(cells[9]).toBe("BLOCKED"); // 7/10 (축 마지막 — 8/20까지 차단)
  });
});

describe("computeVillaRow — 우선순위", () => {
  it("같은 날 HOLD + 차단 겹침 → HOLD 표기 (CHECKED_IN > CONFIRMED > HOLD > BLOCKED)", () => {
    const cells = cellsOf(
      SELLABLE,
      [{ status: BookingStatus.HOLD, checkIn: d("2026-07-03"), checkOut: d("2026-07-05") }],
      [{ startDate: d("2026-07-02"), endDate: d("2026-07-06") }]
    );
    expect(cells[1]).toBe("BLOCKED"); // 7/2 차단만
    expect(cells[2]).toBe("HOLD"); // 7/3 겹침 → HOLD 우선
    expect(cells[4]).toBe("BLOCKED"); // 7/5 체크아웃일 — 차단만 남음
  });

  it("같은 날 CONFIRMED + HOLD 겹침(더블부킹) → CONFIRMED 우선", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        { status: BookingStatus.HOLD, checkIn: d("2026-07-03"), checkOut: d("2026-07-06") },
        { status: BookingStatus.CONFIRMED, checkIn: d("2026-07-04"), checkOut: d("2026-07-05") },
      ],
      []
    );
    expect(cells[2]).toBe("HOLD"); // 7/3
    expect(cells[3]).toBe("CONFIRMED"); // 7/4 겹침
    expect(cells[5]).toBe("EMPTY"); // 7/6
  });

  it("CHECKED_IN이 최우선", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        { status: BookingStatus.CONFIRMED, checkIn: d("2026-07-02"), checkOut: d("2026-07-04") },
        { status: BookingStatus.CHECKED_IN, checkIn: d("2026-07-03"), checkOut: d("2026-07-04") },
      ],
      []
    );
    expect(cells[1]).toBe("CONFIRMED");
    expect(cells[2]).toBe("CHECKED_IN");
  });
});

describe("computeVillaRow — 판매불가·비점유 제외", () => {
  it("isSellable=false 빌라: 공실 셀은 NOT_SELLABLE, 점유 셀은 점유 상태 우선", () => {
    const cells = cellsOf(
      NOT_SELLABLE_VILLA,
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-07-02"), checkOut: d("2026-07-04") }],
      [{ startDate: d("2026-07-06"), endDate: d("2026-07-08") }]
    );
    expect(cells[0]).toBe("NOT_SELLABLE"); // 7/1 공실
    expect(cells[1]).toBe("CONFIRMED"); // 점유 우선
    expect(cells[3]).toBe("NOT_SELLABLE"); // 체크아웃일 공실
    expect(cells[5]).toBe("BLOCKED"); // 차단 우선
  });

  it("비점유 예약 상태(CANCELLED·EXPIRED·CHECKED_OUT·NO_SHOW)는 무시 — 재고 복귀", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        { status: BookingStatus.CANCELLED, checkIn: d("2026-07-02"), checkOut: d("2026-07-04") },
        { status: BookingStatus.EXPIRED, checkIn: d("2026-07-04"), checkOut: d("2026-07-06") },
        { status: BookingStatus.CHECKED_OUT, checkIn: d("2026-07-06"), checkOut: d("2026-07-08") },
        { status: BookingStatus.NO_SHOW, checkIn: d("2026-07-08"), checkOut: d("2026-07-10") },
      ],
      []
    );
    expect(cells.every((c) => c === "EMPTY")).toBe(true);
  });

  it("셀 값은 상태 문자열만 — 고객명·금액·예약 id가 행 구조에 존재하지 않음 (타입 계약)", () => {
    const cells = cellsOf(SELLABLE, [], []);
    expect(cells).toHaveLength(10);
    expect(new Set(cells)).toEqual(new Set(["EMPTY"]));
  });
});

describe("computeVillaRow — F10 공급자 직접예약(SUPPLIER_DIRECT) 분류", () => {
  it("seller=SUPPLIER 확정 예약: 점유 셀이 SUPPLIER_DIRECT(색만 구분), 체크아웃일은 공실", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        {
          status: BookingStatus.CONFIRMED,
          seller: BookingSeller.SUPPLIER,
          checkIn: d("2026-07-02"),
          checkOut: d("2026-07-05"),
        },
      ],
      []
    );
    expect(cells[0]).toBe("EMPTY"); // 7/1
    expect(cells[1]).toBe("SUPPLIER_DIRECT"); // 7/2
    expect(cells[3]).toBe("SUPPLIER_DIRECT"); // 7/4
    expect(cells[4]).toBe("EMPTY"); // 7/5 체크아웃일 (half-open)
  });

  it("seller=OPERATOR(또는 미지정) 확정 예약은 기존대로 CONFIRMED", () => {
    const operator = cellsOf(
      SELLABLE,
      [
        {
          status: BookingStatus.CONFIRMED,
          seller: BookingSeller.OPERATOR,
          checkIn: d("2026-07-02"),
          checkOut: d("2026-07-04"),
        },
      ],
      []
    );
    const unset = cellsOf(
      SELLABLE,
      [{ status: BookingStatus.CONFIRMED, checkIn: d("2026-07-02"), checkOut: d("2026-07-04") }],
      []
    );
    expect(operator[1]).toBe("CONFIRMED");
    expect(unset[1]).toBe("CONFIRMED"); // seller 미지정 = OPERATOR 취급
  });

  it("공급자 직접예약이 CHECKED_IN이면 투숙 중 우선(SUPPLIER_DIRECT 아님 — 운영 동작 보존)", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        {
          status: BookingStatus.CHECKED_IN,
          seller: BookingSeller.SUPPLIER,
          checkIn: d("2026-07-02"),
          checkOut: d("2026-07-04"),
        },
      ],
      []
    );
    expect(cells[1]).toBe("CHECKED_IN");
    expect(cells[2]).toBe("CHECKED_IN");
  });

  it("SUPPLIER_DIRECT는 HOLD·BLOCKED보다 점유 우선(확정 동급 rank)", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        {
          status: BookingStatus.CONFIRMED,
          seller: BookingSeller.SUPPLIER,
          checkIn: d("2026-07-03"),
          checkOut: d("2026-07-05"),
        },
        { status: BookingStatus.HOLD, checkIn: d("2026-07-03"), checkOut: d("2026-07-05") },
      ],
      [{ startDate: d("2026-07-03"), endDate: d("2026-07-04") }]
    );
    expect(cells[2]).toBe("SUPPLIER_DIRECT"); // 7/3 — HOLD·BLOCKED 위
  });

  it("seller=SUPPLIER라도 비점유 상태(CANCELLED)는 무시 — 재고 복귀", () => {
    const cells = cellsOf(
      SELLABLE,
      [
        {
          status: BookingStatus.CANCELLED,
          seller: BookingSeller.SUPPLIER,
          checkIn: d("2026-07-02"),
          checkOut: d("2026-07-05"),
        },
      ],
      []
    );
    expect(cells.every((c) => c === "EMPTY")).toBe(true);
  });
});
