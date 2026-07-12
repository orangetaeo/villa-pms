import { describe, it, expect } from "vitest";
import {
  parseCatalogOptions,
  validateCatalogItem,
  variantsHaveRequiredPrices,
  resolveOrderPricing,
  stripOptionCosts,
  generateOptionKey,
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
  it("옵션 원가 형식 위반(costVnd)", () => {
    const options: CatalogOptions = {
      variants: [{ key: "90", labelKo: "90분", priceVnd: "850000", costVnd: "abc" }],
    };
    expect(validateCatalogItem({ ...base, options })).toContain("INVALID_OPTION");
  });
  it("옵션 원가·설명 정상은 통과", () => {
    const options: CatalogOptions = {
      variants: [
        { key: "90", labelKo: "90분", priceVnd: "850000", costVnd: "500000", descKo: "전신 + 발마사지" },
      ],
    };
    expect(validateCatalogItem({ ...base, options })).toEqual([]);
  });
});

describe("variantsHaveRequiredPrices — variant 가격 필수 write 가드(재발 방지)", () => {
  it("options 없음·variants 없음은 통과", () => {
    expect(variantsHaveRequiredPrices(null)).toBe(true);
    expect(variantsHaveRequiredPrices(undefined)).toBe(true);
    expect(variantsHaveRequiredPrices({})).toBe(true);
    expect(variantsHaveRequiredPrices({ addons: [{ key: "a", labelKo: "추가", priceVnd: null }] })).toBe(true);
  });
  it("모든 variant 가격 있으면 통과", () => {
    const opts: CatalogOptions = {
      variants: [
        { key: "adult", labelKo: "성인", priceVnd: "1500000" },
        { key: "child", labelKo: "어린이", priceVnd: "1100000" },
      ],
    };
    expect(variantsHaveRequiredPrices(opts)).toBe(true);
  });
  it('"0"은 허용(무료 구분)', () => {
    const opts: CatalogOptions = {
      variants: [{ key: "free", labelKo: "무료", priceVnd: "0" }],
    };
    expect(variantsHaveRequiredPrices(opts)).toBe(true);
  });
  it("variant 가격이 null·빈문자면 차단(케이블카 null 사고)", () => {
    expect(
      variantsHaveRequiredPrices({ variants: [{ key: "a", labelKo: "성인", priceVnd: null }] })
    ).toBe(false);
    expect(
      variantsHaveRequiredPrices({ variants: [{ key: "a", labelKo: "성인", priceVnd: "" }] })
    ).toBe(false);
    expect(
      variantsHaveRequiredPrices({ variants: [{ key: "a", labelKo: "성인" }] })
    ).toBe(false);
  });
  it("variant 가격이 숫자문자열 아니면 차단", () => {
    expect(
      variantsHaveRequiredPrices({ variants: [{ key: "a", labelKo: "성인", priceVnd: "12,000" }] })
    ).toBe(false);
  });
  it("여러 variant 중 하나라도 비면 차단", () => {
    const opts: CatalogOptions = {
      variants: [
        { key: "adult", labelKo: "성인", priceVnd: "1500000" },
        { key: "child", labelKo: "어린이", priceVnd: null }, // ← 비어있음
      ],
    };
    expect(variantsHaveRequiredPrices(opts)).toBe(false);
  });
});

describe("stripOptionCosts — 마진 비공개(원칙2)", () => {
  const withCosts: CatalogOptions = {
    variants: [
      { key: "90", labelKo: "90분", priceVnd: "850000", costVnd: "500000", descKo: "전신", descI18n: { en: "Full", vi: "Toàn thân", zh: "全身", ru: "Всё" } },
    ],
    addons: [{ key: "foot", labelKo: "족욕", priceVnd: "80000", costVnd: "30000" }],
    modifiers: [{ key: "home", labelKo: "출장", priceVnd: "100000", costVnd: "60000" }],
  };

  it("모든 그룹에서 costVnd 키 자체를 제거(어떤 옵션에도 cost 없음)", () => {
    const out = stripOptionCosts(withCosts);
    const allOpts = [...(out.variants ?? []), ...(out.addons ?? []), ...(out.modifiers ?? [])];
    expect(allOpts.length).toBe(3);
    for (const o of allOpts) {
      expect("costVnd" in o).toBe(false);
    }
  });

  it("판매가·라벨·설명·번역은 보존", () => {
    const out = stripOptionCosts(withCosts);
    expect(out.variants?.[0]).toMatchObject({
      key: "90",
      labelKo: "90분",
      priceVnd: "850000",
      descKo: "전신",
      descI18n: { en: "Full", vi: "Toàn thân", zh: "全身", ru: "Всё" },
    });
    expect(out.addons?.[0].priceVnd).toBe("80000");
  });

  it("null/비객체는 그대로 반환", () => {
    expect(stripOptionCosts(null)).toBeNull();
    expect(stripOptionCosts(undefined)).toBeUndefined();
  });

  it("원본을 변형하지 않음(불변)", () => {
    stripOptionCosts(withCosts);
    expect(withCosts.variants?.[0].costVnd).toBe("500000");
  });
});

describe("generateOptionKey — 코드칸 제거(자동 key)", () => {
  it("매번 비어있지 않은 유일한 key 생성", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateOptionKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k.length).toBeGreaterThan(3);
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
