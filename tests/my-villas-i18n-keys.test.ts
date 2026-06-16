import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T1.10 공급자 빌라 홈/상세 — REJECTED 가시화(T1.2b 머지 후 보완) i18n 키 ko/vi 동기 검증.
// next-intl은 누락 키에 throw → REJECTED 빌라 렌더 시 깨짐 방지 (LOC 패턴).

describe("i18n 키 — myVillas (a6, REJECTED 보완)", () => {
  it("ko/vi myVillas.editResubmit 보유", () => {
    expect((ko.myVillas as Record<string, string>).editResubmit?.length).toBeGreaterThan(0);
    expect((vi.myVillas as Record<string, string>).editResubmit?.length).toBeGreaterThan(0);
  });
  it("ko/vi myVillas.status.rejected 보유 (홈·상세 배지 공용)", () => {
    expect((ko.myVillas.status as Record<string, string>).rejected?.length).toBeGreaterThan(0);
    expect((vi.myVillas.status as Record<string, string>).rejected?.length).toBeGreaterThan(0);
  });
  it("status 5종 키 ko/vi 동일 집합", () => {
    expect(Object.keys(ko.myVillas.status).sort()).toEqual(Object.keys(vi.myVillas.status).sort());
  });
});

describe("i18n 키 — villaDetail (a10, 반려 사유 카드)", () => {
  it.each(["rejectionTitle", "editResubmit"] as const)("ko/vi villaDetail.%s 보유", (key) => {
    expect((ko.villaDetail as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    expect((vi.villaDetail as Record<string, string>)[key]?.length).toBeGreaterThan(0);
  });
});
