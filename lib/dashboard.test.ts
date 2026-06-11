import { describe, expect, it } from "vitest";
import { feedEntryFor, hoursUntil, relativeTimeParts } from "./dashboard";

const NOW = new Date("2026-07-01T10:00:00.000Z");

describe("hoursUntil — 홀드 만료 배지 (올림·과거 0)", () => {
  it("정시·올림", () => {
    expect(hoursUntil(NOW, new Date("2026-07-01T15:00:00.000Z"))).toBe(5);
    expect(hoursUntil(NOW, new Date("2026-07-01T10:01:00.000Z"))).toBe(1); // 1분 → 1시간 올림
  });

  it("과거는 0 (음수 금지 — 만료 경과 홀드)", () => {
    expect(hoursUntil(NOW, new Date("2026-07-01T09:00:00.000Z"))).toBe(0);
  });
});

describe("relativeTimeParts — 피드 상대 시간", () => {
  it("1분 미만 → justNow", () => {
    expect(relativeTimeParts(NOW, new Date("2026-07-01T09:59:30.000Z"))).toEqual({
      key: "justNow",
    });
  });

  it("분·시간 경계", () => {
    expect(relativeTimeParts(NOW, new Date("2026-07-01T09:48:00.000Z"))).toEqual({
      key: "minutesAgo",
      n: 12,
    });
    expect(relativeTimeParts(NOW, new Date("2026-07-01T08:00:00.000Z"))).toEqual({
      key: "hoursAgo",
      n: 2,
    });
    // 정확히 60분 → 1시간
    expect(relativeTimeParts(NOW, new Date("2026-07-01T09:00:00.000Z"))).toEqual({
      key: "hoursAgo",
      n: 1,
    });
  });

  it("24시간 이상 → 날짜 (YYYY.MM.DD)", () => {
    expect(relativeTimeParts(NOW, new Date("2026-06-29T10:00:00.000Z"))).toEqual({
      key: "date",
      date: "2026.06.29",
    });
  });
});

describe("feedEntryFor — AuditLog → 피드 매핑 (b1 dot 색)", () => {
  const log = (entity: string, action: string, statusNew?: string) => ({
    entity,
    action,
    changes: statusNew ? { status: { new: statusNew } } : {},
  });

  it("Booking: 생성=가예약(amber), 확정(blue), 체크인(indigo), 체크아웃·만료(slate), 취소(red)", () => {
    expect(feedEntryFor(log("Booking", "CREATE"))).toEqual({
      labelKey: "holdCreated",
      dot: "amber",
    });
    expect(feedEntryFor(log("Booking", "UPDATE", "CONFIRMED")).labelKey).toBe("bookingConfirmed");
    expect(feedEntryFor(log("Booking", "UPDATE", "CHECKED_IN")).dot).toBe("indigo");
    expect(feedEntryFor(log("Booking", "UPDATE", "CHECKED_OUT")).dot).toBe("slate");
    expect(feedEntryFor(log("Booking", "UPDATE", "EXPIRED")).labelKey).toBe("holdExpired");
    expect(feedEntryFor(log("Booking", "UPDATE", "CANCELLED")).dot).toBe("red");
  });

  it("CleaningTask: 요청·제출·승인(emerald), 반려(red)", () => {
    expect(feedEntryFor(log("CleaningTask", "CREATE")).labelKey).toBe("cleaningRequested");
    expect(feedEntryFor(log("CleaningTask", "UPDATE", "PHOTOS_SUBMITTED")).labelKey).toBe(
      "cleaningSubmitted"
    );
    expect(feedEntryFor(log("CleaningTask", "UPDATE", "APPROVED")).dot).toBe("emerald");
    expect(feedEntryFor(log("CleaningTask", "UPDATE", "REJECTED")).dot).toBe("red");
  });

  it("Proposal 생성·Villa 등록/승인·서명", () => {
    expect(feedEntryFor(log("Proposal", "CREATE")).labelKey).toBe("proposalCreated");
    expect(feedEntryFor(log("Villa", "CREATE")).labelKey).toBe("villaCreated");
    expect(feedEntryFor(log("Villa", "UPDATE", "ACTIVE")).labelKey).toBe("villaApproved");
    expect(feedEntryFor(log("CheckInRecord", "UPDATE")).labelKey).toBe("agreementSigned");
  });

  it("미지의 엔티티·상태 → generic 폴백 (피드가 깨지지 않음)", () => {
    expect(feedEntryFor(log("AppSetting", "UPDATE"))).toEqual({
      labelKey: "generic",
      dot: "slate",
    });
    expect(feedEntryFor(log("Booking", "UPDATE", "NO_SHOW")).labelKey).toBe("generic");
    expect(feedEntryFor({ entity: "Booking", action: "UPDATE", changes: null }).labelKey).toBe(
      "generic"
    );
  });
});
