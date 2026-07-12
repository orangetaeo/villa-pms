// 소비자 신청 내역 — 티켓 연락처 본사 일원화 (테오)
//   TICKET 주문은 확정 후에도 담당 벤더 이름·전화를 게스트 payload에 넣지 않는다(본사 Villa Go 문의 원칙).
//   비TICKET(마사지 등)은 현행 유지 — 확정(CONFIRMED·벤더 수락) 후 담당자 이름·전화 노출.
//   ★게이트는 순수 함수 guestVendorContactVisible로 추출 — page.tsx 로더가 이 값으로 vendorName/Phone을 마스킹.
import { describe, it, expect } from "vitest";
import { guestVendorContactVisible } from "@/lib/guest-vendor-contact";

describe("게스트 신청 내역 — 티켓 연락처 본사 일원화", () => {
  it("TICKET 확정(CONFIRMED)이어도 연락처 미노출", () => {
    expect(guestVendorContactVisible("CONFIRMED", true, "TICKET")).toBe(false);
  });

  it("TICKET 벤더 수락(vendorAccepted)이어도 연락처 미노출", () => {
    expect(guestVendorContactVisible("REQUESTED", true, "TICKET")).toBe(false);
  });

  it("TICKET 미확정도 미노출(현행 게이트 유지)", () => {
    expect(guestVendorContactVisible("REQUESTED", false, "TICKET")).toBe(false);
  });

  it("비TICKET(마사지) 확정(CONFIRMED)이면 연락처 노출 — 현행 유지", () => {
    expect(guestVendorContactVisible("CONFIRMED", false, "MASSAGE")).toBe(true);
  });

  it("비TICKET(마사지) 벤더 수락이면 연락처 노출 — 현행 유지", () => {
    expect(guestVendorContactVisible("REQUESTED", true, "MASSAGE")).toBe(true);
  });

  it("비TICKET 미확정(REQUESTED·미수락)은 미노출 — 현행 게이트", () => {
    expect(guestVendorContactVisible("REQUESTED", false, "MASSAGE")).toBe(false);
  });

  it("기타 서비스(BBQ 등)도 비TICKET 규칙 동일", () => {
    expect(guestVendorContactVisible("CONFIRMED", false, "BBQ")).toBe(true);
    expect(guestVendorContactVisible("CONFIRMED", true, "TICKET")).toBe(false);
  });
});
