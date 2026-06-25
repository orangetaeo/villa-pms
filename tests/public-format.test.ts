import { describe, expect, it, vi } from "vitest";
import { Currency } from "@prisma/client";
import {
  bookingShortCode,
  formatPublicAmount,
} from "@/app/p/_components/public-format";

// 날짜·만료 배지 표기는 lib/public-i18n으로 이전(5개 언어) → tests/public-i18n.test.ts에서 검증.

describe("formatPublicAmount — 표기 (쉼표·원/₫, 기본 ko)", () => {
  it("KRW → '1,350,000원' (기본 ko)", () => {
    expect(formatPublicAmount(Currency.KRW, 1_350_000, null)).toBe("1,350,000원");
  });

  it("KRW en → '1,350,000₩' (언어별 접미사)", () => {
    expect(formatPublicAmount(Currency.KRW, 1_350_000, null, "en")).toBe("1,350,000₩");
  });

  it("VND → '25,500,000₫' (통화 공통)", () => {
    expect(formatPublicAmount(Currency.VND, null, 25_500_000n)).toBe("25,500,000₫");
    expect(formatPublicAmount(Currency.VND, null, 25_500_000n, "ru")).toBe("25,500,000₫");
  });

  it("듀얼 컬럼 정합 위반은 '0원' 은폐 대신 '—' + 에러 로그 (QA L2)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatPublicAmount(Currency.KRW, null, 25_500_000n)).toBe("—");
    expect(formatPublicAmount(Currency.VND, 1_350_000, null)).toBe("—");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("bookingShortCode — 예약번호 칩 (B-2611 형식)", () => {
  it("끝 4자 대문자", () => {
    expect(bookingShortCode("cmbtxyz123abcd2611")).toBe("B-2611");
    expect(bookingShortCode("cmbtxyzab12cdef")).toBe("B-CDEF");
  });
});
