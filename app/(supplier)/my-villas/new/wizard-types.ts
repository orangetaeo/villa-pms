// 마법사 공유 타입·헬퍼 (T1.1) — 상태는 부모(villa-wizard)에 보관, 뒤로가기 시 유지
import type { Season } from "@/lib/villa-schema";
import type { PHOTO_SPACES } from "@/lib/villa-schema";
import { SEASONS } from "@/lib/villa-schema";

export type PhotoSpace = (typeof PHOTO_SPACES)[number];

export interface PhotoSlotState {
  status: "uploading" | "done" | "error";
  url?: string;
}

/** 직접입력(custom) 비품 — 사전에 없는 항목을 공급자가 vi로 직접 입력.
 *  미니바는 회사표준 분리(서버 drop)라 custom 대상에서 제외 → KITCHEN·BATHROOM·APPLIANCE만. */
export type CustomAmenityCategory = "KITCHEN" | "BATHROOM" | "APPLIANCE";

export interface CustomAmenity {
  category: CustomAmenityCategory;
  label: string; // vi 원문 (최대 60자), 저장 시 itemKey="custom" + customLabel
  quantity: number; // 항상 1 이상
}

/** ADMIN 직접등록 시 귀속 공급자 선택 옵션 */
export interface SupplierOption {
  id: string;
  name: string;
  phone: string | null;
}

export interface WizardState {
  // 0. 귀속 공급자 — ADMIN 직접등록 시에만 사용("" = 미선택). SUPPLIER는 빈 값(서버가 세션 강제)
  supplierId: string;
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
  // 4/6 비품 — key: `${category}:${itemKey}` → 수량 (미니바 외 1=있음). custom은 여기 아닌 customAmenities에
  amenities: Record<string, number>;
  // 4/6 직접입력 비품 — 사전에 없는 항목 (KITCHEN·BATHROOM·APPLIANCE)
  customAmenities: CustomAmenity[];
  // 5/6 이용 규칙 — 공급자 영역(체크인/아웃·흡연 등). 기본값 존재
  rules: VillaRules;
  // 6/6 원가 — 숫자 문자열 (동 단위, "" = 미입력)
  rates: Record<Season, string>;
}

/** 이용 규칙 — Villa 모델 필드와 1:1 (분 단위 시각, VND 동 단위 문자열) */
export interface VillaRules {
  checkInTime: number; // 분 단위 0~1439 (840=14:00)
  checkOutTime: number; // 660=11:00
  smokingAllowed: boolean;
  petsAllowed: boolean;
  partyAllowed: boolean;
  parkingSlots: number;
  baseDepositVnd: string; // 동 단위 숫자 문자열 ("" = 미입력)
  extraBedAvailable: boolean;
}

export const INITIAL_RULES: VillaRules = {
  checkInTime: 840,
  checkOutTime: 660,
  smokingAllowed: false,
  petsAllowed: false,
  partyAllowed: false,
  parkingSlots: 0,
  baseDepositVnd: "",
  extraBedAvailable: false,
};

export const INITIAL_STATE: WizardState = {
  supplierId: "",
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
  customAmenities: [],
  rules: INITIAL_RULES,
  rates: { LOW: "", HIGH: "", PEAK: "" },
};

export interface PhotoSlot {
  id: string;
  space: PhotoSpace;
  /** 침실/욕실 번호 — i18n ICU 변수 및 spaceLabel 저장용 */
  index?: number;
  icon: string;
  /**
   * 선택 슬롯 여부(발코니·수영장 등 부가 공간). 청소 제출 게이트는 필수 슬롯만 요구한다 —
   * 발코니 없는 빌라/못 들어간 공간 때문에 청소부가 제출을 못 하던 문제 방지(빌라 등록은 원래 전부 선택).
   */
  optional?: boolean;
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
  // 발코니·수영장은 부가 공간 — 청소 제출에서 선택(필수 아님). 없는 빌라/미접근 시 제출 차단 방지.
  slots.push({ id: "balcony", space: "BALCONY", icon: "photo_camera", optional: true });
  if (hasPool) {
    slots.push({ id: "pool", space: "POOL", icon: "pool", optional: true });
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
  rules: VillaRules; // 이용 규칙 — 재제출 시 기존값 prefill(미반영 방지)
  photos: { space: PhotoSpace; spaceLabel: string | null; url: string }[];
  amenities: {
    category: string;
    itemKey: string;
    quantity: number;
    customLabel?: string | null; // itemKey="custom" 행의 vi 원문
  }[];
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

  // 사전 항목은 맵으로, 직접입력(custom) 항목은 배열로 분리 prefill.
  // custom을 맵에 넣으면 `${category}:custom` 키가 충돌해 여러 개가 하나로 뭉개진다.
  const amenities: Record<string, number> = {};
  const customAmenities: CustomAmenity[] = [];
  const CUSTOM_CATEGORIES = new Set<string>(["KITCHEN", "BATHROOM", "APPLIANCE"]);
  for (const a of villa.amenities) {
    if (a.itemKey === "custom") {
      const label = a.customLabel?.trim();
      if (label && CUSTOM_CATEGORIES.has(a.category)) {
        customAmenities.push({
          category: a.category as CustomAmenityCategory,
          label,
          quantity: Math.max(1, a.quantity),
        });
      }
      continue;
    }
    amenities[`${a.category}:${a.itemKey}`] = a.quantity;
  }

  const rateMap = new Map(villa.rates.map((r) => [r.season, r.supplierCostVnd]));
  const rates = Object.fromEntries(
    SEASONS.map((s) => [s, rateMap.get(s) ?? ""])
  ) as Record<Season, string>;

  return {
    supplierId: "", // 재제출(edit)은 공급자 컨텍스트 — 서버가 세션 강제, 미사용
    name: villa.name,
    complex: villa.complex ?? "",
    bedrooms: villa.bedrooms,
    bathrooms: villa.bathrooms,
    maxGuests: villa.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    address: villa.address ?? "",
    monthlyRent: villa.monthlyRentVnd ?? "",
    rules: villa.rules,
    photos,
    amenities,
    customAmenities,
    rates,
  };
}
