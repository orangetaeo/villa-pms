import { describe, expect, it } from "vitest";
import ko from "../messages/ko.json";
import vi from "../messages/vi.json";

// 체크인/아웃 폼 인라인 가이드(T-tutorial-onboarding-9) — 4개 NS의 guide.* ko/vi 패리티 강제.
// (guide-i18n-keys.test.ts는 공급자 온보딩 페이지 guide NS 전용이라 이 키들을 커버하지 않음 — QA 권고)
const GUIDE_NAMESPACES = [
  "adminCheckin",
  "adminCheckout",
  "supplierCheckin",
  "supplierCheckout",
] as const;

type Msgs = Record<string, unknown>;

describe("폼 인라인 가이드 ko/vi 패리티", () => {
  it.each(GUIDE_NAMESPACES)("[%s] guide.* 키 집합이 ko/vi 동일·비어있지 않다", (ns) => {
    const koGuide = ((ko as Msgs)[ns] as Msgs)?.guide as Record<string, string> | undefined;
    const viGuide = ((vi as Msgs)[ns] as Msgs)?.guide as Record<string, string> | undefined;
    expect(koGuide, `${ns}.guide ko 부재`).toBeTruthy();
    expect(viGuide, `${ns}.guide vi 부재`).toBeTruthy();
    expect(Object.keys(koGuide!).sort()).toEqual(Object.keys(viGuide!).sort());
    for (const [key, val] of [...Object.entries(koGuide!), ...Object.entries(viGuide!)]) {
      expect(typeof val, `${ns}.guide.${key} 타입`).toBe("string");
      expect(val.trim().length, `${ns}.guide.${key} 비어있음`).toBeGreaterThan(0);
    }
  });
});
