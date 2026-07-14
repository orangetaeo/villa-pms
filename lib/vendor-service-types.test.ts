// 업체 취급 서비스타입(카테고리) 파생 판정 단위 테스트 (service-order-vendor-change-expansion §7)
//   파생 규칙: 활성 카탈로그 품목 type ∪ 지역 커버리지 serviceType ∪ 빌라 지정 serviceType.
//   신호 0(세 관계 모두 비어 있음)이면 어느 타입도 취급하지 않음.
import { describe, it, expect, vi } from "vitest";
import {
  vendorServiceTypes,
  vendorHandlesType,
  loadVendorHandlesType,
} from "@/lib/vendor-service-types";

describe("vendorServiceTypes — 3원천 합집합", () => {
  it("활성 카탈로그 품목 type만 반영(비활성 제외)", () => {
    const set = vendorServiceTypes({
      catalogItems: [
        { type: "FOOD", active: true },
        { type: "BBQ", active: false }, // 비활성 → 제외
      ],
      regionCoverage: [],
      villaAssignments: [],
    });
    expect(set.has("FOOD")).toBe(true);
    expect(set.has("BBQ")).toBe(false);
  });

  it("지역 커버리지 serviceType 반영", () => {
    const set = vendorServiceTypes({
      catalogItems: [],
      regionCoverage: [{ serviceType: "MASSAGE" }],
      villaAssignments: [],
    });
    expect(set.has("MASSAGE")).toBe(true);
  });

  it("빌라 지정 serviceType 반영", () => {
    const set = vendorServiceTypes({
      catalogItems: [],
      regionCoverage: [],
      villaAssignments: [{ serviceType: "BARBER" }],
    });
    expect(set.has("BARBER")).toBe(true);
  });

  it("세 원천 합집합(중복 제거)", () => {
    const set = vendorServiceTypes({
      catalogItems: [{ type: "FOOD", active: true }],
      regionCoverage: [{ serviceType: "MASSAGE" }],
      villaAssignments: [{ serviceType: "FOOD" }], // FOOD 중복
    });
    expect([...set].sort()).toEqual(["FOOD", "MASSAGE"]);
  });

  it("신호 0(세 관계 비어 있음) → 빈 Set", () => {
    expect(vendorServiceTypes({ catalogItems: [], regionCoverage: [], villaAssignments: [] }).size).toBe(0);
  });

  it("undefined/null 관계도 방어적으로 빈 Set", () => {
    expect(vendorServiceTypes({}).size).toBe(0);
    expect(
      vendorServiceTypes({ catalogItems: null, regionCoverage: null, villaAssignments: null }).size
    ).toBe(0);
  });
});

describe("vendorHandlesType", () => {
  const rel = {
    catalogItems: [{ type: "FOOD", active: true }],
    regionCoverage: [{ serviceType: "MASSAGE" }],
    villaAssignments: [],
  };
  it("취급 타입이면 true", () => {
    expect(vendorHandlesType(rel, "FOOD")).toBe(true);
    expect(vendorHandlesType(rel, "MASSAGE")).toBe(true);
  });
  it("미취급 타입이면 false", () => {
    expect(vendorHandlesType(rel, "TICKET")).toBe(false);
  });
  it("미분류(신호 0)면 false", () => {
    expect(
      vendorHandlesType({ catalogItems: [], regionCoverage: [], villaAssignments: [] }, "FOOD")
    ).toBe(false);
  });
});

describe("loadVendorHandlesType — 조회 래퍼", () => {
  it("존재+취급 → true", async () => {
    const db = {
      serviceVendor: {
        findUnique: vi.fn(async () => ({
          catalogItems: [{ type: "FOOD", active: true }],
          regionCoverage: [],
          villaAssignments: [],
        })),
      },
    };
    await expect(loadVendorHandlesType("v1", "FOOD", db)).resolves.toBe(true);
  });

  it("미존재 벤더 → false", async () => {
    const db = { serviceVendor: { findUnique: vi.fn(async () => null) } };
    await expect(loadVendorHandlesType("v-missing", "FOOD", db)).resolves.toBe(false);
  });

  it("존재하지만 미취급 → false", async () => {
    const db = {
      serviceVendor: {
        findUnique: vi.fn(async () => ({
          catalogItems: [{ type: "BBQ", active: true }],
          regionCoverage: [],
          villaAssignments: [],
        })),
      },
    };
    await expect(loadVendorHandlesType("v1", "FOOD", db)).resolves.toBe(false);
  });
});
