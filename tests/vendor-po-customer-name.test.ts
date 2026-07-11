// VENDOR_PO 발주 문구 — 이용자 이름 줄(있음/없음) 하위호환 테스트 (service-order-customer-name)
//   - customerName 있으면 "Khách: {이름}" 줄 포함
//   - customerName 없으면(구 payload) 줄 생략 — 하위호환
//   - 판매가·마진 누수 없음(이름만)
import { describe, it, expect, vi } from "vitest";

// buildNotificationText는 순수 함수 — prisma 미사용이나, 모듈 최상위 import 안전화를 위해 mock.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildNotificationText } from "@/lib/zalo";
import { NotificationType } from "@prisma/client";

const basePayload = {
  itemName: "마사지",
  quantity: 2,
  villaName: "Villa A",
  serviceDate: "2026-08-01",
  serviceTime: "14:00",
  optionLabels: ["90분"],
  costVnd: null,
  guestNote: null,
};

describe("VENDOR_PO 이용자 이름 줄", () => {
  it("customerName 있으면 'Khách: {이름}' 줄 포함", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PO, {
      ...basePayload,
      customerName: "김철수",
    });
    expect(text).toContain("Khách: 김철수");
  });

  it("customerName 없으면(구 payload) 이용자 줄 생략 — 하위호환", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PO, basePayload);
    expect(text).not.toContain("Khách:");
    // 기본 발주 문구는 정상 생성
    expect(text).toContain("마사지");
  });

  it("customerName이 공백뿐이면 줄 생략", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PO, {
      ...basePayload,
      customerName: "   ",
    });
    expect(text).not.toContain("Khách:");
  });
});
