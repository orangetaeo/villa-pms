// 공간(PhotoSpace) → Material Symbols 아이콘 매핑 (UX-VN 공급자 화면 공유)
// QA 교정(a11): 거실(LIVING)은 chair 아이콘. 침실은 bed, 욕실은 bathtub.
// i18n 라벨 키는 wizard.photos.* 재사용 — 여기선 아이콘만 정의.

export const SPACE_ICON: Record<string, string> = {
  EXTERIOR: "landscape",
  LIVING: "chair",
  KITCHEN: "soup_kitchen",
  BEDROOM: "bed",
  BATHROOM: "bathtub",
  BALCONY: "balcony",
  POOL: "pool",
  ETC: "image",
};

/** wizard.photos.* 라벨 키 (EXTERIOR/LIVING/KITCHEN/BALCONY/POOL). 침실·욕실은 ICU n 변수 별도 */
export const SPACE_LABEL_KEY: Record<string, string> = {
  EXTERIOR: "exterior",
  LIVING: "living",
  KITCHEN: "kitchen",
  BALCONY: "balcony",
  POOL: "pool",
};

/** 사진 관리 섹션 순서 — 외관→거실→주방→침실→욕실→베란다→수영장 (a12) */
export const PHOTO_SECTION_ORDER = [
  "EXTERIOR",
  "LIVING",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "BALCONY",
  "POOL",
] as const;
