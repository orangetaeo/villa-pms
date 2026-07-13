import { describe, expect, it } from "vitest";
import {
  villaToWizardState,
  photoSlotId,
  deriveWizardScalars,
  buildBedroomDetails,
  autoRoomCapacity,
  defaultRoom,
  type BedroomCardState,
  type VillaForEdit,
} from "@/app/(supplier)/my-villas/new/wizard-types";

const BASE: VillaForEdit = {
  name: "쏘나씨 V12",
  complex: "쏘나씨",
  address: "Lô SV-01",
  bedrooms: 2,
  bathrooms: 1,
  maxGuests: 4,
  hasPool: true,
  breakfastAvailable: false,
  monthlyRentVnd: "30000000",
  rules: {
    checkInTime: 900,
    checkOutTime: 660,
    smokingAllowed: false,
    petsAllowed: true,
    partyAllowed: false,
    parkingSlots: 2,
    baseDepositVnd: "5000000",
    extraBedAvailable: true,
  },
  photos: [],
  amenities: [],
  rates: [
    { season: "LOW", supplierCostVnd: "1500000" },
    { season: "HIGH", supplierCostVnd: "2500000" },
    { season: "PEAK", supplierCostVnd: "4000000" },
  ],
};

describe("photoSlotId — space+spaceLabel 역매핑 (QA 조건 4)", () => {
  const slots = new Set([
    "exterior", "living", "kitchen", "bedroom-1", "bedroom-2", "bathroom-1", "balcony", "pool",
  ]);

  it("고정 공간은 소문자 슬롯 id", () => {
    expect(photoSlotId("EXTERIOR", null, slots)).toBe("exterior");
    expect(photoSlotId("LIVING", null, slots)).toBe("living");
    expect(photoSlotId("KITCHEN", null, slots)).toBe("kitchen");
    expect(photoSlotId("BALCONY", null, slots)).toBe("balcony");
    expect(photoSlotId("POOL", null, slots)).toBe("pool");
  });

  it("침실·욕실은 spaceLabel로 번호 슬롯", () => {
    expect(photoSlotId("BEDROOM", "1", slots)).toBe("bedroom-1");
    expect(photoSlotId("BEDROOM", "2", slots)).toBe("bedroom-2");
    expect(photoSlotId("BATHROOM", "1", slots)).toBe("bathroom-1");
  });

  it("현재 슬롯 집합에 없는 사진은 drop(null) — 초과 침실·ETC", () => {
    expect(photoSlotId("BEDROOM", "3", slots)).toBeNull(); // 슬롯 없음 (침실 2개로 축소)
    expect(photoSlotId("ETC", null, slots)).toBeNull();
    expect(photoSlotId("BEDROOM", null, slots)).toBeNull(); // 라벨 없는 침실
    expect(photoSlotId("POOL", null, new Set(["exterior"]))).toBeNull(); // 수영장 없는 빌라
  });
});

describe("villaToWizardState — 재제출 prefill", () => {
  it("기본 정보·원가·비품 키 변환", () => {
    const state = villaToWizardState({
      ...BASE,
      amenities: [
        { category: "KITCHEN", itemKey: "kettle", quantity: 1 },
        { category: "MINIBAR", itemKey: "water", quantity: 6 },
      ],
    });
    expect(state.name).toBe("쏘나씨 V12");
    expect(state.complex).toBe("쏘나씨");
    expect(state.bedrooms).toBe(2);
    expect(state.hasPool).toBe(true);
    expect(state.monthlyRent).toBe("30000000");
    expect(state.rates).toEqual({ LOW: "1500000", SHOULDER: "", HIGH: "2500000", PEAK: "4000000" });
    expect(state.amenities).toEqual({ "KITCHEN:kettle": 1, "MINIBAR:water": 6 });
    // 이용 규칙 prefill — 재제출 시 기존값 그대로 전달
    expect(state.rules).toEqual({
      checkInTime: 900,
      checkOutTime: 660,
      smokingAllowed: false,
      petsAllowed: true,
      partyAllowed: false,
      parkingSlots: 2,
      baseDepositVnd: "5000000",
      extraBedAvailable: true,
    });
  });

  it("null 필드는 빈 문자열로 (complex·address·monthlyRent)", () => {
    const state = villaToWizardState({
      ...BASE,
      complex: null,
      address: null,
      monthlyRentVnd: null,
    });
    expect(state.complex).toBe("");
    expect(state.address).toBe("");
    expect(state.monthlyRent).toBe("");
  });

  it("사진 슬롯 매핑 — done 상태 + url", () => {
    const state = villaToWizardState({
      ...BASE,
      photos: [
        { space: "EXTERIOR", spaceLabel: null, url: "/uploads/ext.jpg" },
        { space: "BEDROOM", spaceLabel: "1", url: "/uploads/bd1.jpg" },
        { space: "BEDROOM", spaceLabel: "2", url: "/uploads/bd2.jpg" },
        { space: "POOL", spaceLabel: null, url: "https://r2.dev/pool.jpg" },
      ],
    });
    expect(state.photos["exterior"]).toEqual({ status: "done", url: "/uploads/ext.jpg" });
    expect(state.photos["bedroom-1"]).toEqual({ status: "done", url: "/uploads/bd1.jpg" });
    expect(state.photos["bedroom-2"]).toEqual({ status: "done", url: "/uploads/bd2.jpg" });
    expect(state.photos["pool"]).toEqual({ status: "done", url: "https://r2.dev/pool.jpg" });
  });

  it("슬롯에 없는 사진(초과 침실·ETC)은 drop — 무손실 아님, 의도된 동작", () => {
    const state = villaToWizardState({
      ...BASE,
      bedrooms: 2,
      photos: [
        { space: "BEDROOM", spaceLabel: "1", url: "/uploads/bd1.jpg" },
        { space: "BEDROOM", spaceLabel: "3", url: "/uploads/bd3.jpg" }, // drop
        { space: "ETC", spaceLabel: null, url: "/uploads/etc.jpg" }, // drop
      ],
    });
    expect(state.photos["bedroom-1"]).toBeDefined();
    expect(state.photos["bedroom-3"]).toBeUndefined();
    expect(Object.keys(state.photos)).toEqual(["bedroom-1"]);
  });

  it("rate 누락 시즌은 빈 문자열", () => {
    const state = villaToWizardState({
      ...BASE,
      rates: [{ season: "LOW", supplierCostVnd: "1000000" }],
    });
    expect(state.rates).toEqual({ LOW: "1000000", SHOULDER: "", HIGH: "", PEAK: "" });
  });

  it("비품 없으면 customAmenities는 빈 배열", () => {
    const state = villaToWizardState({ ...BASE, amenities: [] });
    expect(state.customAmenities).toEqual([]);
  });
});

describe("잠자리 파생 — deriveWizardScalars (서버 lib/bedding 규칙과 동일)", () => {
  const room = (
    beds: BedroomCardState["beds"],
    capacity: number,
    bathroomCount: number
  ): BedroomCardState => ({ id: "x", beds, capacity, capacityManual: false, bathroomCount });

  it("방 3개(전용욕실 각 1·킹1) + 공용욕실 1 → 침실3·욕실4·인원6", () => {
    const rooms = [
      room([{ bedType: "KING", bedCount: 1 }], 2, 1),
      room([{ bedType: "KING", bedCount: 1 }], 2, 1),
      room([{ bedType: "KING", bedCount: 1 }], 2, 1),
    ];
    expect(deriveWizardScalars(rooms, 1)).toEqual({ bedrooms: 3, bathrooms: 4, maxGuests: 6 });
  });

  it("capacity 합 50 초과는 50 클램프", () => {
    const rooms = Array.from({ length: 10 }, () =>
      room([{ bedType: "KING", bedCount: 3 }], 6, 1)
    );
    expect(deriveWizardScalars(rooms, 0).maxGuests).toBe(50);
  });

  it("전용욕실 0·공용 0이어도 bathrooms min 1 불변식", () => {
    expect(deriveWizardScalars([room([{ bedType: "SINGLE", bedCount: 1 }], 1, 0)], 0).bathrooms).toBe(1);
  });

  it("autoRoomCapacity — KING/QUEEN/DOUBLE/BUNK=2·SINGLE/TWIN=1", () => {
    expect(autoRoomCapacity([{ bedType: "KING", bedCount: 1 }, { bedType: "SINGLE", bedCount: 2 }])).toBe(4);
    expect(autoRoomCapacity([{ bedType: "BUNK", bedCount: 1 }])).toBe(2);
  });
});

describe("잠자리 전송 payload — buildBedroomDetails", () => {
  it("roomIndex=배열순서·roomLabel=null·capacity/bathroomCount는 방 단위 동일", () => {
    const rooms: BedroomCardState[] = [
      {
        id: "a",
        beds: [
          { bedType: "KING", bedCount: 1 },
          { bedType: "SINGLE", bedCount: 2 },
        ],
        capacity: 4,
        capacityManual: false,
        bathroomCount: 2,
      },
      { ...defaultRoom(), capacity: 2, bathroomCount: 1 },
    ];
    const details = buildBedroomDetails(rooms);
    // 방1은 침대 2행(같은 roomIndex), 방2는 1행
    expect(details).toEqual([
      { roomIndex: 1, roomLabel: null, bedType: "KING", bedCount: 1, capacity: 4, bathroomCount: 2 },
      { roomIndex: 1, roomLabel: null, bedType: "SINGLE", bedCount: 2, capacity: 4, bathroomCount: 2 },
      { roomIndex: 2, roomLabel: null, bedType: "KING", bedCount: 1, capacity: 2, bathroomCount: 1 },
    ]);
  });
});

describe("villaToWizardState — 잠자리 구성·셀링포인트·판매정보 prefill", () => {
  it("bedroomDetails → 방 카드(그룹화)·features·신규 필드 복원", () => {
    const state = villaToWizardState({
      ...BASE,
      bedrooms: 2,
      bathrooms: 3,
      commonBathrooms: 1,
      bedroomDetails: [
        { roomIndex: 1, roomLabel: null, bedType: "KING", bedCount: 1, capacity: 2, bathroomCount: 1 },
        { roomIndex: 1, roomLabel: null, bedType: "SINGLE", bedCount: 1, capacity: 2, bathroomCount: 1 },
        { roomIndex: 2, roomLabel: null, bedType: "QUEEN", bedCount: 1, capacity: 2, bathroomCount: 1 },
      ],
      features: [
        { category: "VIEW", featureKey: "viewSea" },
        { category: "FACILITY", featureKey: "privatePool" },
      ],
      googleMapUrl: "https://maps.app.goo.gl/abc",
      beachDistanceM: 300,
      wifiSsid: "VILLA_5G",
      wifiPassword: "secret123",
      accessType: "SMARTKEY",
      accessInfo: "도어코드 1234#",
    });
    // 방 2개로 그룹화, 방1은 침대 2행
    expect(state.rooms.length).toBe(2);
    expect(state.rooms[0].beds).toEqual([
      { bedType: "KING", bedCount: 1 },
      { bedType: "SINGLE", bedCount: 1 },
    ]);
    expect(state.commonBathrooms).toBe(1);
    // 파생 스칼라 재계산: 전용 1+1 + 공용 1 = 3, capacity 2+2 = 4
    expect(state.bedrooms).toBe(2);
    expect(state.bathrooms).toBe(3);
    expect(state.maxGuests).toBe(4);
    expect(state.features).toEqual(["viewSea", "privatePool"]);
    expect(state.googleMapUrl).toBe("https://maps.app.goo.gl/abc");
    expect(state.beachDistanceM).toBe(300);
    expect(state.wifiSsid).toBe("VILLA_5G");
    expect(state.wifiPassword).toBe("secret123");
    expect(state.accessType).toBe("SMARTKEY");
    expect(state.accessInfo).toBe("도어코드 1234#");
  });

  it("bedroomDetails 없는 레거시 빌라 → 스칼라로 방 합성(전용욕실 분배)", () => {
    const state = villaToWizardState({ ...BASE, bedrooms: 3, bathrooms: 2, maxGuests: 6, hasPool: false });
    expect(state.rooms.length).toBe(3);
    // 욕실 2 → 앞 2방 전용 1씩, 3번째 0 (공용 0)
    expect(state.rooms.map((r) => r.bathroomCount)).toEqual([1, 1, 0]);
    expect(state.commonBathrooms).toBe(0);
    expect(state.bedrooms).toBe(3);
    // ★ 파생 스칼라 == 원본 스칼라 (반감 없음)
    expect(state.bathrooms).toBe(2);
    expect(state.maxGuests).toBe(6);
  });

  it("QA P2 재현 — 레거시 2방·욕실4·인원8 재제출: bathrooms·maxGuests 반감 없이 보존", () => {
    // 증상(수정 전): 방2(각 전용1·킹1 cap2) 합성 → bathrooms=2·maxGuests=4로 조용히 반감.
    // 수정 후: 잔여 욕실 공용 승격 + capacity 분배로 파생값이 원본과 정확히 일치.
    const state = villaToWizardState({ ...BASE, bedrooms: 2, bathrooms: 4, maxGuests: 8 });
    expect(state.rooms.length).toBe(2);
    // 전용 1/방(합 2) + 잔여 2는 공용 승격 → 파생 bathrooms = 2 + 2 = 4
    expect(state.rooms.map((r) => r.bathroomCount)).toEqual([1, 1]);
    expect(state.commonBathrooms).toBe(2);
    expect(state.bathrooms).toBe(4);
    // capacity 8을 2방에 분배(4·4) → 파생 maxGuests = 8. 전 방 capacity 채워짐(수동 고정).
    expect(state.rooms.map((r) => r.capacity)).toEqual([4, 4]);
    expect(state.rooms.every((r) => r.capacityManual)).toBe(true);
    expect(state.maxGuests).toBe(8);
  });

  it("레거시 합성 capacity 분배 — 나머지는 앞방부터 +1", () => {
    // maxGuests 7, 방 3개 → floor 2 + 나머지 1 → [3, 2, 2] 합 7
    const state = villaToWizardState({ ...BASE, bedrooms: 3, bathrooms: 3, maxGuests: 7 });
    expect(state.rooms.map((r) => r.capacity)).toEqual([3, 2, 2]);
    expect(state.maxGuests).toBe(7);
  });

  it("잘못된 accessType는 미선택('')으로 방어", () => {
    const state = villaToWizardState({ ...BASE, accessType: "BADVALUE" });
    expect(state.accessType).toBe("");
  });
});

describe("villaToWizardState — 직접입력(custom) prefill", () => {
  it("custom 행은 customAmenities 배열로, 사전 항목은 amenities 맵으로 분리", () => {
    const state = villaToWizardState({
      ...BASE,
      amenities: [
        { category: "KITCHEN", itemKey: "kettle", quantity: 2 },
        { category: "KITCHEN", itemKey: "custom", quantity: 3, customLabel: "Máy pha cà phê" },
        { category: "BATHROOM", itemKey: "custom", quantity: 1, customLabel: "Cân điện tử" },
        { category: "APPLIANCE", itemKey: "custom", quantity: 4, customLabel: "Máy chiếu" },
      ],
    });
    // 사전 항목만 맵에 — custom은 맵에 절대 들어가지 않음(키 충돌 방지)
    expect(state.amenities).toEqual({ "KITCHEN:kettle": 2 });
    expect(state.amenities["KITCHEN:custom"]).toBeUndefined();
    // custom은 순서 유지, category·label·quantity 정확 복원
    expect(state.customAmenities).toEqual([
      { category: "KITCHEN", label: "Máy pha cà phê", quantity: 3 },
      { category: "BATHROOM", label: "Cân điện tử", quantity: 1 },
      { category: "APPLIANCE", label: "Máy chiếu", quantity: 4 },
    ]);
  });

  it("customLabel 없거나 공백뿐인 custom 행은 건너뜀", () => {
    const state = villaToWizardState({
      ...BASE,
      amenities: [
        { category: "KITCHEN", itemKey: "custom", quantity: 1, customLabel: null },
        { category: "KITCHEN", itemKey: "custom", quantity: 1, customLabel: "   " },
        { category: "KITCHEN", itemKey: "custom", quantity: 2, customLabel: "  Nồi chiên không dầu  " },
      ],
    });
    // 유효한 한 건만, 라벨 trim
    expect(state.customAmenities).toEqual([
      { category: "KITCHEN", label: "Nồi chiên không dầu", quantity: 2 },
    ]);
  });

  it("허용 카테고리(KITCHEN·BATHROOM·APPLIANCE)가 아닌 custom은 제외(MINIBAR 등)", () => {
    const state = villaToWizardState({
      ...BASE,
      amenities: [
        { category: "MINIBAR", itemKey: "custom", quantity: 5, customLabel: "Rượu vang" },
        { category: "APPLIANCE", itemKey: "custom", quantity: 1, customLabel: "Robot hút bụi" },
      ],
    });
    expect(state.customAmenities).toEqual([
      { category: "APPLIANCE", label: "Robot hút bụi", quantity: 1 },
    ]);
  });

  it("custom quantity 0 이하는 최소 1로 보정", () => {
    const state = villaToWizardState({
      ...BASE,
      amenities: [{ category: "KITCHEN", itemKey: "custom", quantity: 0, customLabel: "Lò nướng" }],
    });
    expect(state.customAmenities).toEqual([
      { category: "KITCHEN", label: "Lò nướng", quantity: 1 },
    ]);
  });
});
