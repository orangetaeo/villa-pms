// 침대 종류 메타 (ADR-0011) — schema enum BedType과 1:1 (테오 확정 6종)
// 라벨 i18n 키: bedding.<KING|QUEEN|DOUBLE|SINGLE|TWIN|BUNK> (ko/vi)
// 아이콘은 Material Symbols Outlined 글리프명

export const BED_TYPES = ["KING", "QUEEN", "DOUBLE", "SINGLE", "TWIN", "BUNK"] as const;
export type BedTypeKey = (typeof BED_TYPES)[number];

export const BED_TYPE_META: Record<BedTypeKey, { icon: string }> = {
  KING: { icon: "king_bed" },
  QUEEN: { icon: "bed" },
  DOUBLE: { icon: "bed" },
  SINGLE: { icon: "single_bed" },
  TWIN: { icon: "single_bed" },
  BUNK: { icon: "bunk_bed" },
};

/** 사전 검증 — API에서 임의 bedType 주입 차단 (enum 외 값 거부) */
export function isValidBedType(value: string): value is BedTypeKey {
  return (BED_TYPES as readonly string[]).includes(value);
}
