// buildVendorNotifText 로케일화 테스트 (vendor-followups2 계약 ②)
//   원천공급자는 베트남인·한국인 혼합 — 적재 시점에 수신자 User.locale로 언어 확정.
//   ★ 누수 가드: 어떤 언어에도 판매가(priceKrw/priceVnd)·마진 문자열이 없어야 한다.
import { describe, expect, it } from "vitest";
import { buildVendorNotifText, vendorNotifLocale } from "@/lib/inapp-notification";

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
