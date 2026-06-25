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

describe("validateCatalogItem — VND 전용", () => {
  const base: CatalogItemInput = { type: "MASSAGE", nameKo: "풋마사지", priceVnd: "600000" };
  it("정상 통과", () => {
    expect(validateCatalogItem(base)).toEqual([]);
  });
  it("타입·이름·가격 누락", () => {
    expect(validateCatalogItem({ ...base, type: "NOPE" })).toContain("INVALID_TYPE");
    expect(validateCatalogItem({ ...base, nameKo: "  " })).toContain("NAME_REQUIRED");
    expect(validateCatalogItem({ ...base, priceVnd: null })).toContain("NO_PRICE");
    expect(validateCatalogItem({ ...base, priceVnd: "" })).toContain("NO_PRICE");
  });
  it("가격·원가 형식", () => {
    expect(validateCatalogItem({ ...base, priceVnd: "12,000" })).toContain("INVALID_PRICE");
    expect(validateCatalogItem({ ...base, costVnd: "abc" })).toContain("INVALID_COST");
  });
  it("옵션 키 중복 거부", () => {
    const options: CatalogOptions = {
      variants: [
        { key: "60", labelKo: "60분", priceVnd: "400000" },
        { key: "60", labelKo: "중복", priceVnd: "500000" },
      ],
    };
    expect(validateCatalogItem({ ...base, options })).toContain("DUP_OPTION_KEY");
  });
  it("옵션 가격 형식 위반", () => {
    const options: CatalogOptions = { addons: [{ key: "a", labelKo: "족욕", priceVnd: "bad" }] };
    expect(validateCatalogItem({ ...base, options })).toContain("INVALID_OPTION");
  });
});

describe("resolveOrderPricing — 서버 재계산(변조 방지, VND 단일통화)", () => {
  // 바디마사지: variant 시간 1택(가격 대체) + 출장 modifier(+) — VND
  const massage: CatalogOptions = {
    variants: [
      { key: "60", labelKo: "60분", priceVnd: "600000" },
      { key: "90", labelKo: "90분", priceVnd: "850000" },
    ],
    modifiers: [{ key: "home", labelKo: "출장", priceVnd: "100000" }],
  };

  it("variant 선택이 기본가를 대체 + modifier 가산 + 수량", () => {
    const r = resolveOrderPricing(
      { priceVnd: null },
      massage,
      { variantKey: "90", modifierKeys: ["home"], quantity: 2 }
    );
    expect(r.unitPriceVnd).toBe(950000n); // 850,000 + 100,000
    expect(r.totalPriceVnd).toBe(1900000n); // ×2
    expect(r.snapshot.map((s) => s.key)).toEqual(["90", "home"]);
  });

  it("variants가 있으면 variantKey 필수", () => {
    expect(() =>
      resolveOrderPricing({ priceVnd: null }, massage, { quantity: 1 })
    ).toThrow(ServiceSelectionError);
  });

  it("알 수 없는 variant/addon/modifier key는 throw", () => {
    expect(() =>
      resolveOrderPricing({ priceVnd: null }, massage, { variantKey: "999", quantity: 1 })
    ).toThrow(/UNKNOWN_VARIANT/);
    expect(() =>
      resolveOrderPricing({ priceVnd: null }, massage, { variantKey: "60", addonKeys: ["x"], quantity: 1 })
    ).toThrow(/UNKNOWN_ADDON/);
  });

  it("수량 0·소수 거부", () => {
    expect(() =>
      resolveOrderPricing({ priceVnd: 100n }, {}, { quantity: 0 })
    ).toThrow(/INVALID_QTY/);
  });

  it("이발소: 시간 variant + 세부시술 addons 다중 가산", () => {
    const barber: CatalogOptions = {
      variants: [{ key: "60", labelKo: "60분", priceVnd: "400000" }],
      addons: [
        { key: "foot", labelKo: "족욕", priceVnd: "80000" },
        { key: "ear", labelKo: "귀청소", priceVnd: "100000" },
        { key: "shave", labelKo: "면도", priceVnd: "60000" },
      ],
    };
    const r = resolveOrderPricing(
      { priceVnd: null },
      barber,
      { variantKey: "60", addonKeys: ["foot", "ear"], quantity: 1 }
    );
    expect(r.unitPriceVnd).toBe(580000n); // 400,000 + 80,000 + 100,000
    expect(r.totalPriceVnd).toBe(580000n);
  });

  it("variant 대체 + addon 가산 + 수량(VND BigInt)", () => {
    const v: CatalogOptions = {
      variants: [{ key: "s", labelKo: "소", priceVnd: "1500000" }],
      addons: [{ key: "x", labelKo: "추가", priceVnd: "500000" }],
    };
    const r = resolveOrderPricing(
      { priceVnd: null },
      v,
      { variantKey: "s", addonKeys: ["x"], quantity: 3 }
    );
    expect(r.unitPriceVnd).toBe(2000000n);
    expect(r.totalPriceVnd).toBe(6000000n);
  });

  it("스냅샷에 labelKo·labelI18n·priceVnd 보존", () => {
    const v: CatalogOptions = {
      variants: [
        { key: "s", labelKo: "소", labelI18n: { en: "S", vi: "Nhỏ", zh: "小", ru: "S" }, priceVnd: "1500000" },
      ],
    };
    const r = resolveOrderPricing({ priceVnd: null }, v, { variantKey: "s", quantity: 1 });
    expect(r.snapshot[0]).toEqual({
      group: "variant",
      key: "s",
      labelKo: "소",
      labelI18n: { en: "S", vi: "Nhỏ", zh: "小", ru: "S" },
      priceVnd: "1500000",
    });
  });

  it("옵션 없는 단순 항목 — base 가격 × 수량", () => {
    const r = resolveOrderPricing({ priceVnd: 30000n }, {}, { quantity: 4 });
    expect(r.totalPriceVnd).toBe(120000n);
    expect(r.snapshot).toEqual([]);
  });

  it("base·variant 모두 없으면 NO_PRICE", () => {
    expect(() =>
      resolveOrderPricing({ priceVnd: null }, {}, { quantity: 1 })
    ).toThrow(/NO_PRICE/);
  });
});
