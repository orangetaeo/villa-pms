import { describe, expect, it } from "vitest";
import {
  isWebChatCardKind,
  parseWebChatCardPayload,
  isSafeCardUrl,
} from "./webchat-card";

describe("isWebChatCardKind — 카드 종류 화이트리스트", () => {
  it("checkin/options/receipt/proposal/villa는 카드", () => {
    for (const k of ["checkin", "options", "receipt", "proposal", "villa"]) {
      expect(isWebChatCardKind(k)).toBe(true);
    }
  });
  it("null·미지정·미지 kind는 폴백 텍스트", () => {
    expect(isWebChatCardKind(null)).toBe(false);
    expect(isWebChatCardKind(undefined)).toBe(false);
    expect(isWebChatCardKind("chat")).toBe(false);
  });
});

describe("parseWebChatCardPayload — kind별 분기 (villa url 선택)", () => {
  it("villa: villaId + url → 둘 다 반환", () => {
    expect(parseWebChatCardPayload({ villaId: "v1", url: "/blog/villa/x" }, "villa")).toEqual({
      villaId: "v1",
      url: "/blog/villa/x",
    });
  });
  it("★villa: url 없이 villaId만 있어도 non-null(공개 상세페이지 없는 빌라)", () => {
    expect(parseWebChatCardPayload({ villaId: "v1" }, "villa")).toEqual({ villaId: "v1" });
    // url이 빈 문자열이어도 villaId만으로 유효
    expect(parseWebChatCardPayload({ villaId: "v1", url: "" }, "villa")).toEqual({ villaId: "v1" });
  });
  it("villa인데 villaId 없으면 null(카드 불가 → 폴백 텍스트)", () => {
    expect(parseWebChatCardPayload({ url: "/blog/villa/x" }, "villa")).toBeNull();
    expect(parseWebChatCardPayload({}, "villa")).toBeNull();
  });

  it("링크 카드(proposal 등)·kind 미지정은 url 필수(회귀 방지)", () => {
    expect(parseWebChatCardPayload({ url: "/p/tok" }, "proposal")).toEqual({ url: "/p/tok" });
    expect(parseWebChatCardPayload({ villaId: "v1" }, "proposal")).toBeNull(); // url 없으면 null
    expect(parseWebChatCardPayload({ url: "/g/tok" })).toEqual({ url: "/g/tok" }); // kind 미지정=url 필수
    expect(parseWebChatCardPayload({}, "checkin")).toBeNull();
  });

  it("형식 불량(비객체·null)은 null", () => {
    expect(parseWebChatCardPayload(null, "villa")).toBeNull();
    expect(parseWebChatCardPayload("nope", "villa")).toBeNull();
    expect(parseWebChatCardPayload(undefined)).toBeNull();
  });
});

describe("isSafeCardUrl — 스킴 안전성", () => {
  it("http(s) 절대·동일 오리진 상대는 허용", () => {
    expect(isSafeCardUrl("https://villa-go.net/blog/villa/x")).toBe(true);
    expect(isSafeCardUrl("/blog/villa/x")).toBe(true);
  });
  it("javascript:·//타호스트는 차단", () => {
    expect(isSafeCardUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeCardUrl("//evil.example.com")).toBe(false);
  });
});
