// 셀링포인트 태그 사전 (ADR-0011) — lib/amenities.ts 패턴 재사용
// featureKey는 코드 상수 — 라벨은 i18n 키 `features.items.<featureKey>` (ko/vi)
// 아이콘은 Material Symbols Outlined 글리프명
import { z } from "zod";

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

// ===================== 셀링포인트 — 공유 zod·보정 (T-bedroom-composition-sync) =====================
// 3경로(POST /api/villas · PUT /api/villas/[id] · PATCH /api/villas/[id]/sales)가 공유한다.

/** 셀링포인트 태그 행 zod */
export const featureRowSchema = z.object({
  category: z.enum(["VIEW", "FACILITY", "LOCATION"]),
  featureKey: z.string().min(1).max(50),
});
export type FeatureRowInput = z.infer<typeof featureRowSchema>;

/** features 배열 검증 — 사전 화이트리스트 + category 정합 + @@unique(중복) 차단.
 *  각 스키마 superRefine 안에서 호출. pathKey는 issue 경로 필드명. */
export function refineFeatures(
  features: { category: string; featureKey: string }[],
  ctx: z.RefinementCtx,
  pathKey = "features"
): void {
  const seen = new Set<string>();
  features.forEach((f, index) => {
    if (!isValidFeature(f.category as FeatureCategoryKey, f.featureKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [pathKey, index, "featureKey"],
        message: `Unknown feature: ${f.category}/${f.featureKey}`,
      });
    }
    // @@unique([villaId, featureKey]) — 중복 키 사전 차단 (createMany 충돌 방지)
    if (seen.has(f.featureKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [pathKey, index, "featureKey"],
        message: `Duplicate feature: ${f.featureKey}`,
      });
    }
    seen.add(f.featureKey);
  });
}

/** 셀링포인트에 풀 태그(프라이빗풀·키즈풀)가 있으면 hasPool=true 강제 보정 대상인지 판정.
 *  해제는 자동으로 하지 않음(태그를 끄면 클라이언트 hasPool 값 그대로). */
export function hasPoolFeatureTag(features: { featureKey: string }[]): boolean {
  return features.some((f) => f.featureKey === "privatePool" || f.featureKey === "kidsPool");
}
