import { describe, it, expect, vi } from "vitest";
import { WebChatDirection, WebChatSessionStatus } from "@prisma/client";

// operator-notify는 lib/prisma를 로드하므로 mock으로 체인 차단(순수 함수만 검증) — b2c 테스트와 동일 패턴.
vi.mock("@/lib/operator-notify", () => ({
  enqueueOperatorNotification: async () => 1,
}));

import {
  selectUnansweredSessions,
  resolveThresholdMinutes,
  DEFAULT_UNANSWERED_MINUTES,
  type UnansweredCandidate,
} from "./webchat-reminder";

const NOW = new Date("2026-07-24T12:00:00.000Z");
const MIN = 60 * 1000;
const THRESHOLD_MS = 30 * MIN;

function session(overrides: Partial<UnansweredCandidate>): UnansweredCandidate {
  return {
    id: "s1",
    status: WebChatSessionStatus.OPEN,
    lastMessageDirection: WebChatDirection.INBOUND,
    lastMessageAt: new Date(NOW.getTime() - 40 * MIN), // 40분 경과(기본 미응답)
    ...overrides,
  };
}

describe("selectUnansweredSessions — 미응답 리마인드 대상 선별", () => {
  it("OPEN + 마지막 INBOUND + 임계치 경과 세션을 대상으로 뽑는다", () => {
    const got = selectUnansweredSessions([session({})], new Map(), NOW, THRESHOLD_MS);
    expect(got).toEqual(["s1"]);
  });

  it("아직 임계치 미경과(20분)면 제외", () => {
    const s = session({ lastMessageAt: new Date(NOW.getTime() - 20 * MIN) });
    expect(selectUnansweredSessions([s], new Map(), NOW, THRESHOLD_MS)).toEqual([]);
  });

  it("마지막 메시지가 OUTBOUND(운영자 답장함)면 제외", () => {
    const s = session({ lastMessageDirection: WebChatDirection.OUTBOUND });
    expect(selectUnansweredSessions([s], new Map(), NOW, THRESHOLD_MS)).toEqual([]);
  });

  it("OPEN이 아닌(CLOSED/BLOCKED) 세션은 제외", () => {
    const closed = session({ id: "c", status: WebChatSessionStatus.CLOSED });
    const blocked = session({ id: "b", status: WebChatSessionStatus.BLOCKED });
    expect(selectUnansweredSessions([closed, blocked], new Map(), NOW, THRESHOLD_MS)).toEqual([]);
  });

  it("메시지가 아예 없으면(lastMessageAt=null) 제외", () => {
    const s = session({ lastMessageAt: null });
    expect(selectUnansweredSessions([s], new Map(), NOW, THRESHOLD_MS)).toEqual([]);
  });

  it("이미 이 미응답 구간에 리마인드를 보냈으면 제외(중복 방지)", () => {
    const s = session({ lastMessageAt: new Date(NOW.getTime() - 40 * MIN) });
    // 마지막 방문자 메시지(40분 전) 이후 35분 전에 리마인드 발송함 → 스킵
    const reminded = new Map([["s1", NOW.getTime() - 35 * MIN]]);
    expect(selectUnansweredSessions([s], reminded, NOW, THRESHOLD_MS)).toEqual([]);
  });

  it("리마인드 이후 새 방문자 메시지가 오면 다시 대상(lastMessageAt > 이전 리마인드)", () => {
    const s = session({ lastMessageAt: new Date(NOW.getTime() - 40 * MIN) });
    // 리마인드는 50분 전에 보냈고, 그 뒤 40분 전에 새 메시지가 옴 → 다시 대상
    const reminded = new Map([["s1", NOW.getTime() - 50 * MIN]]);
    expect(selectUnansweredSessions([s], reminded, NOW, THRESHOLD_MS)).toEqual(["s1"]);
  });
});

describe("resolveThresholdMinutes — env 파싱", () => {
  it("미설정/빈값/0/음수/비정상은 기본 30분", () => {
    expect(resolveThresholdMinutes(undefined)).toBe(DEFAULT_UNANSWERED_MINUTES);
    expect(resolveThresholdMinutes("")).toBe(30);
    expect(resolveThresholdMinutes("0")).toBe(30);
    expect(resolveThresholdMinutes("-5")).toBe(30);
    expect(resolveThresholdMinutes("abc")).toBe(30);
  });

  it("양의 정수는 그대로 사용", () => {
    expect(resolveThresholdMinutes("15")).toBe(15);
    expect(resolveThresholdMinutes("60")).toBe(60);
  });
});
