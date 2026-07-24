import { describe, expect, it } from "vitest";
import { buildWebchatVillaCaption } from "./webchat-villa-share";

const base = {
  displayName: "쏘나씨 3베드 풀빌라",
  bedrooms: 3,
  bathrooms: 2,
  maxGuests: 6,
  hasPool: true,
  breakfastAvailable: true,
};

describe("buildWebchatVillaCaption — 웹챗 빌라 공유 캡션", () => {
  it("간단정보 + 소비자 VND 대표가(₫ ~ / 박) 포함", () => {
    const out = buildWebchatVillaCaption(base, { krw: null, vnd: 12_100_000n });
    expect(out).toContain("🏠 쏘나씨 3베드 풀빌라");
    expect(out).toContain("침실 3 · 욕실 2 · 최대 6인");
    expect(out).toContain("수영장 · 조식 가능");
    expect(out).toContain("12,100,000₫ ~ / 박");
  });

  it("★URL은 절대 캡션에 포함하지 않는다(payload 전용 — 번역 훼손 회피)", () => {
    const out = buildWebchatVillaCaption(base, { krw: null, vnd: 12_100_000n });
    expect(out).not.toMatch(/https?:\/\//);
    expect(out.toLowerCase()).not.toContain("/blog/");
  });

  it("대표가 없으면(vnd null) 가격 줄 생략, 크래시 없음", () => {
    const out = buildWebchatVillaCaption(base, null);
    expect(out).toContain("🏠 쏘나씨 3베드 풀빌라");
    expect(out).not.toContain("/ 박");
    const out2 = buildWebchatVillaCaption(base, { krw: 90_000, vnd: null });
    expect(out2).not.toContain("/ 박"); // 웹챗은 VND만 — krw 값은 무시
  });

  it("특징 없으면(수영장·조식 X) 해당 줄 생략", () => {
    const out = buildWebchatVillaCaption(
      { ...base, hasPool: false, breakfastAvailable: false },
      { krw: null, vnd: 5_000_000n }
    );
    expect(out).not.toContain("수영장");
    expect(out).not.toContain("조식");
    expect(out).toContain("5,000,000₫ ~ / 박");
  });
});
