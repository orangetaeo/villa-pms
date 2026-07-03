// 파트너 알림 텍스트·라우팅 순수함수 테스트 (T-partner-workflow-gaps ①)
import { describe, expect, it } from "vitest";
import {
  buildPartnerNotifText,
  partnerNotifHref,
  partnerNotifyLocale,
  type PartnerNotifyEvent,
} from "./partner-notify";

describe("partnerNotifyLocale", () => {
  it("VN → vi, KR·null·기타 → ko(포털 기본)", () => {
    expect(partnerNotifyLocale("VN")).toBe("vi");
    expect(partnerNotifyLocale("KR")).toBe("ko");
    expect(partnerNotifyLocale(null)).toBe("ko");
    expect(partnerNotifyLocale("US")).toBe("ko");
  });
});

describe("buildPartnerNotifText", () => {
  const confirmed: PartnerNotifyEvent = {
    kind: "BOOKING_CONFIRMED",
    bookingId: "b1",
    villaName: "쏘나씨 V12",
    checkIn: "2026-08-01",
    checkOut: "2026-08-05",
  };

  it("예약확정 ko/vi — 빌라·기간 포함", () => {
    const ko = buildPartnerNotifText("ko", confirmed);
    expect(ko.title).toContain("확정");
    expect(ko.body).toContain("쏘나씨 V12");
    expect(ko.body).toContain("2026-08-01");
    const vi = buildPartnerNotifText("vi", confirmed);
    expect(vi.title).toContain("xác nhận");
  });

  it("청구서발행 — VND 점구분 표기·기한 포함, KRW·마진 없음", () => {
    const t = buildPartnerNotifText("ko", {
      kind: "INVOICE_ISSUED",
      invoiceId: "inv1",
      invoiceNo: "INV-0001",
      dueDate: "2026-07-20",
      totalVnd: "12500000",
    });
    expect(t.body).toContain("12.500.000₫");
    expect(t.body).toContain("2026-07-20");
    expect(t.body).not.toMatch(/KRW|원가|마진/);
  });

  it("연체 — 건수·잔액 합", () => {
    const t = buildPartnerNotifText("ko", {
      kind: "RECEIVABLE_OVERDUE",
      count: 2,
      outstandingVnd: "29232000",
    });
    expect(t.body).toContain("2건");
    expect(t.body).toContain("29.232.000₫");
  });

  it("요청 처리결과 — 승인/거절 분기 + 처리 메모 포함", () => {
    const base = {
      kind: "CHANGE_REQUEST_RESOLVED" as const,
      bookingId: "b1",
      villaName: "쏘나씨 V12",
      requestKind: "CANCEL",
    };
    expect(buildPartnerNotifText("ko", { ...base, approved: true }).title).toContain("처리");
    const rejected = buildPartnerNotifText("ko", {
      ...base,
      approved: false,
      resolutionNote: "성수기라 불가",
    });
    expect(rejected.title).toContain("거절");
    expect(rejected.body).toContain("성수기라 불가");
  });
});

describe("partnerNotifHref", () => {
  it("예약 이벤트 → 예약 상세, 재무 이벤트 → 미수 화면", () => {
    expect(
      partnerNotifHref({
        kind: "HOLD_EXPIRED",
        bookingId: "b9",
        villaName: "v",
        checkIn: "2026-08-01",
        checkOut: "2026-08-02",
      })
    ).toBe("/partner/bookings/b9");
    expect(
      partnerNotifHref({
        kind: "RECEIVABLE_OVERDUE",
        count: 1,
        outstandingVnd: "1",
      })
    ).toBe("/partner/receivables");
  });
});
