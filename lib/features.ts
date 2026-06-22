// 셀링포인트 태그 사전 (ADR-0011) — lib/amenities.ts 패턴 재사용
// featureKey는 코드 상수 — 라벨은 i18n 키 `features.items.<featureKey>` (ko/vi)
// 아이콘은 Material Symbols Outlined 글리프명

export type FeatureCategoryKey = "VIEW" | "FACILITY" | "LOCATION";

export interface FeatureItem {
  featureKey: string;
  icon: string;
}

export const FEATURE_CATEGORIES: FeatureCategoryKey[] = ["VIEW", "FACILITY", "LOCATION"];

export const FEATURE_ITEMS: Record<FeatureCategoryKey, FeatureItem[]> = {
  VIEW: [
    { featureKey: "viewSea", icon: "waves" }, // 바다뷰
    { featureKey: "viewMountain", icon: "landscape" }, // 마운틴뷰
    { featureKey: "viewCity", icon: "location_city" }, // 시티뷰
  ],
  FACILITY: [
    { featureKey: "bbq", icon: "outdoor_grill" }, // BBQ
    { featureKey: "elevator", icon: "elevator" }, // 엘리베이터
    { featureKey: "generator", icon: "bolt" }, // 발전기/정전대비
    { featureKey: "kidsPool", icon: "pool" }, // 키즈풀
    { featureKey: "privatePool", icon: "pool" }, // 프라이빗풀(hasPool과 별개 강조 태그)
    { featureKey: "gym", icon: "fitness_center" },
  ],
  LOCATION: [
    { featureKey: "golfNearby", icon: "golf_course" }, // 골프장 인근
    { featureKey: "beachFront", icon: "beach_access" }, // 해변 바로앞
    { featureKey: "marketNearby", icon: "storefront" },
  ],
};

/** 사전 검증 — API에서 임의 featureKey 주입 차단 (custom 미허용) */
export function isValidFeature(category: FeatureCategoryKey, featureKey: string): boolean {
  return FEATURE_ITEMS[category]?.some((f) => f.featureKey === featureKey) ?? false;
}
