import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// 매출관리 /sales(IDEAS 2026-06-24) i18n 키 ko/vi 동기 검증.
// /sales는 매출 탭 콘텐츠를 adminStatistics(OverviewTab/VillasTab)로 재사용하고,
// 페이지 헤더·빌라 섹션만 adminSales 네임스페이스를 쓴다. next-intl은 누락 키에 throw →
// 키 부재 시 화면 깨짐 방지. 타입드 JSON 직접 접근 — 키 없으면 tsc 컴파일 에러로도 잡힘.

describe("i18n 키 — 매출관리(/sales)", () => {
  it("nav.sales(사이드바·모바일 중앙 라벨) ko/vi 보유", () => {
    expect(ko.nav.sales.length).toBeGreaterThan(0);
    expect(vi.nav.sales.length).toBeGreaterThan(0);
  });

  it("pageTitles.sales(메타데이터) ko/vi 보유", () => {
    expect(ko.pageTitles.sales.length).toBeGreaterThan(0);
    expect(vi.pageTitles.sales.length).toBeGreaterThan(0);
  });

  it("adminSales 헤더(title·subtitle) ko/vi 보유", () => {
    expect(ko.adminSales.title.length).toBeGreaterThan(0);
    expect(vi.adminSales.title.length).toBeGreaterThan(0);
    expect(ko.adminSales.subtitle.length).toBeGreaterThan(0);
    expect(vi.adminSales.subtitle.length).toBeGreaterThan(0);
  });

  it("adminSales.villaSection(빌라별 매출 섹션) ko/vi 보유", () => {
    expect(ko.adminSales.villaSection.title.length).toBeGreaterThan(0);
    expect(vi.adminSales.villaSection.title.length).toBeGreaterThan(0);
    expect(ko.adminSales.villaSection.subtitle.length).toBeGreaterThan(0);
    expect(vi.adminSales.villaSection.subtitle.length).toBeGreaterThan(0);
  });

  it("adminSales 키 집합 ko/vi 동일", () => {
    expect(Object.keys(ko.adminSales).sort()).toEqual(Object.keys(vi.adminSales).sort());
    expect(Object.keys(ko.adminSales.villaSection).sort()).toEqual(
      Object.keys(vi.adminSales.villaSection).sort()
    );
  });
});
