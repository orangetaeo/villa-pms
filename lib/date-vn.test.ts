// lib/date-vn 회귀 테스트 (T-util-tests) — @db.Date(UTC 자정) ↔ VN 표시 규칙
import { describe, it, expect } from "vitest";
import {
  parseUtcDateOnly,
  toDateOnlyString,
  todayVnDateString,
  addUtcDays,
  resolveQuickRange,
  vnDayStartUtc,
  quickRangeWhere,
  isQuickRangeKey,
  addDateOnlyDays,
  checkOutFromNights,
  nightsBetween,
} from "./date-vn";

describe("parseUtcDateOnly", () => {
  it("유효 날짜 → UTC 자정 Date", () => {
    const d = parseUtcDateOnly("2026-06-16");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("실존하지 않는 날짜(롤오버) 거부", () => {
    expect(parseUtcDateOnly("2026-02-31")).toBeNull(); // 2월 31일 → 3월로 롤오버
    expect(parseUtcDateOnly("2026-13-01")).toBeNull(); // 13월
    expect(parseUtcDateOnly("2026-00-10")).toBeNull(); // 0월
  });

  it("형식 위반 거부 (자릿수·구분자)", () => {
    expect(parseUtcDateOnly("2026-6-1")).toBeNull();
    expect(parseUtcDateOnly("2026/06/16")).toBeNull();
    expect(parseUtcDateOnly("16-06-2026")).toBeNull();
    expect(parseUtcDateOnly("")).toBeNull();
    expect(parseUtcDateOnly("2026-06-16T00:00:00Z")).toBeNull();
  });

  it("윤년 2월 29일 — 윤년만 허용", () => {
    expect(parseUtcDateOnly("2028-02-29")).not.toBeNull(); // 2028 윤년
    expect(parseUtcDateOnly("2026-02-29")).toBeNull(); // 2026 평년
  });
});

describe("toDateOnlyString", () => {
  it("UTC 자정 Date → YYYY-MM-DD", () => {
    expect(toDateOnlyString(new Date("2026-06-16T00:00:00.000Z"))).toBe("2026-06-16");
  });
  it("round-trip parse↔serialize 항등", () => {
    const s = "2026-12-31";
    expect(toDateOnlyString(parseUtcDateOnly(s)!)).toBe(s);
  });
});

describe("todayVnDateString (Asia/Ho_Chi_Minh = UTC+7)", () => {
  it("VN 자정 경계 — UTC 17:00에 VN 날짜가 익일로 넘어감", () => {
    // 2026-06-16T16:59:59Z → VN 23:59:59 (같은 날)
    expect(todayVnDateString(new Date("2026-06-16T16:59:59Z"))).toBe("2026-06-16");
    // 2026-06-16T17:00:00Z → VN 2026-06-17 00:00 (익일)
    expect(todayVnDateString(new Date("2026-06-16T17:00:00Z"))).toBe("2026-06-17");
  });
  it("연말 경계 — UTC 18:00 12/31 → VN 익년 01/01", () => {
    expect(todayVnDateString(new Date("2026-12-31T18:00:00Z"))).toBe("2027-01-01");
  });
});

describe("addUtcDays", () => {
  it("단일 날짜 차단 [d, d+1) 의 endDate", () => {
    const d = parseUtcDateOnly("2026-06-16")!;
    expect(toDateOnlyString(addUtcDays(d, 1))).toBe("2026-06-17");
  });
  it("월·연 경계 롤오버", () => {
    expect(toDateOnlyString(addUtcDays(parseUtcDateOnly("2026-01-31")!, 1))).toBe("2026-02-01");
    expect(toDateOnlyString(addUtcDays(parseUtcDateOnly("2026-12-31")!, 1))).toBe("2027-01-01");
  });
  it("음수 days — 역방향", () => {
    expect(toDateOnlyString(addUtcDays(parseUtcDateOnly("2026-03-01")!, -1))).toBe("2026-02-28");
  });
});

describe("resolveQuickRange (VN 기준, 주=월요일 시작)", () => {
  // 2026-06-16 = 화요일 (이번주 월요일 = 06-15)
  const now = new Date("2026-06-16T03:00:00Z"); // VN 10:00 같은 날

  it("all/무효/미지정 → null (날짜 제한 없음)", () => {
    expect(resolveQuickRange("all", now)).toBeNull();
    expect(resolveQuickRange(undefined, now)).toBeNull();
    expect(resolveQuickRange("bogus", now)).toBeNull();
  });

  it("오늘/어제 — 반개구간 [from, to)", () => {
    expect(resolveQuickRange("today", now)).toEqual({ from: "2026-06-16", to: "2026-06-17" });
    expect(resolveQuickRange("yesterday", now)).toEqual({ from: "2026-06-15", to: "2026-06-16" });
  });

  it("이번주/지난주 — 월요일 시작", () => {
    expect(resolveQuickRange("thisWeek", now)).toEqual({ from: "2026-06-15", to: "2026-06-22" });
    expect(resolveQuickRange("lastWeek", now)).toEqual({ from: "2026-06-08", to: "2026-06-15" });
  });

  it("이번달/지난달/다음달 — 월초 경계", () => {
    expect(resolveQuickRange("thisMonth", now)).toEqual({ from: "2026-06-01", to: "2026-07-01" });
    expect(resolveQuickRange("lastMonth", now)).toEqual({ from: "2026-05-01", to: "2026-06-01" });
    expect(resolveQuickRange("nextMonth", now)).toEqual({ from: "2026-07-01", to: "2026-08-01" });
  });

  it("연말 경계 — 12월의 다음달은 익년 1월", () => {
    const dec = new Date("2026-12-10T03:00:00Z");
    expect(resolveQuickRange("nextMonth", dec)).toEqual({ from: "2027-01-01", to: "2027-02-01" });
    expect(resolveQuickRange("thisMonth", dec)).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });

  it("VN 자정 경계 — UTC 17:00 이후엔 익일 기준", () => {
    const lateUtc = new Date("2026-06-16T17:00:00Z"); // VN 2026-06-17 00:00
    expect(resolveQuickRange("today", lateUtc)).toEqual({ from: "2026-06-17", to: "2026-06-18" });
  });
});

describe("vnDayStartUtc / quickRangeWhere", () => {
  const now = new Date("2026-06-16T03:00:00Z");

  it("vnDayStartUtc — VN 자정의 실제 UTC 순간(-7h)", () => {
    expect(vnDayStartUtc("2026-06-16").toISOString()).toBe("2026-06-15T17:00:00.000Z");
  });

  it("kind=date — @db.Date(UTC 자정) 필드용", () => {
    const w = quickRangeWhere("today", "date", now)!;
    expect(w.gte.toISOString()).toBe("2026-06-16T00:00:00.000Z");
    expect(w.lt.toISOString()).toBe("2026-06-17T00:00:00.000Z");
  });

  it("kind=timestamp — createdAt 등 UTC 순간 필드용(-7h)", () => {
    const w = quickRangeWhere("today", "timestamp", now)!;
    expect(w.gte.toISOString()).toBe("2026-06-15T17:00:00.000Z");
    expect(w.lt.toISOString()).toBe("2026-06-16T17:00:00.000Z");
  });

  it("all → undefined (조건 미적용)", () => {
    expect(quickRangeWhere("all", "date", now)).toBeUndefined();
    expect(quickRangeWhere(undefined, "timestamp", now)).toBeUndefined();
  });
});

describe("isQuickRangeKey", () => {
  it("유효 키만 true", () => {
    expect(isQuickRangeKey("thisMonth")).toBe(true);
    expect(isQuickRangeKey("all")).toBe(true);
    expect(isQuickRangeKey("bogus")).toBe(false);
    expect(isQuickRangeKey(undefined)).toBe(false);
  });
});

// ── F10 T10.2b 직접예약 다박(기간) 선택 ──
describe("addDateOnlyDays", () => {
  it("양수 더하기", () => {
    expect(addDateOnlyDays("2026-07-14", 2)).toBe("2026-07-16");
  });
  it("월 경계 넘김", () => {
    expect(addDateOnlyDays("2026-07-30", 3)).toBe("2026-08-02");
  });
  it("연 경계 넘김", () => {
    expect(addDateOnlyDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("음수 빼기", () => {
    expect(addDateOnlyDays("2026-07-14", -1)).toBe("2026-07-13");
  });
  it("윤년 2월", () => {
    expect(addDateOnlyDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("잘못된 형식 → 입력 그대로", () => {
    expect(addDateOnlyDays("bogus", 2)).toBe("bogus");
    expect(addDateOnlyDays("2026-02-31", 1)).toBe("2026-02-31");
  });
});

describe("checkOutFromNights", () => {
  it("1박 = 다음날", () => {
    expect(checkOutFromNights("2026-07-14", 1)).toBe("2026-07-15");
  });
  it("2박", () => {
    expect(checkOutFromNights("2026-07-14", 2)).toBe("2026-07-16");
  });
  it("5박", () => {
    expect(checkOutFromNights("2026-07-14", 5)).toBe("2026-07-19");
  });
  it("월 경계 다박", () => {
    expect(checkOutFromNights("2026-07-29", 5)).toBe("2026-08-03");
  });
  it("0·음수 박수 → 최소 1박으로 클램프", () => {
    expect(checkOutFromNights("2026-07-14", 0)).toBe("2026-07-15");
    expect(checkOutFromNights("2026-07-14", -3)).toBe("2026-07-15");
  });
  it("소수 박수 → 내림", () => {
    expect(checkOutFromNights("2026-07-14", 2.9)).toBe("2026-07-16");
  });
});

describe("nightsBetween", () => {
  it("checkOut - checkIn 박수", () => {
    expect(nightsBetween("2026-07-14", "2026-07-16")).toBe(2);
    expect(nightsBetween("2026-07-14", "2026-07-15")).toBe(1);
  });
  it("월 경계", () => {
    expect(nightsBetween("2026-07-29", "2026-08-03")).toBe(5);
  });
  it("checkOut ≤ checkIn → 0", () => {
    expect(nightsBetween("2026-07-16", "2026-07-14")).toBe(0);
    expect(nightsBetween("2026-07-14", "2026-07-14")).toBe(0);
  });
  it("checkOutFromNights 역연산 일치", () => {
    expect(nightsBetween("2026-07-14", checkOutFromNights("2026-07-14", 4))).toBe(4);
  });
  it("잘못된 형식 → 0", () => {
    expect(nightsBetween("bogus", "2026-07-16")).toBe(0);
  });
});
