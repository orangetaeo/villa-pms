// lib/seo/villa-i18n.ts — 공개 빌라·패싯 화면 문구 5개 언어 사전 (ADR-0050 §5, 순수 모듈)
//
// ★ blog-i18n(글 chrome)과 분리한다 — 변경 사유가 다르고 키가 빌라 전용(스펙·칩·규칙·패싯)이다.
// ★ 공용 chrome(상담·위치·대략위치 안내·푸터·개인정보)은 blog-i18n(blogStrings)을 재사용한다 — 여기 두지 않는다.
// ★ next/headers·prisma import 금지(순수) — 서버 컴포넌트가 import한다.
// ★ FEATURE 라벨 12키의 **단일 소스**(featureLabels) — villa/[slug]·facet-nav의 FEATURE_KO 중복 2곳 +
//   HomeStrings.features 6키를 여기로 통합했다. 러시아어 수사 굴절은 public-i18n의 ruPlural을 재사용.
import { ruPlural, type PublicLocale } from "@/lib/seo/public-i18n";

// ── 조건(feature) 라벨 — 12키 단일 소스(FEATURE_ITEMS의 featureKey와 1:1) ─────────────
const FEATURE_LABELS: Record<PublicLocale, Record<string, string>> = {
  ko: {
    viewSea: "바다뷰",
    viewMountain: "마운틴뷰",
    viewCity: "시티뷰",
    bbq: "BBQ",
    elevator: "엘리베이터",
    generator: "발전기",
    kidsPool: "키즈풀",
    privatePool: "프라이빗 풀",
    gym: "헬스장",
    golfNearby: "골프장 인근",
    beachFront: "해변 바로앞",
    marketNearby: "시장 인근",
  },
  en: {
    viewSea: "Sea view",
    viewMountain: "Mountain view",
    viewCity: "City view",
    bbq: "BBQ",
    elevator: "Elevator",
    generator: "Generator",
    kidsPool: "Kids pool",
    privatePool: "Private pool",
    gym: "Gym",
    golfNearby: "Near golf",
    beachFront: "Beachfront",
    marketNearby: "Near market",
  },
  vi: {
    viewSea: "View biển",
    viewMountain: "View núi",
    viewCity: "View thành phố",
    bbq: "BBQ",
    elevator: "Thang máy",
    generator: "Máy phát điện",
    kidsPool: "Hồ trẻ em",
    privatePool: "Hồ bơi riêng",
    gym: "Phòng gym",
    golfNearby: "Gần sân golf",
    beachFront: "Sát biển",
    marketNearby: "Gần chợ",
  },
  ru: {
    viewSea: "Вид на море",
    viewMountain: "Вид на горы",
    viewCity: "Вид на город",
    bbq: "Барбекю",
    elevator: "Лифт",
    generator: "Генератор",
    kidsPool: "Детский бассейн",
    privatePool: "Свой бассейн",
    gym: "Спортзал",
    golfNearby: "Рядом гольф",
    beachFront: "У пляжа",
    marketNearby: "Рядом рынок",
  },
  zh: {
    viewSea: "海景",
    viewMountain: "山景",
    viewCity: "城市景",
    bbq: "烧烤",
    elevator: "电梯",
    generator: "发电机",
    kidsPool: "儿童泳池",
    privatePool: "私人泳池",
    gym: "健身房",
    golfNearby: "近高尔夫",
    beachFront: "海滩旁",
    marketNearby: "近市场",
  },
};

/** 로케일별 조건 라벨 사전(12키). 알 수 없는 locale은 ko. */
export function featureLabels(locale: PublicLocale): Record<string, string> {
  return FEATURE_LABELS[locale] ?? FEATURE_LABELS.ko;
}

// ── 사진 공간(PhotoSpace enum) 라벨 — 비-ko alt용(자유텍스트 spaceLabel(ko) 대신 enum 사전) ───
const SPACE_LABELS: Record<PublicLocale, Record<string, string>> = {
  ko: { EXTERIOR: "외관", LIVING: "거실", KITCHEN: "주방", BEDROOM: "침실", BATHROOM: "욕실", BALCONY: "베란다", POOL: "수영장", ETC: "" },
  en: { EXTERIOR: "Exterior", LIVING: "Living room", KITCHEN: "Kitchen", BEDROOM: "Bedroom", BATHROOM: "Bathroom", BALCONY: "Balcony", POOL: "Pool", ETC: "" },
  vi: { EXTERIOR: "Ngoại thất", LIVING: "Phòng khách", KITCHEN: "Bếp", BEDROOM: "Phòng ngủ", BATHROOM: "Phòng tắm", BALCONY: "Ban công", POOL: "Hồ bơi", ETC: "" },
  ru: { EXTERIOR: "Фасад", LIVING: "Гостиная", KITCHEN: "Кухня", BEDROOM: "Спальня", BATHROOM: "Ванная", BALCONY: "Балкон", POOL: "Бассейн", ETC: "" },
  zh: { EXTERIOR: "外观", LIVING: "客厅", KITCHEN: "厨房", BEDROOM: "卧室", BATHROOM: "浴室", BALCONY: "阳台", POOL: "泳池", ETC: "" },
};

/** 로케일별 사진 공간 라벨(PhotoSpace enum → 표시명). 알 수 없는 space는 빈 문자열. */
export function spaceLabel(locale: PublicLocale, space: string): string {
  return (SPACE_LABELS[locale] ?? SPACE_LABELS.ko)[space] ?? "";
}

// ── 빌라·패싯 화면 문구 ──────────────────────────────────────────────────────
export interface VillaStrings {
  // 스펙 라벨(상세)
  specBedrooms: string;
  specBathrooms: string;
  specMaxGuests: string;
  specArea: string;
  specFloors: string;
  specBeach: string;
  specParking: string;
  specCheckInOut: string;
  // 스펙 값
  countRooms: (n: number) => string;
  guestsValue: (n: number) => string;
  areaValue: (n: number) => string;
  floorsValue: (n: number) => string;
  beachValue: (n: number) => string;
  parkingValue: (n: number) => string;
  // 칩(상세)
  chipPool: string;
  chipBreakfast: string;
  chipExtraBed: string;
  // 칩(목록 카드)
  bedroomsChip: (n: number) => string;
  maxGuestsChip: (n: number) => string;
  beachChip: (n: number) => string;
  // 섹션 제목
  introTitle: string;
  photosTitle: string;
  videoTitle: string;
  rulesTitle: string;
  villaCtaTitle: string;
  villaCtaBody: string;
  // 규칙
  ruleSmoking: (ok: boolean) => string;
  rulePets: (ok: boolean) => string;
  ruleParty: (ok: boolean) => string;
  // 목록 공통
  villaCount: (n: number) => string;
  readMore: string;
  listEmpty: string;
  listEmptyCta: string;
  exteriorAlt: string;
  // villas 인덱스
  villasH1: string;
  villasIntro: string;
  villasMetaTitle: string;
  villasMetaDesc: string;
  // 패싯 나브
  facetKindLabels: Record<string, string>;
  guestsAtLeast: (n: number) => string;
  bedroomsAtLeast: (n: number) => string;
  // 패싯 페이지(title/intro/meta)
  areaTitle: (name: string) => string;
  areaIntro: (name: string) => string;
  areaMetaTitle: (name: string, count: number) => string;
  areaMetaDesc: (name: string) => string;
  areaNotFound: string;
  featureTitle: (label: string) => string;
  featureIntro: (label: string) => string;
  featureMetaTitle: (label: string, count: number) => string;
  featureMetaDesc: (label: string) => string;
  guestsTitle: (n: number) => string;
  guestsIntro: (n: number) => string;
  guestsMetaTitle: (n: number, count: number) => string;
  guestsMetaDesc: (n: number) => string;
  bedroomsTitle: (n: number) => string;
  bedroomsIntro: (n: number) => string;
  bedroomsMetaTitle: (n: number, count: number) => string;
  bedroomsMetaDesc: (n: number) => string;
  facetNotFound: string;
  // villa 상세 meta
  villaNotFound: string;
  villaMetaTitle: (label: string, maxGuests: number) => string;
  villaMetaDescFallback: (label: string, bedrooms: number, maxGuests: number) => string;
}

const ko: VillaStrings = {
  specBedrooms: "침실",
  specBathrooms: "욕실",
  specMaxGuests: "최대 인원",
  specArea: "면적",
  specFloors: "층수",
  specBeach: "해변까지",
  specParking: "주차",
  specCheckInOut: "체크인 / 체크아웃",
  countRooms: (n) => `${n}개`,
  guestsValue: (n) => `${n}인`,
  areaValue: (n) => `${n}㎡`,
  floorsValue: (n) => `${n}층`,
  beachValue: (n) => `약 ${n}m`,
  parkingValue: (n) => `${n}대`,
  chipPool: "수영장",
  chipBreakfast: "조식 가능",
  chipExtraBed: "엑스트라베드",
  bedroomsChip: (n) => `침실 ${n}`,
  maxGuestsChip: (n) => `최대 ${n}인`,
  beachChip: (n) => `해변 ${n}m`,
  introTitle: "빌라 소개",
  photosTitle: "사진",
  videoTitle: "영상으로 보기",
  rulesTitle: "이용 규칙",
  villaCtaTitle: "이 빌라가 마음에 드세요?",
  villaCtaBody: "인원과 일정을 알려주시면 이용 가능 여부와 견적을 함께 보내드립니다.",
  ruleSmoking: (ok) => `흡연 ${ok ? "가능" : "불가"}`,
  rulePets: (ok) => `반려동물 ${ok ? "동반 가능" : "동반 불가"}`,
  ruleParty: (ok) => `파티 ${ok ? "가능" : "불가"}`,
  villaCount: (n) => `빌라 ${n}곳`,
  readMore: "자세히 보기 →",
  listEmpty: "조건에 맞는 빌라를 준비 중입니다.",
  listEmptyCta: "원하는 조건을 알려주시면 찾아드릴게요",
  exteriorAlt: "외관",
  villasH1: "푸꾸옥 빌라",
  villasIntro:
    "현지에서 직접 운영하고 청소 검수를 통과한 빌라만 안내합니다. 날짜별 이용 가능 여부와 견적은 상담으로 확인해드립니다.",
  villasMetaTitle: "푸꾸옥 빌라 전체 목록 | Villa GO",
  villasMetaDesc: "현지에서 직접 운영·검수하는 푸꾸옥 빌라를 인원·시설 조건으로 찾아보세요.",
  facetKindLabels: {
    area: "지역으로 찾기",
    feature: "시설·특징으로 찾기",
    guests: "인원으로 찾기",
    bedrooms: "침실 수로 찾기",
    areaFeature: "지역 × 시설",
  },
  guestsAtLeast: (n) => `${n}인 이상`,
  bedroomsAtLeast: (n) => `침실 ${n}개 이상`,
  areaTitle: (name) => `푸꾸옥 ${name} 빌라`,
  areaIntro: (name) =>
    `${name} 단지에서 운영 중인 빌라입니다. 같은 단지라도 침실 수와 시설이 달라 인원과 일정에 맞춰 고르는 편이 좋습니다.`,
  areaMetaTitle: (name, count) => `푸꾸옥 ${name} 빌라 ${count}곳 | Villa GO`,
  areaMetaDesc: (name) => `푸꾸옥 ${name} 단지의 빌라를 인원·시설 조건으로 골라보세요. 현지에서 직접 운영·검수합니다.`,
  areaNotFound: "찾을 수 없는 지역 | Villa GO",
  featureTitle: (label) => `${label} 푸꾸옥 빌라`,
  featureIntro: (label) =>
    `${label} 조건을 갖춘 빌라입니다. 같은 조건이라도 규모와 위치가 달라 실제 사진과 구성을 함께 확인하시는 편이 좋습니다.`,
  featureMetaTitle: (label, count) => `${label} 푸꾸옥 빌라 ${count}곳 | Villa GO`,
  featureMetaDesc: (label) => `${label} 조건을 갖춘 푸꾸옥 빌라 모음. 인원과 일정에 맞춰 견적을 받아보세요.`,
  guestsTitle: (n) => `${n}인 이상 푸꾸옥 빌라`,
  guestsIntro: (n) =>
    `${n}명 이상이 함께 묵을 수 있는 빌라입니다. 인원이 많을수록 침실 구성과 침대 종류를 먼저 확인하는 편이 좋습니다.`,
  guestsMetaTitle: (n, count) => `${n}인 이상 푸꾸옥 빌라 ${count}곳 | Villa GO`,
  guestsMetaDesc: (n) => `${n}명 이상이 함께 묵을 수 있는 푸꾸옥 빌라. 방 배정과 동선까지 상담으로 도와드립니다.`,
  bedroomsTitle: (n) => `침실 ${n}개 이상 푸꾸옥 빌라`,
  bedroomsIntro: (n) =>
    `침실이 ${n}개 이상인 빌라입니다. 같은 침실 수라도 침대 구성과 전용 욕실 유무가 달라 실제 수용 인원이 다를 수 있습니다.`,
  bedroomsMetaTitle: (n, count) => `침실 ${n}개 이상 푸꾸옥 빌라 ${count}곳 | Villa GO`,
  bedroomsMetaDesc: (n) => `침실 ${n}개 이상 푸꾸옥 빌라 모음. 가족·단체 여행에 맞는 구성을 골라보세요.`,
  facetNotFound: "찾을 수 없는 조건 | Villa GO",
  villaNotFound: "찾을 수 없는 빌라 | Villa GO",
  villaMetaTitle: (label, maxGuests) => `${label} · 최대 ${maxGuests}인 | Villa GO`,
  villaMetaDescFallback: (label, bedrooms, maxGuests) => `${label}. 침실 ${bedrooms}개, 최대 ${maxGuests}인.`,
};

const en: VillaStrings = {
  specBedrooms: "Bedrooms",
  specBathrooms: "Bathrooms",
  specMaxGuests: "Max guests",
  specArea: "Area",
  specFloors: "Floors",
  specBeach: "To the beach",
  specParking: "Parking",
  specCheckInOut: "Check-in / Check-out",
  countRooms: (n) => `${n}`,
  guestsValue: (n) => `${n}`,
  areaValue: (n) => `${n}㎡`,
  floorsValue: (n) => `${n}`,
  beachValue: (n) => `~${n}m`,
  parkingValue: (n) => `${n}`,
  chipPool: "Pool",
  chipBreakfast: "Breakfast",
  chipExtraBed: "Extra bed",
  bedroomsChip: (n) => `${n} ${n === 1 ? "bedroom" : "bedrooms"}`,
  maxGuestsChip: (n) => `Up to ${n}`,
  beachChip: (n) => `Beach ${n}m`,
  introTitle: "About the villa",
  photosTitle: "Photos",
  videoTitle: "Watch the video",
  rulesTitle: "House rules",
  villaCtaTitle: "Like this villa?",
  villaCtaBody: "Tell us your group and dates, and we'll send availability and a quote.",
  ruleSmoking: (ok) => `Smoking ${ok ? "allowed" : "not allowed"}`,
  rulePets: (ok) => `Pets ${ok ? "allowed" : "not allowed"}`,
  ruleParty: (ok) => `Parties ${ok ? "allowed" : "not allowed"}`,
  villaCount: (n) => `${n} ${n === 1 ? "villa" : "villas"}`,
  readMore: "See details →",
  listEmpty: "We're preparing villas that match.",
  listEmptyCta: "Tell us what you're looking for and we'll find it",
  exteriorAlt: "Exterior",
  villasH1: "Phu Quoc villas",
  villasIntro:
    "We only list villas we operate and inspect on the ground. Availability by date and quotes are handled in chat.",
  villasMetaTitle: "All Phu Quoc villas | Villa GO",
  villasMetaDesc: "Browse Phu Quoc villas we operate and inspect on the ground by group size and amenities.",
  facetKindLabels: {
    area: "Find by area",
    feature: "Find by feature",
    guests: "Find by group size",
    bedrooms: "Find by bedrooms",
    areaFeature: "Area × feature",
  },
  guestsAtLeast: (n) => `${n}+ guests`,
  bedroomsAtLeast: (n) => `${n}+ bedrooms`,
  areaTitle: (name) => `Phu Quoc ${name} villas`,
  areaIntro: (name) =>
    `Villas in the ${name} area. Even within one complex, bedrooms and amenities differ — pick by your group and dates.`,
  areaMetaTitle: (name, count) => `Phu Quoc ${name} villas (${count}) | Villa GO`,
  areaMetaDesc: (name) => `Phu Quoc ${name} villas by group size and amenities. Operated and inspected on the ground.`,
  areaNotFound: "Area not found | Villa GO",
  featureTitle: (label) => `Phu Quoc villas — ${label}`,
  featureIntro: (label) =>
    `Villas with ${label}. Size and location still vary, so check the actual photos and layout too.`,
  featureMetaTitle: (label, count) => `Phu Quoc villas — ${label} (${count}) | Villa GO`,
  featureMetaDesc: (label) => `Phu Quoc villas with ${label}. Get a quote to match your group and dates.`,
  guestsTitle: (n) => `Phu Quoc villas for ${n}+ guests`,
  guestsIntro: (n) =>
    `Villas that sleep ${n} or more. The more guests, the more the bedroom and bed layout matters — check those first.`,
  guestsMetaTitle: (n, count) => `Phu Quoc villas for ${n}+ guests (${count}) | Villa GO`,
  guestsMetaDesc: (n) => `Phu Quoc villas that sleep ${n} or more. We help with room allocation in chat.`,
  bedroomsTitle: (n) => `Phu Quoc villas with ${n}+ bedrooms`,
  bedroomsIntro: (n) =>
    `Villas with ${n} or more bedrooms. Bed layout and en-suite bathrooms differ, so real capacity can vary.`,
  bedroomsMetaTitle: (n, count) => `Phu Quoc villas with ${n}+ bedrooms (${count}) | Villa GO`,
  bedroomsMetaDesc: (n) => `Phu Quoc villas with ${n}+ bedrooms. Pick a layout that fits your family or group.`,
  facetNotFound: "Not found | Villa GO",
  villaNotFound: "Villa not found | Villa GO",
  villaMetaTitle: (label, maxGuests) => `${label} · up to ${maxGuests} guests | Villa GO`,
  villaMetaDescFallback: (label, bedrooms, maxGuests) =>
    `${label}. ${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}, up to ${maxGuests} guests.`,
};

const vi: VillaStrings = {
  specBedrooms: "Phòng ngủ",
  specBathrooms: "Phòng tắm",
  specMaxGuests: "Số khách tối đa",
  specArea: "Diện tích",
  specFloors: "Số tầng",
  specBeach: "Tới biển",
  specParking: "Đỗ xe",
  specCheckInOut: "Nhận phòng / Trả phòng",
  countRooms: (n) => `${n}`,
  guestsValue: (n) => `${n}`,
  areaValue: (n) => `${n}㎡`,
  floorsValue: (n) => `${n}`,
  beachValue: (n) => `~${n}m`,
  parkingValue: (n) => `${n}`,
  chipPool: "Hồ bơi",
  chipBreakfast: "Bữa sáng",
  chipExtraBed: "Giường phụ",
  bedroomsChip: (n) => `${n} phòng ngủ`,
  maxGuestsChip: (n) => `Tối đa ${n}`,
  beachChip: (n) => `Biển ${n}m`,
  introTitle: "Giới thiệu biệt thự",
  photosTitle: "Hình ảnh",
  videoTitle: "Xem video",
  rulesTitle: "Nội quy",
  villaCtaTitle: "Bạn thích biệt thự này?",
  villaCtaBody: "Cho biết số khách và ngày, chúng tôi gửi tình trạng phòng và báo giá.",
  ruleSmoking: (ok) => `Hút thuốc: ${ok ? "được phép" : "không được phép"}`,
  rulePets: (ok) => `Thú cưng: ${ok ? "được phép" : "không được phép"}`,
  ruleParty: (ok) => `Tiệc: ${ok ? "được phép" : "không được phép"}`,
  villaCount: (n) => `${n} biệt thự`,
  readMore: "Xem chi tiết →",
  listEmpty: "Chúng tôi đang chuẩn bị biệt thự phù hợp.",
  listEmptyCta: "Cho biết nhu cầu, chúng tôi sẽ tìm giúp bạn",
  exteriorAlt: "Ngoại thất",
  villasH1: "Biệt thự Phú Quốc",
  villasIntro:
    "Chỉ giới thiệu biệt thự do chúng tôi vận hành và kiểm tra tại chỗ. Tình trạng phòng theo ngày và báo giá được xử lý qua chat.",
  villasMetaTitle: "Toàn bộ biệt thự Phú Quốc | Villa GO",
  villasMetaDesc: "Chọn biệt thự Phú Quốc do chúng tôi vận hành và kiểm tra theo số khách và tiện nghi.",
  facetKindLabels: {
    area: "Tìm theo khu vực",
    feature: "Tìm theo tiện ích",
    guests: "Tìm theo số khách",
    bedrooms: "Tìm theo số phòng ngủ",
    areaFeature: "Khu vực × tiện ích",
  },
  guestsAtLeast: (n) => `${n}+ khách`,
  bedroomsAtLeast: (n) => `${n}+ phòng ngủ`,
  areaTitle: (name) => `Biệt thự ${name} Phú Quốc`,
  areaIntro: (name) =>
    `Biệt thự tại khu ${name}. Cùng một khu nhưng số phòng ngủ và tiện nghi khác nhau — hãy chọn theo số khách và ngày.`,
  areaMetaTitle: (name, count) => `Biệt thự ${name} Phú Quốc (${count}) | Villa GO`,
  areaMetaDesc: (name) => `Biệt thự khu ${name} Phú Quốc theo số khách và tiện nghi. Vận hành và kiểm tra tại chỗ.`,
  areaNotFound: "Không tìm thấy khu vực | Villa GO",
  featureTitle: (label) => `Biệt thự Phú Quốc — ${label}`,
  featureIntro: (label) =>
    `Biệt thự có ${label}. Quy mô và vị trí vẫn khác nhau, nên hãy xem ảnh và bố cục thực tế.`,
  featureMetaTitle: (label, count) => `Biệt thự Phú Quốc — ${label} (${count}) | Villa GO`,
  featureMetaDesc: (label) => `Biệt thự Phú Quốc có ${label}. Nhận báo giá theo số khách và ngày.`,
  guestsTitle: (n) => `Biệt thự Phú Quốc cho ${n}+ khách`,
  guestsIntro: (n) =>
    `Biệt thự chứa được ${n} khách trở lên. Càng đông càng nên xem trước bố cục phòng ngủ và loại giường.`,
  guestsMetaTitle: (n, count) => `Biệt thự Phú Quốc cho ${n}+ khách (${count}) | Villa GO`,
  guestsMetaDesc: (n) => `Biệt thự Phú Quốc chứa được ${n} khách trở lên. Hỗ trợ phân phòng qua chat.`,
  bedroomsTitle: (n) => `Biệt thự Phú Quốc ${n}+ phòng ngủ`,
  bedroomsIntro: (n) =>
    `Biệt thự có ${n} phòng ngủ trở lên. Bố cục giường và phòng tắm riêng khác nhau nên sức chứa thực tế có thể khác.`,
  bedroomsMetaTitle: (n, count) => `Biệt thự Phú Quốc ${n}+ phòng ngủ (${count}) | Villa GO`,
  bedroomsMetaDesc: (n) => `Biệt thự Phú Quốc ${n}+ phòng ngủ. Chọn bố cục phù hợp cho gia đình hoặc nhóm.`,
  facetNotFound: "Không tìm thấy | Villa GO",
  villaNotFound: "Không tìm thấy biệt thự | Villa GO",
  villaMetaTitle: (label, maxGuests) => `${label} · tối đa ${maxGuests} khách | Villa GO`,
  villaMetaDescFallback: (label, bedrooms, maxGuests) => `${label}. ${bedrooms} phòng ngủ, tối đa ${maxGuests} khách.`,
};

const ru: VillaStrings = {
  specBedrooms: "Спальни",
  specBathrooms: "Ванные",
  specMaxGuests: "Макс. гостей",
  specArea: "Площадь",
  specFloors: "Этажи",
  specBeach: "До пляжа",
  specParking: "Парковка",
  specCheckInOut: "Заезд / Выезд",
  countRooms: (n) => `${n}`,
  guestsValue: (n) => `${n}`,
  areaValue: (n) => `${n}㎡`,
  floorsValue: (n) => `${n}`,
  beachValue: (n) => `~${n}m`,
  parkingValue: (n) => `${n}`,
  chipPool: "Бассейн",
  chipBreakfast: "Завтрак",
  chipExtraBed: "Доп. кровать",
  bedroomsChip: (n) => `${n} ${ruPlural(n, "спальня", "спальни", "спален")}`,
  maxGuestsChip: (n) => `До ${n}`,
  beachChip: (n) => `Пляж ${n}m`,
  introTitle: "О вилле",
  photosTitle: "Фото",
  videoTitle: "Смотреть видео",
  rulesTitle: "Правила",
  villaCtaTitle: "Понравилась вилла?",
  villaCtaBody: "Сообщите состав группы и даты — пришлём наличие и цену.",
  ruleSmoking: (ok) => `Курение: ${ok ? "разрешено" : "запрещено"}`,
  rulePets: (ok) => `Питомцы: ${ok ? "разрешены" : "запрещены"}`,
  ruleParty: (ok) => `Вечеринки: ${ok ? "разрешены" : "запрещены"}`,
  villaCount: (n) => `${n} ${ruPlural(n, "вилла", "виллы", "вилл")}`,
  readMore: "Подробнее →",
  listEmpty: "Мы подбираем подходящие виллы.",
  listEmptyCta: "Расскажите, что нужно, и мы найдём",
  exteriorAlt: "Фасад",
  villasH1: "Виллы на Фукуоке",
  villasIntro:
    "Показываем только виллы, которыми управляем и которые проверяем на месте. Наличие по датам и цены — в чате.",
  villasMetaTitle: "Все виллы на Фукуоке | Villa GO",
  villasMetaDesc: "Виллы на Фукуоке, которыми мы управляем и которые проверяем, — по числу гостей и удобствам.",
  facetKindLabels: {
    area: "Поиск по району",
    feature: "Поиск по удобствам",
    guests: "Поиск по числу гостей",
    bedrooms: "Поиск по спальням",
    areaFeature: "Район × удобство",
  },
  guestsAtLeast: (n) => `${n}+ гостей`,
  bedroomsAtLeast: (n) => `${n}+ ${ruPlural(n, "спальня", "спальни", "спален")}`,
  areaTitle: (name) => `Виллы ${name} на Фукуоке`,
  areaIntro: (name) =>
    `Виллы в районе ${name}. Даже в одном комплексе спальни и удобства отличаются — выбирайте по группе и датам.`,
  areaMetaTitle: (name, count) => `Виллы ${name} на Фукуоке (${count}) | Villa GO`,
  areaMetaDesc: (name) => `Виллы района ${name} на Фукуоке по числу гостей и удобствам. Управляем и проверяем на месте.`,
  areaNotFound: "Район не найден | Villa GO",
  featureTitle: (label) => `Виллы на Фукуоке — ${label}`,
  featureIntro: (label) =>
    `Виллы с удобством «${label}». Размер и расположение всё же отличаются — смотрите реальные фото и планировку.`,
  featureMetaTitle: (label, count) => `Виллы на Фукуоке — ${label} (${count}) | Villa GO`,
  featureMetaDesc: (label) => `Виллы на Фукуоке с удобством «${label}». Запросите цену под вашу группу и даты.`,
  guestsTitle: (n) => `Виллы на Фукуоке на ${n}+ гостей`,
  guestsIntro: (n) =>
    `Виллы, вмещающие ${n} и более гостей. Чем больше гостей, тем важнее планировка спален и тип кроватей.`,
  guestsMetaTitle: (n, count) => `Виллы на Фукуоке на ${n}+ гостей (${count}) | Villa GO`,
  guestsMetaDesc: (n) => `Виллы на Фукуоке на ${n}+ гостей. Поможем с распределением комнат в чате.`,
  bedroomsTitle: (n) => `Виллы на Фукуоке с ${n}+ спальнями`,
  bedroomsIntro: (n) =>
    `Виллы с ${n} и более спальнями. Планировка кроватей и наличие санузлов различаются, поэтому реальная вместимость может отличаться.`,
  bedroomsMetaTitle: (n, count) => `Виллы на Фукуоке с ${n}+ спальнями (${count}) | Villa GO`,
  bedroomsMetaDesc: (n) => `Виллы на Фукуоке с ${n}+ спальнями. Выберите планировку под семью или группу.`,
  facetNotFound: "Не найдено | Villa GO",
  villaNotFound: "Вилла не найдена | Villa GO",
  villaMetaTitle: (label, maxGuests) => `${label} · до ${maxGuests} гостей | Villa GO`,
  villaMetaDescFallback: (label, bedrooms, maxGuests) =>
    `${label}. ${bedrooms} ${ruPlural(bedrooms, "спальня", "спальни", "спален")}, до ${maxGuests} гостей.`,
};

const zh: VillaStrings = {
  specBedrooms: "卧室",
  specBathrooms: "浴室",
  specMaxGuests: "最多入住",
  specArea: "面积",
  specFloors: "楼层",
  specBeach: "到海滩",
  specParking: "停车",
  specCheckInOut: "入住 / 退房",
  countRooms: (n) => `${n}`,
  guestsValue: (n) => `${n}人`,
  areaValue: (n) => `${n}㎡`,
  floorsValue: (n) => `${n}层`,
  beachValue: (n) => `约 ${n}m`,
  parkingValue: (n) => `${n}辆`,
  chipPool: "泳池",
  chipBreakfast: "早餐",
  chipExtraBed: "加床",
  bedroomsChip: (n) => `${n} 间卧室`,
  maxGuestsChip: (n) => `最多 ${n} 人`,
  beachChip: (n) => `海滩 ${n}m`,
  introTitle: "别墅介绍",
  photosTitle: "照片",
  videoTitle: "观看视频",
  rulesTitle: "入住须知",
  villaCtaTitle: "喜欢这套别墅吗？",
  villaCtaBody: "告诉我们人数和日期，我们会发送可订情况和报价。",
  ruleSmoking: (ok) => `吸烟：${ok ? "允许" : "禁止"}`,
  rulePets: (ok) => `宠物：${ok ? "允许" : "禁止"}`,
  ruleParty: (ok) => `派对：${ok ? "允许" : "禁止"}`,
  villaCount: (n) => `${n} 套别墅`,
  readMore: "查看详情 →",
  listEmpty: "正在准备符合条件的别墅。",
  listEmptyCta: "告诉我们您的需求，我们来帮您找",
  exteriorAlt: "外观",
  villasH1: "富国岛别墅",
  villasIntro: "只推荐我们在当地直接运营并验收的别墅。按日期的可订情况和报价通过聊天处理。",
  villasMetaTitle: "富国岛别墅全部列表 | Villa GO",
  villasMetaDesc: "按人数和设施浏览我们在当地运营并验收的富国岛别墅。",
  facetKindLabels: {
    area: "按区域查找",
    feature: "按设施查找",
    guests: "按人数查找",
    bedrooms: "按卧室数查找",
    areaFeature: "区域 × 设施",
  },
  guestsAtLeast: (n) => `${n}+ 人`,
  bedroomsAtLeast: (n) => `${n}+ 间卧室`,
  areaTitle: (name) => `富国岛 ${name} 别墅`,
  areaIntro: (name) =>
    `${name} 区域的别墅。即使是同一小区，卧室数和设施也不同——请按人数和日期挑选。`,
  areaMetaTitle: (name, count) => `富国岛 ${name} 别墅（${count}套） | Villa GO`,
  areaMetaDesc: (name) => `按人数和设施挑选富国岛 ${name} 区域的别墅。我们在当地直接运营并验收。`,
  areaNotFound: "未找到该区域 | Villa GO",
  featureTitle: (label) => `富国岛别墅 — ${label}`,
  featureIntro: (label) => `具备${label}的别墅。规模和位置仍有差异，请结合实际照片和布局查看。`,
  featureMetaTitle: (label, count) => `富国岛别墅 — ${label}（${count}套） | Villa GO`,
  featureMetaDesc: (label) => `具备${label}的富国岛别墅。按人数和日期获取报价。`,
  guestsTitle: (n) => `可住 ${n}+ 人的富国岛别墅`,
  guestsIntro: (n) => `可容纳 ${n} 人及以上的别墅。人数越多，越应先确认卧室布局和床型。`,
  guestsMetaTitle: (n, count) => `可住 ${n}+ 人的富国岛别墅（${count}套） | Villa GO`,
  guestsMetaDesc: (n) => `可容纳 ${n} 人及以上的富国岛别墅。房间分配可在聊天中协助。`,
  bedroomsTitle: (n) => `${n}+ 间卧室的富国岛别墅`,
  bedroomsIntro: (n) => `拥有 ${n} 间及以上卧室的别墅。床型布局和独立卫浴不同，实际可住人数可能有差异。`,
  bedroomsMetaTitle: (n, count) => `${n}+ 间卧室的富国岛别墅（${count}套） | Villa GO`,
  bedroomsMetaDesc: (n) => `拥有 ${n} 间及以上卧室的富国岛别墅。为家庭或团队挑选合适布局。`,
  facetNotFound: "未找到 | Villa GO",
  villaNotFound: "未找到别墅 | Villa GO",
  villaMetaTitle: (label, maxGuests) => `${label} · 最多 ${maxGuests} 人 | Villa GO`,
  villaMetaDescFallback: (label, bedrooms, maxGuests) => `${label}。${bedrooms} 间卧室，最多 ${maxGuests} 人。`,
};

const DICT: Record<PublicLocale, VillaStrings> = { ko, en, vi, ru, zh };

/** 로케일별 빌라·패싯 문구 — 알 수 없는 값은 ko. */
export function villaStrings(locale: PublicLocale): VillaStrings {
  return DICT[locale] ?? ko;
}
