// lib/format 회귀 테스트 (T-util-tests) — 금액 표기(부동소수점 금지, BigInt 문자열 처리)
import { describe, it, expect } from "vitest";
import { formatThousands, formatVnd, formatKrw, formatDateTime } from "./format";

describe("formatThousands", () => {
  it("BigInt 천단위 쉼표 (Number 캐스팅 없이 정밀)", () => {
    expect(formatThousands(1200000n)).toBe("1,200,000");
    // 안전 정수 범위를 넘는 큰 VND도 정밀 (부동소수점 손실 없음)
    expect(formatThousands(9007199254740993n)).toBe("9,007,199,254,740,993");
  });
  it("문자열·number 입력", () => {
    expect(formatThousands("1200000")).toBe("1,200,000");
    expect(formatThousands(450000)).toBe("450,000");
  });
  it("음수 — 부호 보존", () => {
    expect(formatThousands(-1500n)).toBe("-1,500");
    expect(formatThousands("-1234567")).toBe("-1,234,567");
  });
  it("경계 — 0, 3자리 미만", () => {
    expect(formatThousands(0n)).toBe("0");
    expect(formatThousands(12n)).toBe("12");
    expect(formatThousands(999n)).toBe("999");
    expect(formatThousands(1000n)).toBe("1,000");
  });
  it("비정수 문자열은 원본 반환 (방어)", () => {
    expect(formatThousands("12.5")).toBe("12.5");
    expect(formatThousands("abc")).toBe("abc");
  });
});

describe("formatVnd / formatKrw", () => {
  it("VND — 쉼표 + ₫ 접미", () => {
    expect(formatVnd(1200000n)).toBe("1,200,000₫");
    expect(formatVnd("0")).toBe("0₫");
  });
  it("KRW — ₩ 접두 + 쉼표, 소수 trunc", () => {
    expect(formatKrw(450000)).toBe("₩450,000");
    expect(formatKrw(450000.9)).toBe("₩450,000"); // 내림(버림)
    expect(formatKrw(0)).toBe("₩0");
  });
});

describe("formatDateTime (Asia/Ho_Chi_Minh, 24h)", () => {
  it("UTC → VN(+7) YYYY.MM.DD HH:mm", () => {
    // 10:30Z → VN 17:30
    expect(formatDateTime(new Date("2026-06-16T10:30:00Z"))).toBe("2026.06.16 17:30");
  });
  it("자정 경계 — UTC 18:00 → VN 익일 01:00", () => {
    expect(formatDateTime(new Date("2026-06-16T18:00:00Z"))).toBe("2026.06.17 01:00");
  });
});
