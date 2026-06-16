import { describe, expect, it } from "vitest";
import { isReplyWindowOpen, REPLY_WINDOW_MS } from "@/lib/zalo-chat";

describe("isReplyWindowOpen (48h CS 응답 창 — T6.6)", () => {
  const now = new Date("2026-06-16T12:00:00.000Z");

  it("lastInboundAt 없음 → 닫힘", () => {
    expect(isReplyWindowOpen(null, now)).toBe(false);
    expect(isReplyWindowOpen(undefined, now)).toBe(false);
  });

  it("48시간 이내 → 열림", () => {
    const recent = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1시간 전
    expect(isReplyWindowOpen(recent, now)).toBe(true);
  });

  it("정확히 48시간 직전 → 열림", () => {
    const justInside = new Date(now.getTime() - REPLY_WINDOW_MS + 1000);
    expect(isReplyWindowOpen(justInside, now)).toBe(true);
  });

  it("48시간 경과 → 닫힘", () => {
    const expired = new Date(now.getTime() - REPLY_WINDOW_MS - 1000);
    expect(isReplyWindowOpen(expired, now)).toBe(false);
  });

  it("정확히 48시간 경계 → 닫힘(초과만 허용)", () => {
    const exactly = new Date(now.getTime() - REPLY_WINDOW_MS);
    expect(isReplyWindowOpen(exactly, now)).toBe(false);
  });

  it("문자열·ISO 입력 허용", () => {
    const recent = new Date(now.getTime() - 60 * 1000).toISOString();
    expect(isReplyWindowOpen(recent, now)).toBe(true);
  });

  it("비정상 날짜 문자열 → 닫힘", () => {
    expect(isReplyWindowOpen("not-a-date", now)).toBe(false);
  });
});
