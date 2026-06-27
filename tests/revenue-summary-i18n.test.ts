import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// 매출관리 /revenue 상단 요약(KPI 카드 + 유형별 매출 구성 바) i18n 키 ko/vi 동기 검증
// + (admin) 레이아웃 화이트리스트에 "revenue" 네임스페이스 존재 회귀 가드.
//
// 배경: PR #74가 /revenue 페이지·메시지는 넣었으나 ADMIN_CLIENT_NAMESPACES에 "revenue"를
// 빠뜨려 revenue-client(useTranslations("revenue")) 라벨이 raw 키로 깨지던 버그를 2026-06-27 수정.
// 이 테스트가 재발(누락)을 막는다.

describe("i18n 키 — 매출관리 요약(revenue.summary)", () => {
  it("revenue.summary 8키 ko/vi 보유 + 동일 집합", () => {
    const need = [
      "saleKrw",
      "saleVnd",
      "marginVnd",
      "marginNote",
      "count",
      "countUnit",
      "breakdownTitle",
      "breakdownNote",
    ];
    for (const k of need) {
      expect((ko.revenue.summary as Record<string, string>)[k]?.length).toBeGreaterThan(0);
      expect((vi.revenue.summary as Record<string, string>)[k]?.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ko.revenue.summary).sort()).toEqual(Object.keys(vi.revenue.summary).sort());
  });
});

describe("회귀 가드 — (admin) 레이아웃 클라이언트 화이트리스트", () => {
  it('revenue-client가 쓰는 "revenue" 네임스페이스가 ADMIN_CLIENT_NAMESPACES에 있다', () => {
    const layout = readFileSync("app/(admin)/layout.tsx", "utf8");
    const block = layout.match(/ADMIN_CLIENT_NAMESPACES = \[([\s\S]*?)\] as const/);
    expect(block, "ADMIN_CLIENT_NAMESPACES 배열을 찾지 못함").toBeTruthy();
    // 누락 시 클라이언트 라벨이 raw 키로 깨짐(이 PR이 고친 버그).
    expect(block![1]).toContain('"revenue"');
  });
});
