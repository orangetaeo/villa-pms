import { describe, expect, it } from "vitest";
import { ProposalStatus } from "@prisma/client";
import {
  DEFAULT_HOLD_HOURS,
  computeHoldExpiresAt,
  countNights,
  evaluateProposalForHold,
  resolveHoldHours,
} from "./hold";

/** @db.Date 규약과 동일하게 UTC 자정 Date 생성 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-07-01T10:00:00.000Z");

describe("resolveHoldHours — 우선순위: override > AppSetting > 기본 48", () => {
  it("override(제안별 24/48h 선택)가 최우선", () => {
    expect(resolveHoldHours("72", 24)).toBe(24);
    expect(resolveHoldHours(null, 48)).toBe(48);
  });

  it("override 범위 밖·비정수는 RangeError (조용한 폴백 금지 — 호출부 버그)", () => {
    expect(() => resolveHoldHours(null, 0)).toThrow(RangeError);
    expect(() => resolveHoldHours(null, 169)).toThrow(RangeError);
    expect(() => resolveHoldHours(null, 24.5)).toThrow(RangeError);
    expect(() => resolveHoldHours(null, -24)).toThrow(RangeError);
  });

  it("override 없으면 AppSetting 값", () => {
    expect(resolveHoldHours("72")).toBe(72);
    expect(resolveHoldHours("24")).toBe(24);
  });

  it("AppSetting 오염(비숫자·범위 밖)은 기본 48로 폴백 (서비스 중단 금지)", () => {
    expect(resolveHoldHours("abc")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours("0")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours("999")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours("48.5")).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours(null)).toBe(DEFAULT_HOLD_HOURS);
    expect(resolveHoldHours(undefined)).toBe(DEFAULT_HOLD_HOURS);
  });
});

describe("computeHoldExpiresAt", () => {
  it("now + 시간", () => {
    expect(computeHoldExpiresAt(NOW, 48).toISOString()).toBe("2026-07-03T10:00:00.000Z");
    expect(computeHoldExpiresAt(NOW, 24).toISOString()).toBe("2026-07-02T10:00:00.000Z");
  });
});

describe("evaluateProposalForHold — 제안 검증 (SPEC F3)", () => {
  const base = {
    proposalStatus: ProposalStatus.ACTIVE,
    proposalExpiresAt: new Date("2026-07-02T10:00:00.000Z"),
    itemBookingId: null,
    now: NOW,
  };

  it("ACTIVE + 미만료 + 미사용 → 통과(null)", () => {
    expect(evaluateProposalForHold(base)).toBeNull();
  });

  it("이미 가예약된 item → ITEM_ALREADY_BOOKED (상태보다 우선 판정)", () => {
    expect(
      evaluateProposalForHold({ ...base, itemBookingId: "bk_1", proposalStatus: ProposalStatus.USED })
    ).toBe("ITEM_ALREADY_BOOKED");
  });

  it.each([ProposalStatus.USED, ProposalStatus.EXPIRED, ProposalStatus.REVOKED])(
    "제안 status=%s → PROPOSAL_NOT_ACTIVE",
    (status) => {
      expect(evaluateProposalForHold({ ...base, proposalStatus: status })).toBe("PROPOSAL_NOT_ACTIVE");
    }
  );

  it("expiresAt 경과(동시각 포함) → PROPOSAL_EXPIRED — status 갱신 전이라도 시각 기준 거부", () => {
    expect(evaluateProposalForHold({ ...base, proposalExpiresAt: NOW })).toBe("PROPOSAL_EXPIRED");
    expect(
      evaluateProposalForHold({ ...base, proposalExpiresAt: new Date(NOW.getTime() - 1) })
    ).toBe("PROPOSAL_EXPIRED");
  });

  it("expiresAt 미래면 통과", () => {
    expect(
      evaluateProposalForHold({ ...base, proposalExpiresAt: new Date(NOW.getTime() + 1) })
    ).toBeNull();
  });
});

describe("countNights — [checkIn, checkOut) UTC 자정", () => {
  it("박 수 계산", () => {
    expect(countNights({ checkIn: d("2026-07-01"), checkOut: d("2026-07-04") })).toBe(3);
    expect(countNights({ checkIn: d("2026-12-30"), checkOut: d("2027-01-02") })).toBe(3);
  });

  it("0박·역전 거부", () => {
    expect(() => countNights({ checkIn: d("2026-07-01"), checkOut: d("2026-07-01") })).toThrow(RangeError);
    expect(() => countNights({ checkIn: d("2026-07-05"), checkOut: d("2026-07-01") })).toThrow(RangeError);
  });
});
