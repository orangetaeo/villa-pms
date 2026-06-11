import { describe, expect, it } from "vitest";
import { BookingChannel, Currency, ProposalStatus } from "@prisma/client";
import {
  defaultCurrencyForChannel,
  effectiveProposalStatus,
  generateProposalToken,
  uniformNightlyPrice,
} from "./proposal";

const NOW = new Date("2026-07-01T10:00:00.000Z");

describe("defaultCurrencyForChannel — 채널 → 통화 기본값 (ADR-0003)", () => {
  it("DIRECT(직접 소비자) → KRW", () => {
    expect(defaultCurrencyForChannel(BookingChannel.DIRECT)).toBe(Currency.KRW);
  });

  it("여행사·랜드사 → VND", () => {
    expect(defaultCurrencyForChannel(BookingChannel.TRAVEL_AGENCY)).toBe(Currency.VND);
    expect(defaultCurrencyForChannel(BookingChannel.LAND_AGENCY)).toBe(Currency.VND);
  });
});

describe("effectiveProposalStatus — 시각 기준 서버 판정 (c2 단일 렌더 소스)", () => {
  it("ACTIVE + 미만료 → ACTIVE", () => {
    expect(
      effectiveProposalStatus(ProposalStatus.ACTIVE, new Date(NOW.getTime() + 1), NOW)
    ).toBe(ProposalStatus.ACTIVE);
  });

  it("ACTIVE + expiresAt 경과(동시각 포함) → EXPIRED — evaluateProposalForHold와 동일 규약", () => {
    expect(effectiveProposalStatus(ProposalStatus.ACTIVE, NOW, NOW)).toBe(ProposalStatus.EXPIRED);
    expect(
      effectiveProposalStatus(ProposalStatus.ACTIVE, new Date(NOW.getTime() - 1), NOW)
    ).toBe(ProposalStatus.EXPIRED);
  });

  it.each([ProposalStatus.USED, ProposalStatus.REVOKED, ProposalStatus.EXPIRED])(
    "비ACTIVE(%s)는 만료 여부와 무관하게 그대로",
    (status) => {
      expect(effectiveProposalStatus(status, new Date(NOW.getTime() + 1), NOW)).toBe(status);
      expect(effectiveProposalStatus(status, new Date(NOW.getTime() - 1), NOW)).toBe(status);
    }
  );
});

describe("uniformNightlyPrice — 균일가만 perNight 채움 (money-pattern: 평균 가공 금지)", () => {
  it("전 박 동일 요율이면 그 값 (KRW number)", () => {
    expect(uniformNightlyPrice([350_000, 350_000, 350_000])).toBe(350_000);
  });

  it("전 박 동일 요율이면 그 값 (VND bigint)", () => {
    expect(uniformNightlyPrice([6_000_000n, 6_000_000n])).toBe(6_000_000n);
  });

  it("시즌 경계로 요율이 섞이면 null — 평균·반올림 가공 금지", () => {
    expect(uniformNightlyPrice([350_000, 350_000, 230_000])).toBeNull();
    expect(uniformNightlyPrice([6_000_000n, 4_000_000n])).toBeNull();
  });

  it("빈 배열은 null", () => {
    expect(uniformNightlyPrice([])).toBeNull();
  });
});

describe("generateProposalToken — 공개 링크 토큰", () => {
  it("URL-safe(base64url) 32자, 호출마다 상이", () => {
    const a = generateProposalToken();
    const b = generateProposalToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24바이트 → base64url 32자
    expect(a).not.toBe(b);
  });
});
