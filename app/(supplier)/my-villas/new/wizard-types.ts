// 마법사 공유 타입·헬퍼 (T1.1) — 상태는 부모(villa-wizard)에 보관, 뒤로가기 시 유지
import type { Season, AccessType } from "@/lib/villa-schema";
import type { PHOTO_SPACES } from "@/lib/villa-schema";
import { SEASONS, ACCESS_TYPES } from "@/lib/villa-schema";
import type { BedTypeKey } from "@/lib/bedding";
import { MAX_GUESTS_CLAMP, isValidBedType } from "@/lib/bedding";

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

// ===================== 잠자리 구성 (T-bedroom-composition-sync) =====================
// 방별 구성이 진실의 원천 — 서버가 bedrooms/bathrooms/maxGuests를 파생. 클라이언트는 미리 계산해 캐시.

/** 침대 종류 1개당 기준 인원 — capacity 자동 추론용(KING/QUEEN/DOUBLE/BUNK=2, SINGLE/TWIN=1). 서버는 추론 안 함(수신값 저장). */
export const BED_TYPE_CAPACITY: Record<BedTypeKey, number> = {
  KING: 2,
  QUEEN: 2,
  DOUBLE: 2,
  SINGLE: 1,
  TWIN: 1,
  BUNK: 2,
};

/** 한 침실 안의 침대 종류별 행 (같은 종류 여러 개는 bedCount로) */
export interface BedRowState {
  bedType: BedTypeKey;
  bedCount: number; // 1~20
}

/** 침실 카드 — roomIndex는 배열 순서(i+1)로 파생, 라벨은 자동("침실 N")이라 상태에 없음 */
export interface BedroomCardState {
  id: string; // 로컬 렌더 키
  beds: BedRowState[]; // 최소 1행
  capacity: number; // 기준 인원 — 자동 추론값 또는 수동 조정값
  capacityManual: boolean; // true면 침대 변경 시 자동 재계산 안 함
  bathroomCount: number; // 이 침실 전용욕실 개수 (0=없음)
}

let roomKeyCounter = 0;
const roomKey = () => `room_${Date.now()}_${roomKeyCounter++}`;

/** 침대 구성 → 기준 인원 자동 추론 (최소 1) */
export function autoRoomCapacity(beds: BedRowState[]): number {
  const sum = beds.reduce((s, b) => s + BED_TYPE_CAPACITY[b.bedType] * b.bedCount, 0);
  return Math.max(1, sum);
}

/** 기본 침실 카드 — 킹 1 + 전용욕실 1 */
export function defaultRoom(): BedroomCardState {
  return {
    id: roomKey(),
    beds: [{ bedType: "KING", bedCount: 1 }],
    capacity: BED_TYPE_CAPACITY.KING,
    capacityManual: false,
    bathroomCount: 1,
  };
}

/** 방 구성 + 공용욕실 → 파생 스칼라 (서버 lib/bedding.deriveBedroomScalars와 동일 규칙, min 1 불변식).
 *  body 스칼라·사진 슬롯 수 계산에 사용. */
export function deriveWizardScalars(
  rooms: BedroomCardState[],
  commonBathrooms: number
): { bedrooms: number; bathrooms: number; maxGuests: number } {
  const bedrooms = Math.max(1, rooms.length);
  const ensuite = rooms.reduce((s, r) => s + Math.max(0, r.bathroomCount), 0);
  const bathrooms = Math.max(1, ensuite + Math.max(0, commonBathrooms));
  const capSum = rooms.reduce((s, r) => s + Math.max(1, r.capacity), 0);
  const maxGuests = Math.max(1, Math.min(MAX_GUESTS_CLAMP, capSum));
  return { bedrooms, bathrooms, maxGuests };
}

/** 방 카드 → 서버 전송 bedroomDetails[] (roomIndex=배열순서, roomLabel=null 자동, 침대 없는 종류 제외) */
export function buildBedroomDetails(rooms: BedroomCardState[]): {
  roomIndex: number;
  roomLabel: null;
  bedType: BedTypeKey;
  bedCount: number;
  capacity: number;
  bathroomCount: number;
}[] {
  const out: {
    roomIndex: number;
    roomLabel: null;
    bedType: BedTypeKey;
    bedCount: number;
    capacity: number;
    bathroomCount: number;
  }[] = [];
  rooms.forEach((room, i) => {
    const roomIndex = i + 1;
    const capacity = Math.max(1, room.capacity);
    for (const bed of room.beds) {
      if (bed.bedCount < 1) continue;
      out.push({
        roomIndex,
        roomLabel: null, // 라벨 자동("침실 N") — 텍스트 입력 없음
        bedType: bed.bedType,
        bedCount: bed.bedCount,
        capacity,
        bathroomCount: Math.max(0, room.bathroomCount),
      });
    }
  });
  return out;
}

export interface WizardState {
  // 0. 귀속 공급자 — ADMIN 직접등록 시에만 사용("" = 미선택). SUPPLIER는 빈 값(서버가 세션 강제)
  supplierId: string;
  // 1 기본 정보
  name: string;
  complex: string; // "" = 미선택
  // bedrooms/bathrooms/maxGuests = 잠자리 스텝 파생 캐시(서버가 재계산하는 스칼라). 사진 슬롯 수·body 스칼라에 사용.
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  // 2 잠자리 구성 (T-bedroom-composition-sync) — 방별 구성이 진실의 원천
  rooms: BedroomCardState[];
  commonBathrooms: number; // 방에 속하지 않는 공용 욕실 (0~10)
  // 3 위치·참고 (선택) + 셀링포인트·구글맵·해변거리
  address: string;
  monthlyRent: string; // 숫자만 (동 단위)
  features: string[]; // 선택된 featureKey (lib/features.ts 사전)
  googleMapUrl: string; // 구글 지도 공유 링크 ("" = 미입력)
  beachDistanceM: number | null; // 해변까지 거리(m), null = 미입력
  // 3/5 사진 — key: 슬롯 id (exterior, bedroom-1, ...)
  photos: Record<string, PhotoSlotState>;
  // 4/6 비품 — key: `${category}:${itemKey}` → 수량 (미니바 외 1=있음). custom은 여기 아닌 customAmenities에
  amenities: Record<string, number>;
  // 4/6 직접입력 비품 — 사전에 없는 항목 (KITCHEN·BATHROOM·APPLIANCE)
  customAmenities: CustomAmenity[];
  // 6 이용 규칙 — 공급자 영역(체크인/아웃·흡연 등). 기본값 존재
  rules: VillaRules;
  // 6 이용규칙 확장 — 와이파이·출입정보 (⚠ 비공개 등급: /p·공개목록 미노출)
  wifiSsid: string;
  wifiPassword: string;
  accessType: AccessType | ""; // "" = 미선택
  accessInfo: string; // 도어코드/키 위치
  // 7 원가 — 숫자 문자열 (동 단위, "" = 미입력)
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
  // 잠자리 스텝 파생 캐시 — 기본 방 1개(킹1·전용욕실1) 기준
  bedrooms: 1,
  bathrooms: 1,
  maxGuests: BED_TYPE_CAPACITY.KING,
  hasPool: false,
  breakfastAvailable: false,
  rooms: [defaultRoom()],
  commonBathrooms: 0,
  address: "",
  monthlyRent: "",
  features: [],
  googleMapUrl: "",
  beachDistanceM: null,
  photos: {},
  amenities: {},
  customAmenities: [],
  rules: INITIAL_RULES,
  wifiSsid: "",
  wifiPassword: "",
  accessType: "",
  accessInfo: "",
  rates: { LOW: "", SHOULDER: "", HIGH: "", PEAK: "" },
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
  // ── v1.5 잠자리 구성·셀링포인트·판매정보 prefill (T-bedroom-composition-sync) — UX-VN이 WizardState로 매핑 ──
  //   비공개 필드(wifiPassword·accessInfo)는 자기 빌라(supplierId 스코프) 조회에서만 내려온다.
  //   출입정보는 기존 Villa.accessType/accessInfo 재사용(신규 doorAccess 컬럼 없음 — TDA 결정).
  commonBathrooms?: number;
  accessType?: string | null; // KEYPAD|KEY|SMARTKEY|OTHER
  accessInfo?: string | null;
  wifiSsid?: string | null;
  wifiPassword?: string | null;
  googleMapUrl?: string | null;
  beachDistanceM?: number | null;
  bedroomDetails?: {
    roomIndex: number;
    roomLabel: string | null;
    bedType: string;
    bedCount: number;
    capacity: number | null;
    bathroomCount: number;
  }[];
  features?: { category: string; featureKey: string }[];
}

/** 서버 bedroomDetails[] → 방 카드 상태 (roomIndex 비연속이어도 첫 등장 순서대로 그룹화) */
function bedroomDetailsToRooms(
  details: NonNullable<VillaForEdit["bedroomDetails"]>
): BedroomCardState[] {
  const byRoom = new Map<number, BedroomCardState>();
  const order: number[] = [];
  for (const d of details) {
    if (!byRoom.has(d.roomIndex)) {
      order.push(d.roomIndex);
      byRoom.set(d.roomIndex, {
        id: roomKey(),
        beds: [],
        capacity: d.capacity ?? 0, // 아래에서 보정
        capacityManual: d.capacity != null, // 저장된 capacity가 있으면 수동값으로 존중(침대 재계산 안 함)
        bathroomCount: d.bathroomCount ?? 0,
      });
    }
    const room = byRoom.get(d.roomIndex)!;
    if (isValidBedType(d.bedType)) {
      room.beds.push({ bedType: d.bedType, bedCount: Math.max(1, d.bedCount) });
    }
  }
  return order.map((idx) => {
    const room = byRoom.get(idx)!;
    if (room.beds.length === 0) room.beds = [{ bedType: "KING", bedCount: 1 }];
    room.capacity = room.capacityManual ? Math.max(1, room.capacity) : autoRoomCapacity(room.beds);
    return room;
  });
}

/** bedroomDetails 없는 레거시 빌라 → 스칼라(bedrooms/bathrooms/maxGuests)로 방 카드 합성.
 *  ★ 파생값이 원본 스칼라와 정확히 일치해야 함(재제출 시 조용한 반감 방지 — QA P2):
 *   - 전용욕실: 방마다 1개씩, 남는 욕실은 commonBathrooms로 승격 → 파생 bathrooms == 원본 bathrooms
 *   - capacity: 원본 maxGuests를 방 수로 분배(floor + 나머지 앞방부터 +1, 방당 zod 상한 클램프) → 파생 maxGuests == 원본
 *  ⚠ maxGuests는 booking-form 인원 게이팅 소비 필드 — 반감 시 실피해. 공급자가 잠자리 스텝에서 검토·수정한다. */
function synthesizeRooms(
  bedrooms: number,
  bathrooms: number,
  maxGuests: number
): { rooms: BedroomCardState[]; commonBathrooms: number } {
  const n = Math.max(1, bedrooms);

  // 전용욕실 1/방(앞에서부터) + 잔여는 공용 승격 — 합 == 원본 bathrooms
  const totalBath = Math.max(0, bathrooms);
  const ensuiteRooms = Math.min(n, totalBath);
  const commonBathrooms = Math.max(0, totalBath - ensuiteRooms);

  // capacity 분배 — floor + 나머지 앞방부터 +1, 방당 MAX_GUESTS_CLAMP 클램프.
  // (상한 초과로 합이 원본에 못 미치는 케이스만 허용 — 가능한 최대까지 채움)
  const target = Math.max(0, maxGuests);
  const base = Math.floor(target / n);
  const remainder = target - base * n;

  const rooms: BedroomCardState[] = [];
  for (let i = 0; i < n; i += 1) {
    const cap = Math.max(1, Math.min(MAX_GUESTS_CLAMP, base + (i < remainder ? 1 : 0)));
    rooms.push({
      id: roomKey(),
      beds: [{ bedType: "KING", bedCount: 1 }],
      capacity: cap,
      capacityManual: true, // 원본 maxGuests 보존값 — 침대 자동추론이 덮어쓰지 않도록 수동으로 고정
      bathroomCount: i < ensuiteRooms ? 1 : 0,
    });
  }
  return { rooms, commonBathrooms };
}

/** Villa(+photos·amenities·rates·bedroomDetails·features) → WizardState. 사진은 파생 슬롯 집합 기준 매핑(초과분 drop) */
export function villaToWizardState(villa: VillaForEdit): WizardState {
  // 잠자리 구성 복원 — bedroomDetails 있으면 그룹화, 없으면(레거시) 스칼라로 합성
  let commonBathrooms = Math.max(0, villa.commonBathrooms ?? 0);
  let rooms: BedroomCardState[];
  if (villa.bedroomDetails && villa.bedroomDetails.length > 0) {
    rooms = bedroomDetailsToRooms(villa.bedroomDetails);
  } else {
    // 합성: 전용/공용 욕실·capacity를 원본 스칼라와 일치하게 재구성(공용욕실도 재계산으로 덮어씀)
    const synth = synthesizeRooms(villa.bedrooms, villa.bathrooms, villa.maxGuests);
    rooms = synth.rooms;
    commonBathrooms = synth.commonBathrooms;
  }
  // 파생 스칼라(방 구성 기준) — 사진 슬롯 집합·body 스칼라가 잠자리 스텝 렌더와 일치하도록 여기서 재계산
  const scalars = deriveWizardScalars(rooms, commonBathrooms);

  const accessType: AccessType | "" =
    villa.accessType && (ACCESS_TYPES as readonly string[]).includes(villa.accessType)
      ? (villa.accessType as AccessType)
      : "";

  const slotIds = new Set(
    buildPhotoSlots(scalars.bedrooms, scalars.bathrooms, villa.hasPool).map((s) => s.id)
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
    bedrooms: scalars.bedrooms,
    bathrooms: scalars.bathrooms,
    maxGuests: scalars.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    rooms,
    commonBathrooms,
    address: villa.address ?? "",
    monthlyRent: villa.monthlyRentVnd ?? "",
    features: (villa.features ?? []).map((f) => f.featureKey),
    googleMapUrl: villa.googleMapUrl ?? "",
    beachDistanceM: villa.beachDistanceM ?? null,
    rules: villa.rules,
    wifiSsid: villa.wifiSsid ?? "",
    wifiPassword: villa.wifiPassword ?? "",
    accessType,
    accessInfo: villa.accessInfo ?? "",
    photos,
    amenities,
    customAmenities,
    rates,
  };
}
