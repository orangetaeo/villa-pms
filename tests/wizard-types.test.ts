import { describe, expect, it } from "vitest";
import {
  villaToWizardState,
  photoSlotId,
  type VillaForEdit,
} from "@/app/(supplier)/my-villas/new/wizard-types";

const BASE: VillaForEdit = {
  name: "쏘나씨 V12",
  complex: "쏘나씨",
  address: "Lô SV-01",
  bedrooms: 2,
  bathrooms: 1,
  maxGuests: 4,
  hasPool: true,
  breakfastAvailable: false,
  monthlyRentVnd: "30000000",
  rules: {
    checkInTime: 900,
    checkOutTime: 660,
    smokingAllowed: false,
    petsAllowed: true,
    partyAllowed: false,
    parkingSlots: 2,
    baseDepositVnd: "5000000",
    extraBedAvailable: true,
  },
  photos: [],
  amenities: [],
  rates: [
    { season: "LOW", supplierCostVnd: "1500000" },
    { season: "HIGH", supplierCostVnd: "2500000" },
    { season: "PEAK", supplierCostVnd: "4000000" },
  ],
};

describe("photoSlotId — space+spaceLabel 역매핑 (QA 조건 4)", () => {
  const slots = new Set([
    "exterior", "living", "kitchen", "bedroom-1", "bedroom-2", "bathroom-1", "balcony", "pool",
  ]);

  it("고정 공간은 소문자 슬롯 id", () => {
    expect(photoSlotId("EXTERIOR", null, slots)).toBe("exterior");
    expect(photoSlotId("LIVING", null, slots)).toBe("living");
    expect(photoSlotId("KITCHEN", null, slots)).toBe("kitchen");
    expect(photoSlotId("BALCONY", null, slots)).toBe("balcony");
    expect(photoSlotId("POOL", null, slots)).toBe("pool");
  });

  it("침실·욕실은 spaceLabel로 번호 슬롯", () => {
    expect(photoSlotId("BEDROOM", "1", slots)).toBe("bedroom-1");
    expect(photoSlotId("BEDROOM", "2", slots)).toBe("bedroom-2");
    expect(photoSlotId("BATHROOM", "1", slots)).toBe("bathroom-1");
  });

  it("현재 슬롯 집합에 없는 사진은 drop(null) — 초과 침실·ETC", () => {
    expect(photoSlotId("BEDROOM", "3", slots)).toBeNull(); // 슬롯 없음 (침실 2개로 축소)
    expect(photoSlotId("ETC", null, slots)).toBeNull();
    expect(photoSlotId("BEDROOM", null, slots)).toBeNull(); // 라벨 없는 침실
    expect(photoSlotId("POOL", null, new Set(["exterior"]))).toBeNull(); // 수영장 없는 빌라
  });
});

describe("villaToWizardState — 재제출 prefill", () => {
  it("기본 정보·원가·비품 키 변환", () => {
    const state = villaToWizardState({
      ...BASE,
      amenities: [
        { category: "KITCHEN", itemKey: "kettle", quantity: 1 },
        { category: "MINIBAR", itemKey: "water", quantity: 6 },
      ],
    });
    expect(state.name).toBe("쏘나씨 V12");
    expect(state.complex).toBe("쏘나씨");
    expect(state.bedrooms).toBe(2);
    expect(state.hasPool).toBe(true);
    expect(state.monthlyRent).toBe("30000000");
    expect(state.rates).toEqual({ LOW: "1500000", HIGH: "2500000", PEAK: "4000000" });
    expect(state.amenities).toEqual({ "KITCHEN:kettle": 1, "MINIBAR:water": 6 });
    // 이용 규칙 prefill — 재제출 시 기존값 그대로 전달
    expect(state.rules).toEqual({
      checkInTime: 900,
      checkOutTime: 660,
      smokingAllowed: false,
      petsAllowed: true,
      partyAllowed: false,
      parkingSlots: 2,
      baseDepositVnd: "5000000",
      extraBedAvailable: true,
    });
  });

  it("null 필드는 빈 문자열로 (complex·address·monthlyRent)", () => {
    const state = villaToWizardState({
      ...BASE,
      complex: null,
      address: null,
      monthlyRentVnd: null,
    });
    expect(state.complex).toBe("");
    expect(state.address).toBe("");
    expect(state.monthlyRent).toBe("");
  });

  it("사진 슬롯 매핑 — done 상태 + url", () => {
    const state = villaToWizardState({
      ...BASE,
      photos: [
        { space: "EXTERIOR", spaceLabel: null, url: "/uploads/ext.jpg" },
        { space: "BEDROOM", spaceLabel: "1", url: "/uploads/bd1.jpg" },
        { space: "BEDROOM", spaceLabel: "2", url: "/uploads/bd2.jpg" },
        { space: "POOL", spaceLabel: null, url: "https://r2.dev/pool.jpg" },
      ],
    });
    expect(state.photos["exterior"]).toEqual({ status: "done", url: "/uploads/ext.jpg" });
    expect(state.photos["bedroom-1"]).toEqual({ status: "done", url: "/uploads/bd1.jpg" });
    expect(state.photos["bedroom-2"]).toEqual({ status: "done", url: "/uploads/bd2.jpg" });
    expect(state.photos["pool"]).toEqual({ status: "done", url: "https://r2.dev/pool.jpg" });
  });

  it("슬롯에 없는 사진(초과 침실·ETC)은 drop — 무손실 아님, 의도된 동작", () => {
    const state = villaToWizardState({
      ...BASE,
      bedrooms: 2,
      photos: [
        { space: "BEDROOM", spaceLabel: "1", url: "/uploads/bd1.jpg" },
        { space: "BEDROOM", spaceLabel: "3", url: "/uploads/bd3.jpg" }, // drop
        { space: "ETC", spaceLabel: null, url: "/uploads/etc.jpg" }, // drop
      ],
    });
    expect(state.photos["bedroom-1"]).toBeDefined();
    expect(state.photos["bedroom-3"]).toBeUndefined();
    expect(Object.keys(state.photos)).toEqual(["bedroom-1"]);
  });

  it("rate 누락 시즌은 빈 문자열", () => {
    const state = villaToWizardState({
      ...BASE,
      rates: [{ season: "LOW", supplierCostVnd: "1000000" }],
    });
    expect(state.rates).toEqual({ LOW: "1000000", HIGH: "", PEAK: "" });
  });
});
