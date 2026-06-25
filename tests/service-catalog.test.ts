import { describe, it, expect } from "vitest";
import {
  parseCatalogOptions,
  validateCatalogItem,
  resolveOrderPricing,
  ServiceSelectionError,
  type CatalogItemInput,
  type CatalogOptions,
} from "@/lib/service-catalog";

describe("parseCatalogOptions", () => {
  it("잘못된 입력은 빈 옵션", () => {
    expect(parseCatalogOptions(null)).toEqual({});
    expect(parseCatalogOptions("x")).toEqual({});
    expect(parseCatalogOptions({})).toEqual({ variants: [], addons: [], modifiers: [] });
  });
  it("key 없는 항목은 걸러냄", () => {
    const parsed = parseCatalogOptions({ variants: [{ key: "60", labelKo: "60분" }, { labelKo: "noKey" }] });
    expect(parsed.variants).toHaveLength(1);
    expect(parsed.variants?.[0].key).toBe("60");
  });
});

describe("validateCatalogItem", () => {
  const base: CatalogItemInput = { type: "MASSAGE", nameKo: "풋마사지", priceKrw: 350000 };
  it("정상 통과", () => {
    expect(validateCatalogItem(base)).toEqual([]);
    expect(validateCatalogItem({ ...base, priceKrw: null, priceVnd: "600000" })).toEqual([]);
  });
  it("타입·이름·가격 누락", () => {
    expect(validateCatalogItem({ ...base, type: "NOPE" })).toContain("INVALID_TYPE");
    expect(validateCatalogItem({ ...base, nameKo: "  " })).toContain("NAME_REQUIRED");
    expect(validateCatalogItem({ ...base, priceKrw: null })).toContain("NO_PRICE");
  });
  it("가격·원가 형식", () => {
    expect(validateCatalogItem({ ...base, priceKrw: -1 })).toContain("INVALID_PRICE");
    expect(validateCatalogItem({ ...base, priceVnd: "12,000" })).toContain("INVALID_PRICE");
    expect(validateCatalogItem({ ...base, costVnd: "abc" })).toContain("INVALID_COST");
  });
  it("옵션 키 중복 거부", () => {
    const options: CatalogOptions = {
      variants: [
        { key: "60", labelKo: "60분", priceKrw: 400000 },
        { key: "60", labelKo: "중복", priceKrw: 500000 },
      ],
    };
    expect(validateCatalogItem({ ...base, options })).toContain("DUP_OPTION_KEY");
  });
  it("옵션 가격 형식 위반", () => {
    const options: CatalogOptions = { addons: [{ key: "a", labelKo: "족욕", priceVnd: "bad" }] };
    expect(validateCatalogItem({ ...base, options })).toContain("INVALID_OPTION");
  });
});

describe("resolveOrderPricing — 서버 재계산(변조 방지)", () => {
  // 바디마사지: variant 시간 1택(가격 대체) + 출장 modifier(+) — KRW
  const massage: CatalogOptions = {
    variants: [
      { key: "60", labelKo: "60분", priceKrw: 600000 },
      { key: "90", labelKo: "90분", priceKrw: 850000 },
    ],
    modifiers: [{ key: "home", labelKo: "출장", priceKrw: 100000 }],
  };

  it("variant 선택이 기본가를 대체 + modifier 가산 + 수량", () => {
    const r = resolveOrderPricing(
      { priceKrw: 0, priceVnd: null },
      massage,
      { variantKey: "90", modifierKeys: ["home"], quantity: 2 }
    );
    expect(r.unitPriceKrw).toBe(950000); // 850,000 + 100,000
    expect(r.totalPriceKrw).toBe(1900000); // ×2
    expect(r.snapshot.map((s) => s.key)).toEqual(["90", "home"]);
  });

  it("variants가 있으면 variantKey 필수", () => {
    expect(() =>
      resolveOrderPricing({ priceKrw: 0, priceVnd: null }, massage, { quantity: 1 })
    ).toThrow(ServiceSelectionError);
  });

  it("알 수 없는 variant/addon/modifier key는 throw", () => {
    expect(() =>
      resolveOrderPricing({ priceKrw: 0, priceVnd: null }, massage, { variantKey: "999", quantity: 1 })
    ).toThrow(/UNKNOWN_VARIANT/);
    expect(() =>
      resolveOrderPricing({ priceKrw: 0, priceVnd: null }, massage, { variantKey: "60", addonKeys: ["x"], quantity: 1 })
    ).toThrow(/UNKNOWN_ADDON/);
  });

  it("수량 0·소수 거부", () => {
    expect(() =>
      resolveOrderPricing({ priceKrw: 100, priceVnd: null }, {}, { quantity: 0 })
    ).toThrow(/INVALID_QTY/);
  });

  it("이발소: 시간 variant + 세부시술 addons 다중 가산", () => {
    const barber: CatalogOptions = {
      variants: [{ key: "60", labelKo: "60분", priceKrw: 400000 }],
      addons: [
        { key: "foot", labelKo: "족욕", priceKrw: 80000 },
        { key: "ear", labelKo: "귀청소", priceKrw: 100000 },
        { key: "shave", labelKo: "면도", priceKrw: 60000 },
      ],
    };
    const r = resolveOrderPricing(
      { priceKrw: 0, priceVnd: null },
      barber,
      { variantKey: "60", addonKeys: ["foot", "ear"], quantity: 1 }
    );
    expect(r.unitPriceKrw).toBe(580000); // 400,000 + 80,000 + 100,000
    expect(r.totalPriceKrw).toBe(580000);
  });

  it("VND 통화도 독립 계산(BigInt)", () => {
    const v: CatalogOptions = {
      variants: [{ key: "s", labelKo: "소", priceVnd: "1500000" }],
      addons: [{ key: "x", labelKo: "추가", priceVnd: "500000" }],
    };
    const r = resolveOrderPricing(
      { priceKrw: null, priceVnd: null },
      v,
      { variantKey: "s", addonKeys: ["x"], quantity: 3 }
    );
    expect(r.unitPriceVnd).toBe(2000000n);
    expect(r.totalPriceVnd).toBe(6000000n);
    expect(r.totalPriceKrw).toBeNull();
  });

  it("옵션 없는 단순 항목 — base 가격 × 수량", () => {
    const r = resolveOrderPricing({ priceKrw: 30000, priceVnd: null }, {}, { quantity: 4 });
    expect(r.totalPriceKrw).toBe(120000);
    expect(r.snapshot).toEqual([]);
  });
});
