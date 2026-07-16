import { describe, it, expect } from "vitest";
import {
  renderBusinessContract,
  contentHash,
  parseTerms,
  contractTypeForRole,
  isLocaleAllowed,
  isCounterpartRole,
  CONTRACT_SLUG,
  type RenderContractData,
} from "@/lib/business-contract";

// 서명용 정본을 흉내낸 fixture (실제 파일 fs 의존 배제 — 순수 렌더 검증).
const VILLA_FIXTURE = [
  "# 빌라 공급 계약",
  "갑: {{companyName}} (여권 {{companyPassport}})",
  "을: {{counterpartName}} / 연락처 {{counterpartZalo}}",
  "신분번호 {{counterpartIdNumber}} / 주소 {{counterpartAddress}}",
  "무료취소 {{cancelFreeDays}}일 · 부분환불 {{cancelPartialPct}}%",
  "결제수단 {{payMethod}} / 계좌 {{bankInfo}}",
  "특약: {{specialTerms}}",
  "서명일 {{signDate}}",
  "<!-- signature-area -->",
].join("\n");

const baseData = (over: Partial<RenderContractData> = {}): RenderContractData => ({
  type: "VILLA_SUPPLY",
  locale: "ko",
  counterpartName: "Nguyen Van A",
  counterpartZalo: "0900000000",
  terms: {
    companyName: "빌라고",
    companyPassport: "M1234",
    cancelFreeDays: 14,
    cancelPartialPct: 50,
    payMethod: "CASH",
  },
  ...over,
});

describe("renderBusinessContract", () => {
  it("모든 토큰을 치환하고 미치환 {{ 잔존 없음", () => {
    const out = renderBusinessContract(VILLA_FIXTURE, baseData());
    expect(out).not.toContain("{{");
    expect(out).toContain("빌라고");
    expect(out).toContain("Nguyen Van A");
    expect(out).toContain("14일");
    expect(out).toContain("현금"); // payMethod CASH ko 라벨
  });

  it("signature-area 앵커 주석을 보존한다", () => {
    const out = renderBusinessContract(VILLA_FIXTURE, baseData());
    expect(out).toContain("<!-- signature-area -->");
  });

  it("미서명 시 서명일·신분번호·주소는 공백(____)", () => {
    const out = renderBusinessContract(VILLA_FIXTURE, baseData());
    expect(out).toContain("서명일 ____");
    expect(out).toContain("신분번호 ____");
    expect(out).toContain("주소 ____");
  });

  it("서명 정보가 있으면 렌더된다", () => {
    const out = renderBusinessContract(
      VILLA_FIXTURE,
      baseData({ idNumber: "012345", address: "Phu Quoc", signedAt: new Date("2026-07-16T05:00:00Z") }),
    );
    expect(out).toContain("012345");
    expect(out).toContain("Phu Quoc");
    expect(out).toContain("2026-07-16");
  });

  it("빈 선택 필드는 NA 라벨(해당 없음 / Không áp dụng)로 치환", () => {
    const ko = renderBusinessContract(VILLA_FIXTURE, baseData({ terms: { ...baseData().terms } }));
    expect(ko).toContain("특약: 해당 없음");
    expect(ko).toContain("계좌 해당 없음");
    const vi = renderBusinessContract(
      VILLA_FIXTURE.replace("payMethod", "payMethod"),
      baseData({ locale: "vi" }),
    );
    expect(vi).toContain("Không áp dụng");
    expect(vi).toContain("Tiền mặt"); // CASH vi 라벨
  });

  it("미정 토큰이 있으면 throw (미정 토큰 렌더 금지)", () => {
    expect(() =>
      renderBusinessContract("배당 {{unknownToken}}", baseData()),
    ).toThrow(/UNRESOLVED_CONTRACT_TOKEN/);
  });
});

describe("contentHash", () => {
  it("동일 입력=동일 해시, 변경 시 달라진다", () => {
    const a = renderBusinessContract(VILLA_FIXTURE, baseData());
    const b = renderBusinessContract(VILLA_FIXTURE, baseData());
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).toMatch(/^[0-9a-f]{64}$/);
    const c = renderBusinessContract(VILLA_FIXTURE, baseData({ counterpartName: "다른 사람" }));
    expect(contentHash(c)).not.toBe(contentHash(a));
  });
});

describe("parseTerms (zod .strict — 원가·마진 봉인)", () => {
  it("VILLA_SUPPLY 유효값 통과 + 기본값 채움", () => {
    const r = parseTerms("VILLA_SUPPLY", {
      companyName: "빌라고",
      companyPassport: "M1",
      payMethod: "BANK",
      bankInfo: "VCB 123",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const d = r.data as { cancelFreeDays: number; cancelPartialPct: number };
      expect(d.cancelFreeDays).toBe(14); // default
      expect(d.cancelPartialPct).toBe(50);
    }
  });

  it("★ 원가·마진·판매가 등 미지정 키는 거부(.strict)", () => {
    const r = parseTerms("VILLA_SUPPLY", {
      companyName: "빌라고",
      companyPassport: "M1",
      payMethod: "CASH",
      salePriceKrw: 100000, // 누수 시도
      marginValue: 30,
    });
    expect(r.success).toBe(false);
  });

  it("문자열에 {{ 포함(치환 주입)은 거부", () => {
    const r = parseTerms("VILLA_SUPPLY", {
      companyName: "빌라고 {{signDate}}",
      companyPassport: "M1",
      payMethod: "CASH",
    });
    expect(r.success).toBe(false);
  });

  it("SERVICE_VENDOR settleCycle enum 검증", () => {
    expect(parseTerms("SERVICE_VENDOR", { companyName: "c", companyPassport: "p", settleCycle: "MONTHLY", payMethod: "CASH" }).success).toBe(true);
    expect(parseTerms("SERVICE_VENDOR", { companyName: "c", companyPassport: "p", settleCycle: "YEARLY", payMethod: "CASH" }).success).toBe(false);
  });

  it("PARTNER_AGENCY 필수 필드", () => {
    expect(parseTerms("PARTNER_AGENCY", { companyName: "c", companyPassport: "p", partnerCompany: "여행사", partnerRep: "김", partnerContact: "010" }).success).toBe(true);
    expect(parseTerms("PARTNER_AGENCY", { companyName: "c", companyPassport: "p" }).success).toBe(false);
  });
});

describe("role → type 매핑 / locale 화이트리스트", () => {
  it("SUPPLIER→VILLA_SUPPLY, VENDOR→SERVICE_VENDOR, PARTNER→PARTNER_AGENCY", () => {
    expect(contractTypeForRole("SUPPLIER")).toBe("VILLA_SUPPLY");
    expect(contractTypeForRole("VENDOR")).toBe("SERVICE_VENDOR");
    expect(contractTypeForRole("PARTNER")).toBe("PARTNER_AGENCY");
  });

  it("계약 대상 아닌 role은 null", () => {
    expect(contractTypeForRole("OWNER")).toBeNull();
    expect(contractTypeForRole("STAFF")).toBeNull();
    expect(contractTypeForRole("CLEANER")).toBeNull();
    expect(contractTypeForRole(undefined)).toBeNull();
  });

  it("isCounterpartRole", () => {
    expect(isCounterpartRole("SUPPLIER")).toBe(true);
    expect(isCounterpartRole("PARTNER")).toBe(true);
    expect(isCounterpartRole("OWNER")).toBe(false);
  });

  it("파트너는 ko만 허용(vi 거부)", () => {
    expect(isLocaleAllowed("PARTNER_AGENCY", "ko")).toBe(true);
    expect(isLocaleAllowed("PARTNER_AGENCY", "vi")).toBe(false);
    expect(isLocaleAllowed("VILLA_SUPPLY", "vi")).toBe(true);
  });

  it("slug 화이트리스트가 파일명과 일치", () => {
    expect(CONTRACT_SLUG.VILLA_SUPPLY).toBe("villa-supply");
    expect(CONTRACT_SLUG.SERVICE_VENDOR).toBe("service-vendor");
    expect(CONTRACT_SLUG.PARTNER_AGENCY).toBe("partner-agency");
  });
});
