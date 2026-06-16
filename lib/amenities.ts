// 비품 품목 사전 (T1.1 — a9 디자인 기준, ADR-0003 VillaAmenity)
// itemKey는 코드 상수 — 라벨은 i18n 키 `amenities.items.<itemKey>` (vi 기본, ko 병기)
// 아이콘은 Material Symbols Outlined 글리프명

export type AmenityCategoryKey = "KITCHEN" | "BATHROOM" | "APPLIANCE" | "MINIBAR";

export interface AmenityItem {
  itemKey: string;
  icon: string;
}

export const AMENITY_CATEGORIES: AmenityCategoryKey[] = [
  "KITCHEN",
  "BATHROOM",
  "APPLIANCE",
  "MINIBAR",
];

export const AMENITY_ITEMS: Record<AmenityCategoryKey, AmenityItem[]> = {
  // 주방용품 (a9 디자인 품목 그대로)
  KITCHEN: [
    { itemKey: "riceCooker", icon: "rice_bowl" },
    { itemKey: "pan", icon: "skillet" },
    { itemKey: "knifeBoard", icon: "cut" },
    { itemKey: "dishes", icon: "restaurant" },
    { itemKey: "glasses", icon: "local_cafe" },
    { itemKey: "kettle", icon: "kettle" },
    { itemKey: "microwave", icon: "microwave" },
    { itemKey: "spices", icon: "grocery" },
  ],
  // 화장실용품 — 수건은 대/중/소 3종 (quantity = 매일 제공 수량 의미, note에 "매일 제공" 등)
  BATHROOM: [
    { itemKey: "towelLarge", icon: "dry_cleaning" },
    { itemKey: "towelMedium", icon: "dry_cleaning" },
    { itemKey: "towelSmall", icon: "dry_cleaning" },
    { itemKey: "shampoo", icon: "soap" },
    { itemKey: "bodyWash", icon: "shower" },
    { itemKey: "toothbrushKit", icon: "dentistry" },
    { itemKey: "hairDryer", icon: "dry" },
    { itemKey: "toiletPaper", icon: "wc" },
  ],
  // 가전류
  APPLIANCE: [
    { itemKey: "airConditioner", icon: "ac_unit" },
    { itemKey: "tv", icon: "tv" },
    { itemKey: "fridge", icon: "kitchen" },
    { itemKey: "washingMachine", icon: "local_laundry_service" },
    { itemKey: "wifi", icon: "wifi" },
    { itemKey: "fan", icon: "mode_fan" },
    { itemKey: "waterHeater", icon: "thermostat" },
  ],
  // 미니바 — 수량 의미 있음 (+/− 스테퍼)
  MINIBAR: [
    { itemKey: "water", icon: "water_drop" },
    { itemKey: "softDrink", icon: "local_drink" },
    { itemKey: "beer", icon: "sports_bar" },
    { itemKey: "snack", icon: "cookie" },
  ],
};

/** 직접입력(custom) 허용 카테고리 — 미니바 한정 (텍스트 입력 최소화 원칙).
 *  custom은 customLabel(공급자 vi 입력)을 필수로 동반한다 (검증은 라우트 zod에서). */
export const CUSTOM_ALLOWED_CATEGORIES: AmenityCategoryKey[] = ["MINIBAR"];

/** 품목 사전 검증 — API에서 임의 itemKey 주입 차단.
 *  단 CUSTOM_ALLOWED_CATEGORIES(미니바)에서는 itemKey="custom"을 사전과 별개로 허용. */
export function isValidAmenity(category: AmenityCategoryKey, itemKey: string): boolean {
  if (itemKey === "custom") return CUSTOM_ALLOWED_CATEGORIES.includes(category);
  return AMENITY_ITEMS[category]?.some((item) => item.itemKey === itemKey) ?? false;
}
