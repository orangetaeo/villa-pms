// lib/date-vn 회귀 테스트 (T-util-tests) — @db.Date(UTC 자정) ↔ VN 표시 규칙
import { describe, it, expect } from "vitest";
import {
  parseUtcDateOnly,
  toDateOnlyString,
  todayVnDateString,
  addUtcDays,
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
