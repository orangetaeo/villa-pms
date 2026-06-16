import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T4.3 공급자 온보딩 가이드 — i18n 키 존재·ko/vi 동기 검증.
// next-intl은 누락 키에 throw → 양쪽 동등성 보장으로 런타임 깨짐 방지 (LOC 패턴).
const GUIDE_KEYS = [
  "headerTitle",
  "heroTitle",
  "heroSubtitle",
  "step1Title",
  "step1Desc",
  "step2Title",
  "step2Desc",
  "step3Title",
  "step3Desc",
  "step4Title",
  "step4Desc",
  "ctaStart",
  "ctaZalo",
] as const;

describe("i18n 키 — guide (a-guide)", () => {
  it("ko/vi 모두 guide 네임스페이스 보유", () => {
    expect(ko.guide).toBeDefined();
    expect(vi.guide).toBeDefined();
  });
  it.each(GUIDE_KEYS)("키 '%s' 존재 (ko·vi 비어있지 않음)", (key) => {
    expect((ko.guide as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    expect((vi.guide as Record<string, string>)[key]?.length).toBeGreaterThan(0);
  });
});

describe("i18n 키 — tabs.guide (TabBar 진입)", () => {
  it("ko/vi 모두 tabs.guide 보유", () => {
    expect((ko.tabs as Record<string, string>).guide?.length).toBeGreaterThan(0);
    expect((vi.tabs as Record<string, string>).guide?.length).toBeGreaterThan(0);
  });
});
