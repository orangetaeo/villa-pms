// 발권/예약 현황 접힘 요약 — 이용자 표시 조립(summarizeGuests) 순수 함수 테스트.
//   guests 여권 명단 첫 명 + 외 N, 없으면 customerName 폴백, 그것도 없으면 null(미지정).
//   ★이름만 조립(다른 PII 누수 없음) — 접힘 요약 경계 유지.
import { describe, it, expect } from "vitest";
import { summarizeGuests } from "@/lib/vendor-order";

describe("summarizeGuests — 접힘 요약 이용자 표시", () => {
  it("guests 첫 명 + 나머지 인원수(외 N)를 반환한다", () => {
    expect(
      summarizeGuests([{ name: "Nguyễn Văn A" }, { name: "B" }, { name: "C" }], null)
    ).toEqual({ name: "Nguyễn Văn A", moreCount: 2 });
  });

  it("guests 1명이면 moreCount=0", () => {
    expect(summarizeGuests([{ name: "A" }], null)).toEqual({ name: "A", moreCount: 0 });
  });

  it("첫 항목 이름이 비어도 이름 있는 첫 명을 고르고 moreCount는 전체 크기 기준", () => {
    expect(
      summarizeGuests([{ name: null }, { name: "  " }, { name: "Real" }], null)
    ).toEqual({ name: "Real", moreCount: 2 });
  });

  it("이름 있는 guest가 없으면 customerName으로 폴백(moreCount=0)", () => {
    expect(summarizeGuests([{ name: null }], "대표자")).toEqual({ name: "대표자", moreCount: 0 });
    expect(summarizeGuests(undefined, "대표자")).toEqual({ name: "대표자", moreCount: 0 });
  });

  it("guests도 customerName도 없으면 null(이용자 미지정)", () => {
    expect(summarizeGuests(undefined, null)).toBeNull();
    expect(summarizeGuests([], "")).toBeNull();
    expect(summarizeGuests([{ name: "  " }], "   ")).toBeNull();
  });

  it("이름 앞뒤 공백은 trim된다", () => {
    expect(summarizeGuests([{ name: "  A  " }], null)).toEqual({ name: "A", moreCount: 0 });
  });
});
