// 마법사 공유 타입·헬퍼 (T1.1) — 상태는 부모(villa-wizard)에 보관, 뒤로가기 시 유지
import type { Season } from "@/lib/villa-schema";
import type { PHOTO_SPACES } from "@/lib/villa-schema";
import { SEASONS } from "@/lib/villa-schema";

export type PhotoSpace = (typeof PHOTO_SPACES)[number];

export interface PhotoSlotState {
  status: "uploading" | "done" | "error";
  url?: string;
}

export interface WizardState {
  // 1/5 기본 정보
  name: string;
  complex: string; // "" = 미선택
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  // 2/5 위치·참고 (선택)
  address: string;
  monthlyRent: string; // 숫자만 (동 단위)
  // 3/5 사진 — key: 슬롯 id (exterior, bedroom-1, ...)
  photos: Record<string, PhotoSlotState>;
  // 4/5 비품 — key: `${category}:${itemKey}` → 수량 (미니바 외 1=있음)
  amenities: Record<string, number>;
  // 5/5 원가 — 숫자 문자열 (동 단위, "" = 미입력)
  rates: Record<Season, string>;
}

export const INITIAL_STATE: WizardState = {
  name: "",
  complex: "",
  bedrooms: 3,
  bathrooms: 2,
  maxGuests: 6,
  hasPool: false,
  breakfastAvailable: false,
  address: "",
  monthlyRent: "",
  photos: {},
  amenities: {},
  rates: { LOW: "", HIGH: "", PEAK: "" },
};

export interface PhotoSlot {
  id: string;
  space: PhotoSpace;
  /** 침실/욕실 번호 — i18n ICU 변수 및 spaceLabel 저장용 */
  index?: number;
  icon: string;
}

/** 침실/욕실 수·수영장 여부에 맞춰 사진 슬롯 동적 생성 (a1 디자인) */
export function buildPhotoSlots(
  bedrooms: number,
  bathrooms: number,
  hasPool: boolean
): PhotoSlot[] {
  const slots: PhotoSlot[] = [
    { id: "exterior", space: "EXTERIOR", icon: "photo_camera" },
    { id: "living", space: "LIVING", icon: "photo_camera" },
    { id: "kitchen", space: "KITCHEN", icon: "photo_camera" },
  ];
  for (let i = 1; i <= bedrooms; i += 1) {
    slots.push({ id: `bedroom-${i}`, space: "BEDROOM", index: i, icon: "photo_camera" });
  }
  for (let i = 1; i <= bathrooms; i += 1) {
    slots.push({ id: `bathroom-${i}`, space: "BATHROOM", index: i, icon: "photo_camera" });
  }
  slots.push({ id: "balcony", space: "BALCONY", icon: "photo_camera" });
  if (hasPool) {
    slots.push({ id: "pool", space: "POOL", icon: "pool" });
  }
  return slots;
}

/** 공급자 VND 표기 — 점 구분 (1.500.000). KRW·콤마 금지 */
export function formatVnd(digits: string): string {
  if (!digits) return "0";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ===================== 재제출 edit mode prefill (T1.2b) =====================

/** space+spaceLabel → 슬롯 id 역매핑 (POST 저장 규칙의 역). 슬롯 없는 사진은 null로 drop */
export function photoSlotId(
  space: PhotoSpace,
  spaceLabel: string | null,
  slotIds: Set<string>
): string | null {
  let id: string | null = null;
  switch (space) {
    case "EXTERIOR": id = "exterior"; break;
    case "LIVING": id = "living"; break;
    case "KITCHEN": id = "kitchen"; break;
    case "BALCONY": id = "balcony"; break;
    case "POOL": id = "pool"; break;
    case "BEDROOM": id = spaceLabel ? `bedroom-${spaceLabel}` : null; break;
    case "BATHROOM": id = spaceLabel ? `bathroom-${spaceLabel}` : null; break;
    default: id = null; // ETC 등 — 슬롯 없음
  }
  // buildPhotoSlots가 만드는 현재 슬롯에 없는 사진(초과 침실·욕실 등)은 drop (QA 조건 4)
  return id && slotIds.has(id) ? id : null;
}

export interface VillaForEdit {
  name: string;
  complex: string | null;
  address: string | null;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  monthlyRentVnd: string | null; // 동 단위 숫자 문자열 (null=미입력)
  photos: { space: PhotoSpace; spaceLabel: string | null; url: string }[];
  amenities: { category: string; itemKey: string; quantity: number }[];
  rates: { season: Season; supplierCostVnd: string }[]; // supplierCostVnd 동 단위 문자열
}

/** Villa(+photos·amenities·rates) → WizardState. 사진은 현재 슬롯 집합 기준 매핑(초과분 drop) */
export function villaToWizardState(villa: VillaForEdit): WizardState {
  const slotIds = new Set(
    buildPhotoSlots(villa.bedrooms, villa.bathrooms, villa.hasPool).map((s) => s.id)
  );
  const photos: Record<string, PhotoSlotState> = {};
  for (const p of villa.photos) {
    const id = photoSlotId(p.space, p.spaceLabel, slotIds);
    if (id) photos[id] = { status: "done", url: p.url };
  }

  const amenities: Record<string, number> = {};
  for (const a of villa.amenities) {
    amenities[`${a.category}:${a.itemKey}`] = a.quantity;
  }

  const rateMap = new Map(villa.rates.map((r) => [r.season, r.supplierCostVnd]));
  const rates = Object.fromEntries(
    SEASONS.map((s) => [s, rateMap.get(s) ?? ""])
  ) as Record<Season, string>;

  return {
    name: villa.name,
    complex: villa.complex ?? "",
    bedrooms: villa.bedrooms,
    bathrooms: villa.bathrooms,
    maxGuests: villa.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    address: villa.address ?? "",
    monthlyRent: villa.monthlyRentVnd ?? "",
    photos,
    amenities,
    rates,
  };
}
