import { describe, expect, it, vi } from "vitest";
import { Currency } from "@prisma/client";
import {
  bookingShortCode,
  formatExpiryBadge,
  formatKoDateLong,
  formatKoDateShort,
  formatPublicAmount,
} from "@/app/p/_components/public-format";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("formatPublicAmount — c1/c1-vnd 표기 (쉼표·원/₫)", () => {
  it("KRW → '1,350,000원'", () => {
    expect(formatPublicAmount(Currency.KRW, 1_350_000, null)).toBe("1,350,000원");
  });

  it("VND → '25,500,000₫' (쉼표 — 공개 페이지 한국어 표기 규칙)", () => {
    expect(formatPublicAmount(Currency.VND, null, 25_500_000n)).toBe("25,500,000₫");
  });

  it("듀얼 컬럼 정합 위반은 '0원' 은폐 대신 '—' + 에러 로그 (QA L2)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatPublicAmount(Currency.KRW, null, 25_500_000n)).toBe("—");
    expect(formatPublicAmount(Currency.VND, 1_350_000, null)).toBe("—");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("한국어 날짜 표기 — UTC 자정 @db.Date 그대로 (시차 변환 금지)", () => {
  it("formatKoDateLong: '7월 15일 (수)' — c1 요약 행", () => {
    expect(formatKoDateLong(d("2026-07-15"))).toBe("7월 15일 (수)");
    expect(formatKoDateLong(d("2026-07-18"))).toBe("7월 18일 (토)");
  });

  it("formatKoDateShort: '12.20 (일)' — c3 요약 카드", () => {
    expect(formatKoDateShort(d("2026-12-20"))).toBe("12.20 (일)");
    expect(formatKoDateShort(d("2026-01-05"))).toBe("01.05 (월)");
  });
});

describe("formatExpiryBadge — c1 만료 배지", () => {
  const now = new Date("2026-07-01T10:00:00.000Z");

  it("'47시간 후 만료'", () => {
    expect(formatExpiryBadge(new Date("2026-07-03T09:30:00.000Z"), now)).toBe("47시간 후 만료");
  });

  it("1시간 미만은 '곧 만료'", () => {
    expect(formatExpiryBadge(new Date("2026-07-01T10:30:00.000Z"), now)).toBe("곧 만료");
  });
});

describe("bookingShortCode — 예약번호 칩 (B-2611 형식)", () => {
  it("끝 4자 대문자", () => {
    expect(bookingShortCode("cmbtxyz123abcd2611")).toBe("B-2611");
    expect(bookingShortCode("cmbtxyzab12cdef")).toBe("B-CDEF");
  });
});
