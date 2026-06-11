// 마법사 공유 타입·헬퍼 (T1.1) — 상태는 부모(villa-wizard)에 보관, 뒤로가기 시 유지
import type { Season } from "@/lib/villa-schema";
import type { PHOTO_SPACES } from "@/lib/villa-schema";

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
