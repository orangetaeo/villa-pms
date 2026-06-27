import { describe, it, expect } from "vitest";
import { isStrongPassword, PASSWORD_MIN, BCRYPT_ROUNDS } from "./password-policy";

describe("isStrongPassword (보안 P1-S2)", () => {
  it("8자 미만은 거부", () => {
    expect(isStrongPassword("a1b2c3")).toBe(false); // 6자
    expect(isStrongPassword("")).toBe(false);
  });

  it("8자 이상이라도 숫자·특수문자 없으면 거부(약한 비번)", () => {
    expect(isStrongPassword("aaaaaaaa")).toBe(false);
    expect(isStrongPassword("password")).toBe(false);
    expect(isStrongPassword("ABCDefgh")).toBe(false);
  });

  it("8자 이상 + 숫자 1개면 허용", () => {
    expect(isStrongPassword("password1")).toBe(true);
    expect(isStrongPassword("abcdefg7")).toBe(true);
  });

  it("8자 이상 + 특수문자 1개면 허용", () => {
    expect(isStrongPassword("password!")).toBe(true);
    expect(isStrongPassword("abcdefg@")).toBe(true);
    expect(isStrongPassword("héllo wörld")).toBe(true); // 공백·비ASCII도 특수문자류
  });

  it("문자열 아닌 입력은 거부", () => {
    expect(isStrongPassword(12345678 as unknown)).toBe(false);
    expect(isStrongPassword(null as unknown)).toBe(false);
    expect(isStrongPassword(undefined as unknown)).toBe(false);
  });

  it("상수값", () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(BCRYPT_ROUNDS).toBe(12);
  });
});
