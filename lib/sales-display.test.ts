import { describe, it, expect } from "vitest";
import {
  minutesToHHMM,
  hhmmToMinutes,
  buildTimeOptions,
  formatDistanceM,
  aggregateBeds,
  buildBedSummary,
  countBedrooms,
  sumRoomCapacity,
} from "@/lib/sales-display";

describe("minutesToHHMM", () => {
  it("840 → 14:00", () => expect(minutesToHHMM(840)).toBe("14:00"));
  it("660 → 11:00", () => expect(minutesToHHMM(660)).toBe("11:00"));
  it("0 → 00:00, 1439 → 23:59", () => {
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(minutesToHHMM(1439)).toBe("23:59");
  });
  it("범위 밖 클램프", () => {
    expect(minutesToHHMM(-10)).toBe("00:00");
    expect(minutesToHHMM(99999)).toBe("23:59");
  });
});

describe("hhmmToMinutes", () => {
  it("14:00 → 840", () => expect(hhmmToMinutes("14:00")).toBe(840));
  it("round-trip", () => {
    for (const m of [0, 30, 660, 840, 1439]) {
      expect(hhmmToMinutes(minutesToHHMM(m))).toBe(m);
    }
  });
  it("잘못된 형식 → null", () => {
    expect(hhmmToMinutes("25:00")).toBeNull();
    expect(hhmmToMinutes("14:60")).toBeNull();
    expect(hhmmToMinutes("abc")).toBeNull();
  });
});

describe("buildTimeOptions", () => {
  it("30분 간격 종일 = 48개", () => expect(buildTimeOptions().length).toBe(48));
  it("범위 옵션", () =>
    expect(buildTimeOptions(780, 960)).toEqual([
      "13:00",
      "13:30",
      "14:00",
      "14:30",
      "15:00",
      "15:30",
      "16:00",
    ]));
});

describe("formatDistanceM", () => {
  it("미만 1000 → m", () => expect(formatDistanceM(350)).toBe("350m"));
  it("1200 → 1.2km", () => expect(formatDistanceM(1200)).toBe("1.2km"));
  it("1000 → 1km (소수 0 생략)", () => expect(formatDistanceM(1000)).toBe("1km"));
  it("2050 → 2km (반올림 아님, 절삭)", () => expect(formatDistanceM(2050)).toBe("2km"));
  it("null/음수 → null", () => {
    expect(formatDistanceM(null)).toBeNull();
    expect(formatDistanceM(-5)).toBeNull();
  });
});

describe("aggregateBeds / buildBedSummary", () => {
  const beds = [
    { bedType: "KING" as const, bedCount: 1, roomIndex: 1 },
    { bedType: "SINGLE" as const, bedCount: 2, roomIndex: 1 },
    { bedType: "KING" as const, bedCount: 1, roomIndex: 2 },
    { bedType: "QUEEN" as const, bedCount: 1, roomIndex: 3 },
  ];
  it("종류별 합계 (순서 보존)", () =>
    expect(aggregateBeds(beds)).toEqual([
      { bedType: "KING", count: 2 },
      { bedType: "SINGLE", count: 2 },
      { bedType: "QUEEN", count: 1 },
    ]));
  it("요약 문자열", () =>
    expect(buildBedSummary(beds, (t) => ({ KING: "킹", QUEEN: "퀸", SINGLE: "싱글" } as Record<string, string>)[t] ?? t)).toBe(
      "킹 2 / 싱글 2 / 퀸 1"
    ));
});

describe("countBedrooms / sumRoomCapacity", () => {
  const beds = [
    { roomIndex: 1, capacity: 3 },
    { roomIndex: 1, capacity: 3 },
    { roomIndex: 2, capacity: 2 },
    { roomIndex: 3, capacity: null },
  ];
  it("고유 침실 수", () => expect(countBedrooms(beds)).toBe(3));
  it("수용 합계 (roomIndex별 1값, null=0)", () => expect(sumRoomCapacity(beds)).toBe(5));
});
