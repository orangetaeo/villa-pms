import { describe, it, expect } from "vitest";
import { phoneTailMatch, tokenPrefixOf } from "./webchat-candidate-match";

describe("phoneTailMatch — 전화 꼬리 8자리 매칭", () => {
  it("국가코드/선행0 차이를 흡수한다 (84901234567 ↔ 0901234567 = true)", () => {
    expect(phoneTailMatch("84901234567", "0901234567")).toBe(true);
    expect(phoneTailMatch("0901234567", "84901234567")).toBe(true);
  });

  it("마지막 8자리가 같으면 나머지 앞자리는 무관", () => {
    expect(phoneTailMatch("99999901234567", "111901234567")).toBe(true);
  });

  it("8자리 미만이면 완전 일치만 인정", () => {
    expect(phoneTailMatch("1234567", "1234567")).toBe(true); // 7자리 동일
    expect(phoneTailMatch("1234567", "91234567")).toBe(false); // 한쪽만 8자리
    expect(phoneTailMatch("234567", "1234567")).toBe(false);
  });

  it("뒷 8자리가 다르면 false", () => {
    expect(phoneTailMatch("84901234567", "0907654321")).toBe(false);
  });

  it("빈 문자열은 false", () => {
    expect(phoneTailMatch("", "0901234567")).toBe(false);
    expect(phoneTailMatch("0901234567", "")).toBe(false);
    expect(phoneTailMatch("", "")).toBe(false);
  });
});

describe("tokenPrefixOf — sourcePage g:<prefix> 추출 (6자 이상 가드)", () => {
  it("g:<8자> → prefix 반환", () => {
    expect(tokenPrefixOf("g:12345678")).toBe("12345678");
  });

  it("6자 이상이면 그대로 반환", () => {
    expect(tokenPrefixOf("g:abcdef")).toBe("abcdef");
  });

  it("6자 미만이면 null (g:12345 → null)", () => {
    expect(tokenPrefixOf("g:12345")).toBeNull();
    expect(tokenPrefixOf("g:a")).toBeNull();
  });

  it("prefix 앞뒤 공백은 trim 후 길이 판정", () => {
    expect(tokenPrefixOf("g:  12345678  ")).toBe("12345678");
    expect(tokenPrefixOf("g:   ab   ")).toBeNull(); // trim 후 2자 → null
  });

  it("비-g sourcePage는 null", () => {
    expect(tokenPrefixOf("p:12345678")).toBeNull();
    expect(tokenPrefixOf("home")).toBeNull();
    expect(tokenPrefixOf("g")).toBeNull(); // 콜론 없음
    expect(tokenPrefixOf("g:")).toBeNull(); // prefix 없음
  });

  it("null 입력은 null", () => {
    expect(tokenPrefixOf(null)).toBeNull();
  });
});
