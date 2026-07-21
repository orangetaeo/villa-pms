import { describe, it, expect } from "vitest";
import { urlsPreserved } from "./gemini";

describe("urlsPreserved — 번역 시 URL/링크 보존 판정", () => {
  it("원문 URL이 출력에 그대로 있으면 true", () => {
    const src = "체크인 링크: https://villa-go.net/g/abc123XY 확인해 주세요";
    const out = "Vui lòng kiểm tra link check-in: https://villa-go.net/g/abc123XY";
    expect(urlsPreserved(src, out)).toBe(true);
  });

  it("URL 경로가 변형되면 false (토큰 오타)", () => {
    const src = "링크: https://villa-go.net/g/abc123XY";
    const out = "Link: https://villa-go.net/g/abc123xy"; // 대소문자 변형
    expect(urlsPreserved(src, out)).toBe(false);
  });

  it("URL이 누락되면 false", () => {
    const src = "예약 링크는 https://villa-go.net/p/tok9988 입니다";
    const out = "Đây là link đặt phòng của bạn"; // URL 통째 누락
    expect(urlsPreserved(src, out)).toBe(false);
  });

  it("URL이 분할(split)되면 false", () => {
    const src = "https://villa-go.net/g/tok12345";
    const out = "https://villa-go.net/g/ tok12345"; // 경로 중간에 공백 삽입 = 분할
    expect(urlsPreserved(src, out)).toBe(false);
  });

  it("URL 경로가 percent-encode 되면 false (비ASCII 토큰)", () => {
    const src = "링크 https://villa-go.net/g/토큰코드";
    const out = "link https://villa-go.net/g/%ED%86%A0%ED%81%B0%EC%BD%94%EB%93%9C";
    expect(urlsPreserved(src, out)).toBe(false);
  });

  it("URL이 없는 일반 메시지는 true (회귀 0)", () => {
    expect(urlsPreserved("안녕하세요 오늘 체크인 가능한가요?", "Xin chào, hôm nay check-in được không?")).toBe(true);
    expect(urlsPreserved("가격은 1,700,000 동입니다", "Giá là 1,700,000 VND")).toBe(true);
    expect(urlsPreserved("", "")).toBe(true);
  });

  it("URL 뒤 문장부호는 관대하게 제외하고 매칭 (마침표·괄호)", () => {
    // 원문은 URL 뒤에 마침표, 출력은 마침표 없이 → 여전히 보존으로 인정
    const src = "여기 링크입니다: https://villa-go.net/g/tok12345.";
    const out = "Đây là link: https://villa-go.net/g/tok12345";
    expect(urlsPreserved(src, out)).toBe(true);

    const src2 = "(https://villa-go.net/g/tok12345)";
    const out2 = "링크: https://villa-go.net/g/tok12345 를 열어주세요";
    expect(urlsPreserved(src2, out2)).toBe(true);
  });

  it("www. 로 시작하는 링크도 추적한다", () => {
    const src = "www.villa-go.net/g/abc123 를 확인";
    expect(urlsPreserved(src, "Xem www.villa-go.net/g/abc123")).toBe(true);
    expect(urlsPreserved(src, "Xem www.villa-go.net")).toBe(false); // 경로 누락
  });

  it("URL 여러 개면 모두 보존돼야 true", () => {
    const src = "링크1 https://a.net/g/x11111 링크2 https://b.net/p/y22222";
    expect(urlsPreserved(src, "L1 https://a.net/g/x11111 L2 https://b.net/p/y22222")).toBe(true);
    expect(urlsPreserved(src, "L1 https://a.net/g/x11111 L2 없음")).toBe(false); // 두 번째 누락
  });
});
