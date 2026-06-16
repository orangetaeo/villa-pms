import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T1.10 공급자 빌라 홈/상세 — REJECTED 가시화(T1.2b 머지 후 보완) i18n 키 ko/vi 동기 검증.
// next-intl은 누락 키에 throw → REJECTED 빌라 렌더 시 깨짐 방지 (LOC 패턴).
// 타입드 JSON 직접 접근 — 키가 없으면 컴파일 에러로도 잡힌다(캐스트 회피, tsc 클린).

describe("i18n 키 — myVillas (a6, REJECTED 보완)", () => {
  it("ko/vi myVillas.editResubmit 보유", () => {
    expect(ko.myVillas.editResubmit.length).toBeGreaterThan(0);
    expect(vi.myVillas.editResubmit.length).toBeGreaterThan(0);
  });
  it("ko/vi myVillas.status.rejected 보유 (홈·상세 배지 공용)", () => {
    expect(ko.myVillas.status.rejected.length).toBeGreaterThan(0);
    expect(vi.myVillas.status.rejected.length).toBeGreaterThan(0);
  });
  it("status 5종 키 ko/vi 동일 집합", () => {
    expect(Object.keys(ko.myVillas.status).sort()).toEqual(Object.keys(vi.myVillas.status).sort());
  });
});

describe("i18n 키 — villaDetail (a10, 반려 사유 카드)", () => {
  it("ko/vi villaDetail.rejectionTitle 보유", () => {
    expect(ko.villaDetail.rejectionTitle.length).toBeGreaterThan(0);
    expect(vi.villaDetail.rejectionTitle.length).toBeGreaterThan(0);
  });
  it("ko/vi villaDetail.editResubmit 보유", () => {
    expect(ko.villaDetail.editResubmit.length).toBeGreaterThan(0);
    expect(vi.villaDetail.editResubmit.length).toBeGreaterThan(0);
  });
});
