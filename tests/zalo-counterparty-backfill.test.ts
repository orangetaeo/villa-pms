// ADR-0009 S0 — 백필/분류 로직 (inferCounterpartyType / defaultTranslateMode)
import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import {
  allowedShareKinds,
  currencyForType,
  defaultTranslateMode,
  inferCounterpartyType,
  isCostSideType,
  isSellSideType,
} from "@/lib/zalo-counterparty";

describe("inferCounterpartyType — 기존 대화 상대타입 백필 (D1.5)", () => {
  it("userId 매칭됨 → SUPPLIER", () => {
    expect(inferCounterpartyType(true)).toBe("SUPPLIER");
  });
  it("userId 없음(미매칭) → UNKNOWN (공유 잠금 — 보수적)", () => {
    expect(inferCounterpartyType(false)).toBe("UNKNOWN");
  });
});

describe("defaultTranslateMode — 상대타입 → 기본 번역모드 (D7.3)", () => {
  it("SUPPLIER → VI (베트남인 전제)", () => {
    expect(defaultTranslateMode("SUPPLIER")).toBe("VI");
  });
  it("CUSTOMER → OFF (오버트랜슬레이션 방지)", () => {
    expect(defaultTranslateMode("CUSTOMER")).toBe("OFF");
  });
  it("UNKNOWN → OFF", () => {
    expect(defaultTranslateMode("UNKNOWN")).toBe("OFF");
  });
});

// ── ADR-0009 개정2(R2) — 누수 그룹·통화 헬퍼 ──

describe("isCostSideType — 원가측 그룹 (R2-2)", () => {
  it("SUPPLIER → true", () => {
    expect(isCostSideType("SUPPLIER")).toBe(true);
  });
  it("CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY/UNKNOWN → false", () => {
    expect(isCostSideType("CUSTOMER")).toBe(false);
    expect(isCostSideType("TRAVEL_AGENCY")).toBe(false);
    expect(isCostSideType("LAND_AGENCY")).toBe(false);
    expect(isCostSideType("UNKNOWN")).toBe(false);
  });
});

describe("isSellSideType — 판매가측 그룹 (R2-2)", () => {
  it("CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY → true", () => {
    expect(isSellSideType("CUSTOMER")).toBe(true);
    expect(isSellSideType("TRAVEL_AGENCY")).toBe(true);
    expect(isSellSideType("LAND_AGENCY")).toBe(true);
  });
  it("SUPPLIER/UNKNOWN → false", () => {
    expect(isSellSideType("SUPPLIER")).toBe(false);
    expect(isSellSideType("UNKNOWN")).toBe(false);
  });
});

describe("currencyForType — 분류별 빌라 공유 통화 (R2-3)", () => {
  it("CUSTOMER → KRW", () => {
    expect(currencyForType("CUSTOMER")).toBe(Currency.KRW);
  });
  it("TRAVEL_AGENCY → VND", () => {
    expect(currencyForType("TRAVEL_AGENCY")).toBe(Currency.VND);
  });
  it("LAND_AGENCY → VND", () => {
    expect(currencyForType("LAND_AGENCY")).toBe(Currency.VND);
  });
  it("SUPPLIER/UNKNOWN → throw (통화 개념 없음)", () => {
    expect(() => currencyForType("SUPPLIER")).toThrow();
    expect(() => currencyForType("UNKNOWN")).toThrow();
  });
});

describe("allowedShareKinds — 분류별 첨부 메뉴 가시성 (R2-5)", () => {
  it("원가측(SUPPLIER) → 사진+빌라+정산", () => {
    expect(allowedShareKinds("SUPPLIER")).toEqual(["PHOTO", "VILLA", "SETTLEMENT"]);
  });
  it("판매가측(CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY) → 사진+빌라+제안", () => {
    const sell = ["PHOTO", "VILLA", "PROPOSAL"];
    expect(allowedShareKinds("CUSTOMER")).toEqual(sell);
    expect(allowedShareKinds("TRAVEL_AGENCY")).toEqual(sell);
    expect(allowedShareKinds("LAND_AGENCY")).toEqual(sell);
  });
  it("UNKNOWN → 사진만", () => {
    expect(allowedShareKinds("UNKNOWN")).toEqual(["PHOTO"]);
  });
  it("어떤 분류도 SETTLEMENT와 PROPOSAL를 동시 허용하지 않음(원가/판매 분리)", () => {
    for (const t of ["SUPPLIER", "CUSTOMER", "TRAVEL_AGENCY", "LAND_AGENCY", "UNKNOWN"] as const) {
      const kinds = allowedShareKinds(t);
      expect(kinds.includes("SETTLEMENT") && kinds.includes("PROPOSAL")).toBe(false);
    }
  });
});
