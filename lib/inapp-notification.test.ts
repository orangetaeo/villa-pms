// buildVendorNotifText 로케일화 테스트 (vendor-followups2 계약 ②)
//   원천공급자는 베트남인·한국인 혼합 — 적재 시점에 수신자 User.locale로 언어 확정.
//   ★ 누수 가드: 어떤 언어에도 판매가(priceKrw/priceVnd)·마진 문자열이 없어야 한다.
import { describe, expect, it } from "vitest";
import {
  buildAdminNotifText,
  buildVendorNotifText,
  vendorNotifLocale,
  type AdminNotifKind,
} from "@/lib/inapp-notification";

describe("vendorNotifLocale — 수신자 locale 정규화", () => {
  it("ko만 ko, 나머지는 vi 기본", () => {
    expect(vendorNotifLocale("ko")).toBe("ko");
    expect(vendorNotifLocale("vi")).toBe("vi");
    expect(vendorNotifLocale(null)).toBe("vi");
    expect(vendorNotifLocale(undefined)).toBe("vi");
    expect(vendorNotifLocale("en")).toBe("vi");
  });
});

describe("buildVendorNotifText — ko/vi 분기", () => {
  const payload = { itemName: "마사지", quantity: 2, villaName: "쏘나씨 V11", serviceDate: "2026-07-10" };

  it("기본(미지정)=vi — 기존 동작 보존", () => {
    const { title, body } = buildVendorNotifText("VENDOR_PO", payload);
    expect(title).toBe("Yêu cầu đặt dịch vụ mới");
    expect(body).toContain("마사지 ×2 · 쏘나씨 V11 · 2026-07-10");
  });

  it("ko 수신자는 ko 제목", () => {
    expect(buildVendorNotifText("VENDOR_PO", payload, "ko").title).toBe("새 발주 요청");
    expect(buildVendorNotifText("VENDOR_PO_CANCELLED", payload, "ko").title).toBe(
      "발주가 취소되었습니다"
    );
    expect(buildVendorNotifText("VENDOR_SETTLED", payload, "ko").title).toBe("정산 완료");
  });

  it("제안 결과 — 적용은 확정 일정(날짜+시각) 표기, 무시는 기존 일정", () => {
    const applied = buildVendorNotifText(
      "VENDOR_PROPOSAL_APPLIED",
      { ...payload, serviceTime: "14:00" },
      "ko"
    );
    expect(applied.title).toBe("시간 제안이 수락되었습니다");
    expect(applied.body).toContain("2026-07-10 14:00");

    const dismissed = buildVendorNotifText("VENDOR_PROPOSAL_DISMISSED", payload, "vi");
    expect(dismissed.title).toContain("không được áp dụng");
  });

  it("정산 완료 — 본인 지급액(costVnd) 점 구분 표기", () => {
    const { body } = buildVendorNotifText(
      "VENDOR_SETTLED",
      { ...payload, costVnd: "1500000" },
      "ko"
    );
    expect(body).toContain("1.500.000₫");
  });

  it("누수 가드 — 판매가·마진 키워드 없음(양 언어)", () => {
    for (const loc of ["ko", "vi"] as const) {
      for (const type of [
        "VENDOR_PO",
        "VENDOR_PO_CANCELLED",
        "VENDOR_SETTLED",
        "VENDOR_PROPOSAL_APPLIED",
        "VENDOR_PROPOSAL_DISMISSED",
        "UNKNOWN_TYPE",
      ]) {
        const { title, body } = buildVendorNotifText(type, { ...payload, costVnd: "1000" }, loc);
        expect(`${title}${body}`).not.toMatch(/priceKrw|priceVnd|margin|마진|판매가/i);
      }
    }
  });
});

// ── buildAdminNotifText — 운영자(ko 고정) 벤더 이벤트 알림 (admin-vendor-ops C) ─────────
describe("buildAdminNotifText — 운영자 인앱 알림 문구", () => {
  const payload = {
    vendorName: "에이스 마사지",
    itemName: "타이 마사지",
    villaName: "쏘나씨 V11",
  };
  const ALL_KINDS: AdminNotifKind[] = [
    "VENDOR_ACCEPTED",
    "VENDOR_REJECTED",
    "VENDOR_PROPOSED",
    "VENDOR_COMPLETED",
    "VENDOR_SIGNUP",
  ];

  it("kind별 ko 제목", () => {
    expect(buildAdminNotifText("VENDOR_ACCEPTED", payload).title).toBe("공급자 수락");
    expect(buildAdminNotifText("VENDOR_REJECTED", payload).title).toBe("공급자 거절");
    expect(buildAdminNotifText("VENDOR_PROPOSED", payload).title).toBe("공급자 시간 제안");
    expect(buildAdminNotifText("VENDOR_COMPLETED", payload).title).toBe("공급자 서비스 완료");
    expect(buildAdminNotifText("VENDOR_SIGNUP", payload).title).toBe(
      "공급자 가입 승인 대기"
    );
  });

  it('body 헤드 = "업체 — 품목 (빌라)"', () => {
    const { body } = buildAdminNotifText("VENDOR_ACCEPTED", payload);
    expect(body).toContain("에이스 마사지 — 타이 마사지 (쏘나씨 V11)");
  });

  it("제안(VENDOR_PROPOSED)은 제안 일정 줄 추가", () => {
    const { body } = buildAdminNotifText("VENDOR_PROPOSED", {
      ...payload,
      proposedServiceDate: "2026-07-10",
      proposedServiceTime: "14:00",
    });
    expect(body).toContain("제안 일정: 2026-07-10 14:00");
  });

  it("거절(VENDOR_REJECTED)은 사유 한 줄 추가 — 다른 kind엔 미표기", () => {
    const rejected = buildAdminNotifText("VENDOR_REJECTED", {
      ...payload,
      rejectReason: "당일 예약 마감",
    });
    expect(rejected.body).toContain("사유: 당일 예약 마감");
    // 제안 일정·사유는 해당 kind에서만 — 수락엔 붙지 않음
    const accepted = buildAdminNotifText("VENDOR_ACCEPTED", {
      ...payload,
      rejectReason: "당일 예약 마감",
      proposedServiceDate: "2026-07-10",
    });
    expect(accepted.body).not.toContain("사유:");
    expect(accepted.body).not.toContain("제안 일정:");
  });

  it("가입 대기(VENDOR_SIGNUP)는 발주 컨텍스트 없이 업체명만", () => {
    const { body } = buildAdminNotifText("VENDOR_SIGNUP", { vendorName: "새 업체" });
    expect(body).toBe("새 업체");
  });

  it("누수 가드 — 금액(₫·원·판매가·마진·costVnd) 절대 미포함(전 kind)", () => {
    for (const kind of ALL_KINDS) {
      const { title, body } = buildAdminNotifText(kind, {
        ...payload,
        proposedServiceDate: "2026-07-10",
        proposedServiceTime: "14:00",
        rejectReason: "사정상 불가",
      });
      const text = `${title}\n${body}`;
      expect(text).not.toMatch(/₫|VND|KRW|원|priceKrw|priceVnd|costVnd|margin|마진|판매가|지급액/i);
    }
  });
});
