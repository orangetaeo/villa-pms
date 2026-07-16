// lib/public-i18n.ts — 공개 제안 페이지(/p) 5개 언어 딕셔너리 (#5, 1차)
//
// 설계: next-intl 글로벌 설정(ko/vi 전용)을 건드리지 않고, 기존 5개 언어 딕셔너리 모듈 패턴
//   (lib/checkin-sheet-i18n.ts·lib/agreement.ts)을 따른다. /p 서버 컴포넌트가 lang을 해석해
//   PUBLIC_LABELS[lang]를 자식에 주입한다. 클라이언트 컴포넌트는 라벨 slice를 props로 받는다.
//
// 범위: 정적 UI 텍스트만 5개 언어. 빌라명·설명·가격·전화번호 등 동적 데이터는 원문 유지(1차).
// ⚠ ru(러시아어)는 2026-06-25 1차 품질 감수 반영(спал.→спальни, 권한 표현 разрешено 통일,
//   수량 단위 чел./авто 복원). 원어민 최종 감수는 여전히 권장(TODO: ru-native-review).

import type { BedTypeKey } from "@/lib/bedding";

export type PublicLang = "ko" | "en" | "ru" | "zh" | "vi";
export const PUBLIC_LANGS: PublicLang[] = ["ko", "en", "ru", "zh", "vi"];

/** /p 언어 선택 쿠키 — 글로벌 locale 쿠키(ko/vi 전용)와 분리한다. */
export const PUBLIC_LOCALE_COOKIE = "p-locale";

export function isPublicLang(v: string | undefined | null): v is PublicLang {
  return v === "ko" || v === "en" || v === "ru" || v === "zh" || v === "vi";
}

/** 로케일 해석 우선순위: ?lang= 파라미터 > p-locale 쿠키 > 기본 ko(현행 보존). */
export function resolvePublicLang(
  param?: string | null,
  cookie?: string | null
): PublicLang {
  if (isPublicLang(param)) return param;
  if (isPublicLang(cookie)) return cookie;
  return "ko";
}

/** 페이지 <title> (브라우저 탭) — "<페이지> | Villa Go" */
export const PUBLIC_META: Record<PublicLang, { proposal: string; book: string; done: string; roster: string }> = {
  ko: { proposal: "빌라 제안", book: "가예약 신청", done: "가예약 완료", roster: "투숙객 명단 입력" },
  en: { proposal: "Villa Proposal", book: "Reservation Request", done: "Reservation Received", roster: "Enter Guest List" },
  ru: { proposal: "Предложение виллы", book: "Запрос брони", done: "Бронь принята", roster: "Список гостей" },
  zh: { proposal: "别墅提案", book: "预订申请", done: "预订完成", roster: "录入客人名单" },
  vi: { proposal: "Đề xuất biệt thự", book: "Yêu cầu giữ chỗ", done: "Đã nhận giữ chỗ", roster: "Nhập danh sách khách" },
};

/** 언어 선택기 표시용 네이티브 라벨 */
export const PUBLIC_LANG_NATIVE: Record<PublicLang, string> = {
  ko: "한국어",
  en: "English",
  ru: "Русский",
  zh: "中文",
  vi: "Tiếng Việt",
};

// ── 침대·셀링포인트 라벨 (5개 언어) ─────────────────────────────────────────
export const BED_LABELS: Record<PublicLang, Record<BedTypeKey, string>> = {
  ko: { KING: "킹", QUEEN: "퀸", DOUBLE: "더블", SINGLE: "싱글", TWIN: "트윈", BUNK: "2층" },
  en: { KING: "King", QUEEN: "Queen", DOUBLE: "Double", SINGLE: "Single", TWIN: "Twin", BUNK: "Bunk" },
  ru: { KING: "Кинг", QUEEN: "Куин", DOUBLE: "Двуспальная", SINGLE: "Односпальная", TWIN: "Две односпальные", BUNK: "Двухъярусная" },
  zh: { KING: "特大床", QUEEN: "大床", DOUBLE: "双人床", SINGLE: "单人床", TWIN: "双床", BUNK: "上下铺" },
  vi: { KING: "King", QUEEN: "Queen", DOUBLE: "Đôi", SINGLE: "Đơn", TWIN: "Hai giường đơn", BUNK: "Giường tầng" },
};

export const FEATURE_LABELS: Record<PublicLang, Record<string, string>> = {
  ko: {
    viewSea: "바다뷰", viewMountain: "마운틴뷰", viewCity: "시티뷰", bbq: "BBQ",
    elevator: "엘리베이터", generator: "발전기", kidsPool: "키즈풀", privatePool: "프라이빗풀",
    gym: "헬스장", golfNearby: "골프장 인근", beachFront: "해변 바로앞", marketNearby: "마트 인근",
  },
  en: {
    viewSea: "Sea view", viewMountain: "Mountain view", viewCity: "City view", bbq: "BBQ",
    elevator: "Elevator", generator: "Generator", kidsPool: "Kids pool", privatePool: "Private pool",
    gym: "Gym", golfNearby: "Near golf", beachFront: "Beachfront", marketNearby: "Near market",
  },
  ru: {
    viewSea: "Вид на море", viewMountain: "Вид на горы", viewCity: "Вид на город", bbq: "Барбекю",
    elevator: "Лифт", generator: "Генератор", kidsPool: "Детский бассейн", privatePool: "Частный бассейн",
    gym: "Спортзал", golfNearby: "Рядом гольф", beachFront: "У пляжа", marketNearby: "Рядом магазин",
  },
  zh: {
    viewSea: "海景", viewMountain: "山景", viewCity: "城市景", bbq: "烧烤",
    elevator: "电梯", generator: "发电机", kidsPool: "儿童泳池", privatePool: "私人泳池",
    gym: "健身房", golfNearby: "近高尔夫", beachFront: "海滨", marketNearby: "近超市",
  },
  vi: {
    viewSea: "Hướng biển", viewMountain: "Hướng núi", viewCity: "Hướng thành phố", bbq: "BBQ",
    elevator: "Thang máy", generator: "Máy phát điện", kidsPool: "Hồ bơi trẻ em", privatePool: "Hồ bơi riêng",
    gym: "Phòng gym", golfNearby: "Gần sân golf", beachFront: "Sát biển", marketNearby: "Gần chợ",
  },
};

const WEEKDAYS: Record<PublicLang, readonly string[]> = {
  ko: ["일", "월", "화", "수", "목", "금", "토"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  vi: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"],
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** 긴 날짜 표기 — @db.Date(UTC 자정) 기준. 언어별 관용 형식. */
export function formatPublicDateLong(date: Date, lang: PublicLang): string {
  const m = date.getUTCMonth(); // 0-11
  const d = date.getUTCDate();
  const wd = WEEKDAYS[lang][date.getUTCDay()];
  switch (lang) {
    case "ko": return `${m + 1}월 ${d}일 (${wd})`;
    case "zh": return `${m + 1}月${d}日 (${wd})`;
    case "vi": return `${d} thg ${m + 1} (${wd})`;
    case "ru": return `${d} ${MONTHS_RU[m]} (${wd})`;
    default: return `${MONTHS_EN[m]} ${d} (${wd})`; // en
  }
}

/** 짧은 날짜 표기 "MM.DD (요일)" — 형식은 공통, 요일만 언어별. */
export function formatPublicDateShort(date: Date, lang: PublicLang): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}.${dd} (${WEEKDAYS[lang][date.getUTCDay()]})`;
}

// ── UI 문자열 딕셔너리 ───────────────────────────────────────────────────────
export interface PublicLabels {
  // 공통/헤더/푸터
  back: string;
  share: string;
  shareCopied: string;
  copy: string;
  copied: string;
  footer: { terms: string; privacy: string; depositPolicy: string };
  // 통화 접미사
  krwSuffix: string; // KRW 금액 접미사 (ko "원", 그 외 "₩")
  // USD 입금 안내 (Phase 2) — USD 계좌는 운영하지 않으므로 운영자 문의 중립 메시지
  usdBankNotice: string;
  // 만료 배지
  expiryBadge: (hours: number) => string;
  // 메인 제안 페이지
  proposal: {
    forClient: (name: string) => string;
    subtitle: string;
    nights: (n: number) => string;
    bedrooms: (n: number) => string;
    pool: string;
    breakfastOn: string;
    breakfastOff: string;
    perNight: string; // "1박" 접두
    total: string; // "총" 접두
    bookCta: string;
    holdNotice: (h: number) => string;
    holdNoticeSub: string;
    bankLabel: string;
    bankTitle: string;
    bankName: string;
    bankNumber: string;
    bankHolder: string;
    bankNote: string;
  };
  // 빌라 판매정보 섹션
  sales: {
    beddingTitle: string;
    maxGuests: (n: number) => string;
    bedroomCount: (n: number) => string;
    extraBed: string;
    mapView: string;
    beach: string;
    area: string;
    floors: string;
    floorUnit: (n: number) => string;
    rulesTitle: string;
    checkIn: string;
    checkOut: string;
    smokingOn: string;
    smokingOff: string;
    petsOn: string;
    petsOff: string;
    partyOn: string;
    partyOff: string;
    parkingOn: (n: number) => string;
    parkingOff: string;
    depositTitle: string;
    depositBefore: string; // "...보증금 " (금액 앞)
    depositAfter: string; // " 가 요청될 수..." (금액 뒤)
    cancelTitle: string;
    cancelNoneBefore: string; // "체크인 "
    cancelNoneMid: string; // "일 이내 취소 시 "
    cancelNoneAfter: string; // "환불 불가"
    cancelTierBefore: string; // "체크인 "
    cancelTierMid: string; // "일 전까지 취소 시 "
    cancelTierAfter: string; // "% 환불" (pct 뒤)
  };
  // 만료/마감 뷰
  expired: {
    expiredTitle: string;
    closedTitle: string;
    expiredBody: string[]; // 줄바꿈 단위
    closedBody: string[];
    contactKakao: string;
    contactPhone: string;
  };
  // 게스트 셀프 체크인 링크 만료/회수 뷰 — 제안서(expired)와 별개 문구(체크인 링크는 제안서가 아님)
  guestExpired: {
    expiredTitle: string;
    expiredBody: string[]; // 줄바꿈 단위
  };
  // 홀드 카운트다운
  hold: { expired: string; remainingSuffix: string };
  // 가예약 입력 폼
  bookingForm: {
    name: string;
    namePlaceholder: string;
    phone: string;
    count: string;
    countOption: (n: number) => string;
    submitting: string;
    submit: string;
    errName: string;
    errPhone: string;
    errCount: string;
    errOverCapacity: string;
    alertError: string;
    // 취소·환불 규정 전자 동의 (T-proposal-policy-consent) — 정책 enabled일 때만 렌더
    policyConsentTitle: string;
    policyConsentLabel: string;
  };
  // 명단 입력 폼
  rosterForm: {
    label: string;
    placeholder: string;
    hint: string;
    saving: string;
    save: string;
    saved: string;
    error: string;
  };
  // 가예약 신청 페이지
  bookPage: {
    title: string;
    step: string;
    totalLabel: string;
    holdInfo: (h: number) => string;
  };
  // 가예약 완료 페이지
  donePage: {
    title: string;
    bookingNo: (code: string) => string;
    bankLabel: string;
    bankTitle: string;
    bankName: string;
    bankNumber: string;
    bankHolder: string;
    amount: string;
    noBankInfo: string;
    rosterCta: string;
    backToProposal: string;
    footerNote: string;
    // 입금통보 (B1) — HOLD 상태에서만. 게스트→운영자 "입금했어요" 신호
    paymentNoticeTitle: string;
    paymentNoticeDesc: string;
    depositorNameLabel: string;
    depositorNamePlaceholder: string;
    paymentNoticeCta: string;
    paymentNoticeSending: string;
    paymentNoticeDone: string;
    paymentNoticeError: string;
  };
  // 명단 입력 페이지
  rosterPage: {
    title: string;
    subtitle: string;
    summary: (nights: number, guests: number) => string;
  };
  // 파트너(여행사/랜드사) 부가서비스 요청 섹션 (ADR-0023 S4)
  partnerAddon: {
    label: string; // 작은 라벨
    title: string;
    subtitle: string;
    empty: string;
    priceInquiry: string; // KRW 환율 미설정 시
    increase: string; // 수량 +
    decrease: string; // 수량 −
    requestCta: string;
    requesting: string;
    requested: string; // 요청 접수 안내
    error: string;
    requestedTitle: string; // 요청 내역 제목
    statusPending: string;
    statusConfirmed: string;
    statusOther: string;
    settleNote: string;
    noteLabel: string; // "요청사항 (선택)" — 게스트 특이사항(이행자 전달용)
    notePlaceholder: string; // 메모 placeholder 예시
    orderingClosed: string; // 제안 만료 후 신규 요청 마감 안내 — API 410(EXPIRED)과 짝
  };
  // 사진 캐러셀 aria
  carousel: {
    zoom: (alt: string, n: number) => string;
    photo: (alt: string, n: number) => string;
    dialog: (alt: string) => string;
    close: string;
    prev: string;
    next: string;
  };
  // 소비자 포털(/g·/p) 에러 바운더리 — 청크 로드 실패·순간 502 시 백지 대신 복구 UI
  errorBoundary: {
    title: string;
    desc: string;
    retry: string;
  };
}

export const PUBLIC_LABELS: Record<PublicLang, PublicLabels> = {
  // ─────────────────────────────── 한국어 (원문) ───────────────────────────────
  ko: {
    back: "뒤로 가기",
    share: "공유",
    shareCopied: "링크가 복사되었습니다",
    copy: "복사",
    copied: "복사됨",
    footer: { terms: "이용약관", privacy: "개인정보처리방침", depositPolicy: "보증금 정책" },
    krwSuffix: "원",
    usdBankNotice: "USD 결제는 담당자가 별도로 안내해 드립니다. 입금 전 담당자에게 문의해 주세요.",
    expiryBadge: (h) => (h >= 1 ? `${h}시간 후 만료` : "곧 만료"),
    proposal: {
      forClient: (name) => `${name}님을 위한 제안`,
      subtitle: "Phu Quoc 프리미엄 빌라 단독 제안서입니다.",
      nights: (n) => `${n}박`,
      bedrooms: (n) => `침실 ${n}`,
      pool: "수영장",
      breakfastOn: "조식 포함",
      breakfastOff: "조식 불포함",
      perNight: "1박",
      total: "총",
      bookCta: "이 빌라로 가예약",
      holdNotice: (h) => `가예약 후 ${h}시간 내 입금 시\n예약이 확정됩니다`,
      holdNoticeSub: "미입금 시 가예약은 자동으로 취소될 수 있습니다.",
      bankLabel: "입금 계좌",
      bankTitle: "무통장 입금 안내",
      bankName: "은행명",
      bankNumber: "계좌번호",
      bankHolder: "예금주",
      bankNote: "입금 금액은 가예약 후 안내되며, 입금 확인 후 예약이 확정됩니다.",
    },
    sales: {
      beddingTitle: "잠자리 구성",
      maxGuests: (n) => `최대 ${n}인`,
      bedroomCount: (n) => `침실 ${n}개`,
      extraBed: "엑스트라베드 추가 가능",
      mapView: "지도 보기",
      beach: "해변까지",
      area: "전용면적",
      floors: "층수",
      floorUnit: (n) => `${n}층`,
      rulesTitle: "이용 안내",
      checkIn: "체크인",
      checkOut: "체크아웃",
      smokingOn: "흡연 가능",
      smokingOff: "금연",
      petsOn: "반려동물",
      petsOff: "반려동물 불가",
      partyOn: "파티 가능",
      partyOff: "파티 불가",
      parkingOn: (n) => `주차 ${n}대`,
      parkingOff: "주차 불가",
      depositTitle: "현지 보증금 안내",
      depositBefore: "체크인 시 현지에서 보증금 ",
      depositAfter: " 가 요청될 수 있으며, 체크아웃 검수 후 환불됩니다.",
      cancelTitle: "취소·환불 정책",
      cancelNoneBefore: "체크인 ",
      cancelNoneMid: "일 이내 취소 시 ",
      cancelNoneAfter: "환불 불가",
      cancelTierBefore: "체크인 ",
      cancelTierMid: "일 전까지 취소 시 ",
      cancelTierAfter: "% 환불",
    },
    expired: {
      expiredTitle: "제안이 만료되었습니다",
      closedTitle: "이미 마감되었습니다",
      expiredBody: ["제안 유효기간이 지나 더 이상 열람할 수 없습니다.", "담당자에게 새 제안을 요청해 주세요."],
      closedBody: ["선택하신 날짜의 빌라 예약이 마감되었습니다.", "다른 날짜로 다시 제안받으실 수 있습니다."],
      contactKakao: "카카오톡으로 문의",
      contactPhone: "전화 연결",
    },
    guestExpired: {
      expiredTitle: "체크인 링크가 만료되었습니다",
      expiredBody: ["이 체크인 링크는 더 이상 사용할 수 없습니다.", "체크인은 담당자에게 문의해 주세요."],
    },
    hold: { expired: "홀드가 만료되었습니다", remainingSuffix: "남음 — 시간 내 입금 시 예약 확정" },
    bookingForm: {
      name: "이름",
      namePlaceholder: "성함을 입력해주세요",
      phone: "연락처",
      count: "인원",
      countOption: (n) => `${n}명`,
      submitting: "신청 처리 중…",
      submit: "가예약 신청하기",
      errName: "성함을 입력해주세요",
      errPhone: "연락처를 정확히 입력해주세요",
      errCount: "인원을 선택해주세요",
      errOverCapacity: "빌라 정원을 초과했습니다 — 인원을 줄여주세요",
      alertError: "신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
      policyConsentTitle: "취소·환불 규정",
      policyConsentLabel: "위 취소·환불 규정을 확인했으며 동의합니다.",
    },
    rosterForm: {
      label: "투숙객 명단",
      placeholder: "실제 투숙하실 분들의 성함을 입력해주세요. 예) 김학태 / 이영희",
      hint: "체크인 시 여권과 대조하여 임시거주신고에 사용됩니다.",
      saving: "저장 중…",
      save: "명단 저장하기",
      saved: "저장되었습니다.",
      error: "저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
    },
    bookPage: {
      title: "가예약 신청",
      step: "단계 1/2",
      totalLabel: "총 결제 금액",
      holdInfo: (h) => `제출 후 ${h}시간 동안 해당 빌라가 홀드됩니다. 입금 확인 후 예약이 확정됩니다.`,
    },
    donePage: {
      title: "가예약이 접수되었습니다",
      bookingNo: (code) => `예약번호 ${code}`,
      bankLabel: "입금 정보",
      bankTitle: "무통장 입금 안내",
      bankName: "은행명",
      bankNumber: "계좌번호",
      bankHolder: "예금주",
      amount: "입금 금액",
      noBankInfo: "입금 계좌는 담당자가 별도로 안내해 드립니다.",
      rosterCta: "투숙객 명단 입력하기",
      backToProposal: "제안으로 돌아가기",
      footerNote: "입금 확인 후 예약이 확정되며, 미입금 시 가예약은 자동으로 취소될 수 있습니다.",
      paymentNoticeTitle: "입금하셨나요?",
      paymentNoticeDesc: "계좌이체를 마치셨다면 알려주세요. 담당자가 입금을 확인한 뒤 예약을 확정합니다.",
      depositorNameLabel: "입금자명 (선택)",
      depositorNamePlaceholder: "예금주와 다를 경우 입력해주세요",
      paymentNoticeCta: "입금했습니다",
      paymentNoticeSending: "통보 중…",
      paymentNoticeDone: "입금통보 완료 — 확인 중입니다",
      paymentNoticeError: "통보에 실패했습니다. 잠시 후 다시 시도해주세요.",
    },
    rosterPage: {
      title: "투숙객 명단 입력",
      subtitle: "실제 투숙하실 분들의 성함을 입력해주세요. 체크인 준비(임시거주신고)에 사용됩니다.",
      summary: (nights, guests) => `${nights}박 · ${guests}명`,
    },
    partnerAddon: {
      label: "부가서비스",
      title: "부가서비스 요청",
      subtitle: "과일 바구니·도시락 등 필요한 부가서비스를 선택해 요청하세요. 운영자 확인 후 안내해 드립니다.",
      empty: "현재 요청 가능한 부가서비스가 없습니다.",
      priceInquiry: "가격 문의",
      increase: "수량 추가",
      decrease: "수량 감소",
      requestCta: "부가서비스 요청하기",
      requesting: "요청 처리 중…",
      requested: "요청이 접수되었습니다. 운영자 확인 후 안내해 드립니다.",
      error: "요청 처리에 실패했습니다. 잠시 후 다시 시도해주세요.",
      requestedTitle: "요청 내역",
      statusPending: "확인 중",
      statusConfirmed: "확정",
      statusOther: "처리 중",
      settleNote: "요청하신 부가서비스는 운영자 확인 후 안내되며, 최종 금액은 별도로 안내됩니다.",
      noteLabel: "요청사항 (선택)",
      notePlaceholder: "특이사항이 있으면 적어주세요 (예: 알레르기, 도착 시간)",
      orderingClosed: "제안 유효기간이 지나 새 부가서비스 요청은 마감되었습니다. 필요하시면 담당자에게 문의해 주세요.",
    },
    carousel: {
      zoom: (alt, n) => `${alt} 사진 ${n} 확대`,
      photo: (alt, n) => `${alt} 사진 ${n}`,
      dialog: (alt) => `${alt} 사진`,
      close: "닫기",
      prev: "이전 사진",
      next: "다음 사진",
    },
    errorBoundary: {
      title: "일시적인 문제가 발생했어요",
      desc: "잠시 후 다시 시도해 주세요. 문제가 계속되면 예약하신 여행사로 문의해 주세요.",
      retry: "다시 시도",
    },
  },

  // ─────────────────────────────── English ───────────────────────────────
  en: {
    back: "Back",
    share: "Share",
    shareCopied: "Link copied",
    copy: "Copy",
    copied: "Copied",
    footer: { terms: "Terms of Service", privacy: "Privacy Policy", depositPolicy: "Deposit Policy" },
    krwSuffix: "₩",
    usdBankNotice: "For USD payments, your contact will share the details separately. Please ask before transferring.",
    expiryBadge: (h) => (h >= 1 ? `Expires in ${h}h` : "Expiring soon"),
    proposal: {
      forClient: (name) => `A proposal for ${name}`,
      subtitle: "An exclusive selection of premium villas in Phu Quoc.",
      nights: (n) => `${n} night${n === 1 ? "" : "s"}`,
      bedrooms: (n) => `${n} BR`,
      pool: "Pool",
      breakfastOn: "Breakfast included",
      breakfastOff: "No breakfast",
      perNight: "Per night",
      total: "Total",
      bookCta: "Reserve this villa",
      holdNotice: (h) => `Pay within ${h}h of reserving\nto confirm your booking`,
      holdNoticeSub: "Unpaid holds may be cancelled automatically.",
      bankLabel: "Payment Account",
      bankTitle: "Bank Transfer Details",
      bankName: "Bank",
      bankNumber: "Account no.",
      bankHolder: "Holder",
      bankNote: "The amount is shared after reserving; your booking is confirmed once payment is verified.",
    },
    sales: {
      beddingTitle: "Sleeping arrangement",
      maxGuests: (n) => `Up to ${n}`,
      bedroomCount: (n) => `${n} bedroom${n === 1 ? "" : "s"}`,
      extraBed: "Extra bed available",
      mapView: "View map",
      beach: "To beach",
      area: "Area",
      floors: "Floors",
      floorUnit: (n) => `${n}F`,
      rulesTitle: "House info",
      checkIn: "Check-in",
      checkOut: "Check-out",
      smokingOn: "Smoking OK",
      smokingOff: "No smoking",
      petsOn: "Pets OK",
      petsOff: "No pets",
      partyOn: "Parties OK",
      partyOff: "No parties",
      parkingOn: (n) => `${n} parking`,
      parkingOff: "No parking",
      depositTitle: "Local deposit notice",
      depositBefore: "A deposit of ",
      depositAfter: " may be collected on-site at check-in, refunded after check-out inspection.",
      cancelTitle: "Cancellation & refund",
      cancelNoneBefore: "Cancel within ",
      cancelNoneMid: " day(s) of check-in: ",
      cancelNoneAfter: "no refund",
      cancelTierBefore: "Cancel ",
      cancelTierMid: " day(s) before check-in: ",
      cancelTierAfter: "% refund",
    },
    expired: {
      expiredTitle: "This proposal has expired",
      closedTitle: "Already closed",
      expiredBody: ["This proposal is past its validity period.", "Please ask your contact for a new one."],
      closedBody: ["The villa for the selected dates is no longer available.", "You can request another date."],
      contactKakao: "Ask via KakaoTalk",
      contactPhone: "Call",
    },
    guestExpired: {
      expiredTitle: "Your check-in link has expired",
      expiredBody: ["This check-in link is no longer valid.", "Please contact your host for check-in."],
    },
    hold: { expired: "The hold has expired", remainingSuffix: "left — pay in time to confirm" },
    bookingForm: {
      name: "Name",
      namePlaceholder: "Enter your name",
      phone: "Phone",
      count: "Guests",
      countOption: (n) => `${n}`,
      submitting: "Submitting…",
      submit: "Request reservation",
      errName: "Please enter your name",
      errPhone: "Please enter a valid phone number",
      errCount: "Please select the number of guests",
      errOverCapacity: "Exceeds the villa's maximum capacity — please reduce the number of guests",
      alertError: "Something went wrong. Please try again shortly.",
      policyConsentTitle: "Cancellation & refund policy",
      policyConsentLabel: "I have read and agree to the cancellation & refund policy above.",
    },
    rosterForm: {
      label: "Guest list",
      placeholder: "Enter the names of the actual guests. e.g. John Kim / Jane Lee",
      hint: "Used at check-in to match passports for temporary residence registration.",
      saving: "Saving…",
      save: "Save list",
      saved: "Saved.",
      error: "Failed to save. Please try again shortly.",
    },
    bookPage: {
      title: "Reservation request",
      step: "Step 1/2",
      totalLabel: "Total amount",
      holdInfo: (h) => `The villa is held for ${h}h after submission. Confirmed once payment is verified.`,
    },
    donePage: {
      title: "Your reservation is received",
      bookingNo: (code) => `Booking no. ${code}`,
      bankLabel: "Payment Info",
      bankTitle: "Bank Transfer Details",
      bankName: "Bank",
      bankNumber: "Account no.",
      bankHolder: "Holder",
      amount: "Amount",
      noBankInfo: "Your contact will share the payment account separately.",
      rosterCta: "Enter guest list",
      backToProposal: "Back to proposal",
      footerNote: "Confirmed once payment is verified; unpaid holds may be cancelled automatically.",
      paymentNoticeTitle: "Made the payment?",
      paymentNoticeDesc: "Let us know once you've transferred. Your booking is confirmed after we verify the payment.",
      depositorNameLabel: "Depositor name (optional)",
      depositorNamePlaceholder: "Enter if different from the account holder",
      paymentNoticeCta: "I've paid",
      paymentNoticeSending: "Sending…",
      paymentNoticeDone: "Payment reported — verifying",
      paymentNoticeError: "Failed to send. Please try again shortly.",
    },
    rosterPage: {
      title: "Enter guest list",
      subtitle: "Enter the names of the actual guests. Used to prepare check-in (temporary residence registration).",
      summary: (nights, guests) => `${nights} night${nights === 1 ? "" : "s"} · ${guests} guest${guests === 1 ? "" : "s"}`,
    },
    partnerAddon: {
      label: "Add-ons",
      title: "Request add-on services",
      subtitle: "Select add-ons such as a fruit basket or lunch box. We'll confirm and follow up after review.",
      empty: "No add-on services are available to request right now.",
      priceInquiry: "Ask for price",
      increase: "Increase quantity",
      decrease: "Decrease quantity",
      requestCta: "Request add-ons",
      requesting: "Submitting…",
      requested: "Your request has been received. We'll follow up after review.",
      error: "Failed to submit. Please try again shortly.",
      requestedTitle: "Requested items",
      statusPending: "Reviewing",
      statusConfirmed: "Confirmed",
      statusOther: "Processing",
      settleNote: "Requested add-ons are confirmed after review; the final amount is shared separately.",
      noteLabel: "Special request (optional)",
      notePlaceholder: "Let us know any special requests (e.g. allergy, arrival time)",
      orderingClosed: "The proposal window has closed, so new add-on requests are no longer accepted. Please contact your host if needed.",
    },
    carousel: {
      zoom: (alt, n) => `Zoom ${alt} photo ${n}`,
      photo: (alt, n) => `${alt} photo ${n}`,
      dialog: (alt) => `${alt} photo`,
      close: "Close",
      prev: "Previous photo",
      next: "Next photo",
    },
    errorBoundary: {
      title: "Something went wrong",
      desc: "Please try again in a moment. If it keeps happening, contact your travel agency.",
      retry: "Try again",
    },
  },

  // ─────────────────────────────── Русский (1차 감수 반영, 원어민 최종 감수 권장) ───────────────────────────────
  ru: {
    back: "Назад",
    share: "Поделиться",
    shareCopied: "Ссылка скопирована",
    copy: "Копировать",
    copied: "Скопировано",
    footer: { terms: "Условия", privacy: "Конфиденциальность", depositPolicy: "Политика депозита" },
    krwSuffix: "₩",
    usdBankNotice: "По оплате в USD реквизиты сообщит менеджер отдельно. Уточните перед переводом.",
    expiryBadge: (h) => (h >= 1 ? `Истекает через ${h} ч` : "Скоро истекает"),
    proposal: {
      forClient: (name) => `Предложение для ${name}`,
      subtitle: "Эксклюзивная подборка премиальных вилл на Фукуоке.",
      nights: (n) => `${n} ноч.`,
      bedrooms: (n) => `${n} спальни`,
      pool: "Бассейн",
      breakfastOn: "Завтрак включён",
      breakfastOff: "Без завтрака",
      perNight: "За ночь",
      total: "Итого",
      bookCta: "Забронировать виллу",
      holdNotice: (h) => `Оплатите в течение ${h} ч после брони,\nчтобы подтвердить бронирование`,
      holdNoticeSub: "Неоплаченная бронь может быть отменена автоматически.",
      bankLabel: "Счёт для оплаты",
      bankTitle: "Реквизиты банковского перевода",
      bankName: "Банк",
      bankNumber: "Номер счёта",
      bankHolder: "Получатель",
      bankNote: "Сумма сообщается после брони; бронирование подтверждается после проверки оплаты.",
    },
    sales: {
      beddingTitle: "Спальные места",
      maxGuests: (n) => `До ${n} чел.`,
      bedroomCount: (n) => `${n} спальни`,
      extraBed: "Доступна доп. кровать",
      mapView: "На карте",
      beach: "До пляжа",
      area: "Площадь",
      floors: "Этажи",
      floorUnit: (n) => `${n} эт.`,
      rulesTitle: "Информация",
      checkIn: "Заезд",
      checkOut: "Выезд",
      smokingOn: "Курение разрешено",
      smokingOff: "Не курить",
      petsOn: "Питомцы разрешены",
      petsOff: "Без питомцев",
      partyOn: "Вечеринки разрешены",
      partyOff: "Без вечеринок",
      parkingOn: (n) => `Парковка ${n} авто`,
      parkingOff: "Без парковки",
      depositTitle: "Местный депозит",
      depositBefore: "При заезде на месте может потребоваться депозит ",
      depositAfter: ", возвращается после осмотра при выезде.",
      cancelTitle: "Отмена и возврат",
      cancelNoneBefore: "Отмена в течение ",
      cancelNoneMid: " дн. до заезда: ",
      cancelNoneAfter: "без возврата",
      cancelTierBefore: "Отмена за ",
      cancelTierMid: " дн. до заезда: ",
      cancelTierAfter: "% возврат",
    },
    expired: {
      expiredTitle: "Срок предложения истёк",
      closedTitle: "Уже закрыто",
      expiredBody: ["Срок действия предложения истёк.", "Запросите новое у вашего менеджера."],
      closedBody: ["Вилла на выбранные даты больше недоступна.", "Вы можете запросить другие даты."],
      contactKakao: "Написать в KakaoTalk",
      contactPhone: "Позвонить",
    },
    guestExpired: {
      expiredTitle: "Срок ссылки для заселения истёк",
      expiredBody: ["Эта ссылка для заселения больше недействительна.", "Пожалуйста, свяжитесь с вашим менеджером."],
    },
    hold: { expired: "Бронь истекла", remainingSuffix: "осталось — оплатите вовремя для подтверждения" },
    bookingForm: {
      name: "Имя",
      namePlaceholder: "Введите имя",
      phone: "Телефон",
      count: "Гостей",
      countOption: (n) => `${n}`,
      submitting: "Отправка…",
      submit: "Запросить бронь",
      errName: "Введите имя",
      errPhone: "Введите корректный номер телефона",
      errCount: "Выберите количество гостей",
      errOverCapacity: "Превышена вместимость виллы — уменьшите количество гостей",
      alertError: "Произошла ошибка. Повторите попытку позже.",
      policyConsentTitle: "Условия отмены и возврата",
      policyConsentLabel: "Я ознакомился(лась) и согласен(на) с условиями отмены и возврата выше.",
    },
    rosterForm: {
      label: "Список гостей",
      placeholder: "Укажите имена фактических гостей. напр. Иван Ким / Анна Ли",
      hint: "Используется при заезде для сверки с паспортами и регистрации.",
      saving: "Сохранение…",
      save: "Сохранить список",
      saved: "Сохранено.",
      error: "Не удалось сохранить. Повторите позже.",
    },
    bookPage: {
      title: "Запрос брони",
      step: "Шаг 1/2",
      totalLabel: "Итого к оплате",
      holdInfo: (h) => `Вилла удерживается ${h} ч после отправки. Подтверждается после проверки оплаты.`,
    },
    donePage: {
      title: "Ваша бронь принята",
      bookingNo: (code) => `Бронь № ${code}`,
      bankLabel: "Данные для оплаты",
      bankTitle: "Реквизиты банковского перевода",
      bankName: "Банк",
      bankNumber: "Номер счёта",
      bankHolder: "Получатель",
      amount: "Сумма",
      noBankInfo: "Менеджер сообщит реквизиты отдельно.",
      rosterCta: "Ввести список гостей",
      backToProposal: "К предложению",
      footerNote: "Подтверждается после проверки оплаты; неоплаченная бронь может быть отменена.",
      paymentNoticeTitle: "Вы оплатили?",
      paymentNoticeDesc: "Сообщите нам после перевода. Бронирование подтверждается после проверки оплаты.",
      depositorNameLabel: "Имя плательщика (необязательно)",
      depositorNamePlaceholder: "Укажите, если отличается от владельца счёта",
      paymentNoticeCta: "Я оплатил",
      paymentNoticeSending: "Отправка…",
      paymentNoticeDone: "Оплата отмечена — проверяем",
      paymentNoticeError: "Не удалось отправить. Повторите попытку позже.",
    },
    rosterPage: {
      title: "Ввод списка гостей",
      subtitle: "Укажите имена фактических гостей. Используется для подготовки к заезду (регистрация).",
      summary: (nights, guests) => `${nights} ноч. · ${guests} гост.`,
    },
    partnerAddon: {
      label: "Доп. услуги",
      title: "Запрос доп. услуг",
      subtitle: "Выберите доп. услуги: фруктовая корзина, ланч-бокс и др. Подтвердим после проверки.",
      empty: "Сейчас нет доступных доп. услуг для запроса.",
      priceInquiry: "Уточнить цену",
      increase: "Увеличить количество",
      decrease: "Уменьшить количество",
      requestCta: "Запросить доп. услуги",
      requesting: "Отправка…",
      requested: "Запрос принят. Свяжемся после проверки.",
      error: "Не удалось отправить. Повторите попытку позже.",
      requestedTitle: "Запрошенные позиции",
      statusPending: "На проверке",
      statusConfirmed: "Подтверждено",
      statusOther: "В обработке",
      settleNote: "Запрошенные услуги подтверждаются после проверки; итоговая сумма сообщается отдельно.",
      noteLabel: "Особые пожелания (необязательно)",
      notePlaceholder: "Сообщите особые пожелания (напр.: аллергия, время прибытия)",
      orderingClosed: "Срок действия предложения истёк, новые запросы услуг не принимаются. При необходимости свяжитесь с менеджером.",
    },
    carousel: {
      zoom: (alt, n) => `Увеличить фото ${alt} ${n}`,
      photo: (alt, n) => `${alt} фото ${n}`,
      dialog: (alt) => `${alt} фото`,
      close: "Закрыть",
      prev: "Предыдущее фото",
      next: "Следующее фото",
    },
    errorBoundary: {
      title: "Произошла временная ошибка",
      desc: "Пожалуйста, попробуйте ещё раз через минуту. Если ошибка повторяется, свяжитесь с турагентством.",
      retry: "Повторить",
    },
  },

  // ─────────────────────────────── 中文(简体) ───────────────────────────────
  zh: {
    back: "返回",
    share: "分享",
    shareCopied: "链接已复制",
    copy: "复制",
    copied: "已复制",
    footer: { terms: "服务条款", privacy: "隐私政策", depositPolicy: "押金政策" },
    krwSuffix: "₩",
    usdBankNotice: "美元付款将由负责人另行告知，转账前请先咨询负责人。",
    expiryBadge: (h) => (h >= 1 ? `${h}小时后过期` : "即将过期"),
    proposal: {
      forClient: (name) => `为 ${name} 准备的提案`,
      subtitle: "富国岛精选高端别墅独家提案。",
      nights: (n) => `${n}晚`,
      bedrooms: (n) => `${n}间卧室`,
      pool: "泳池",
      breakfastOn: "含早餐",
      breakfastOff: "不含早餐",
      perNight: "每晚",
      total: "合计",
      bookCta: "预订此别墅",
      holdNotice: (h) => `预订后 ${h} 小时内付款\n即可确认预订`,
      holdNoticeSub: "未付款的预订可能被自动取消。",
      bankLabel: "付款账户",
      bankTitle: "银行转账信息",
      bankName: "银行",
      bankNumber: "账号",
      bankHolder: "户名",
      bankNote: "金额将在预订后告知，付款确认后预订即确定。",
    },
    sales: {
      beddingTitle: "床位配置",
      maxGuests: (n) => `最多${n}人`,
      bedroomCount: (n) => `${n}间卧室`,
      extraBed: "可加床",
      mapView: "查看地图",
      beach: "距海滩",
      area: "面积",
      floors: "楼层",
      floorUnit: (n) => `${n}层`,
      rulesTitle: "入住须知",
      checkIn: "入住",
      checkOut: "退房",
      smokingOn: "可吸烟",
      smokingOff: "禁烟",
      petsOn: "可携宠物",
      petsOff: "禁带宠物",
      partyOn: "可聚会",
      partyOff: "禁止聚会",
      parkingOn: (n) => `${n}个车位`,
      parkingOff: "无停车位",
      depositTitle: "当地押金说明",
      depositBefore: "入住时当地可能收取押金 ",
      depositAfter: "，退房验收后退还。",
      cancelTitle: "取消与退款",
      cancelNoneBefore: "入住前 ",
      cancelNoneMid: " 天内取消：",
      cancelNoneAfter: "不退款",
      cancelTierBefore: "入住前 ",
      cancelTierMid: " 天前取消：",
      cancelTierAfter: "% 退款",
    },
    expired: {
      expiredTitle: "提案已过期",
      closedTitle: "已截止",
      expiredBody: ["提案有效期已过，无法继续查看。", "请向负责人索取新的提案。"],
      closedBody: ["所选日期的别墅预订已截止。", "您可以选择其他日期重新获取提案。"],
      contactKakao: "通过 KakaoTalk 咨询",
      contactPhone: "电话联系",
    },
    guestExpired: {
      expiredTitle: "入住链接已过期",
      expiredBody: ["此入住链接已失效。", "请联系您的负责人办理入住。"],
    },
    hold: { expired: "预留已过期", remainingSuffix: "剩余 — 按时付款即可确认预订" },
    bookingForm: {
      name: "姓名",
      namePlaceholder: "请输入姓名",
      phone: "联系电话",
      count: "人数",
      countOption: (n) => `${n}人`,
      submitting: "提交中…",
      submit: "提交预订申请",
      errName: "请输入姓名",
      errPhone: "请输入正确的联系电话",
      errCount: "请选择人数",
      errOverCapacity: "超出别墅最大入住人数——请减少人数",
      alertError: "处理时出现问题，请稍后再试。",
      policyConsentTitle: "取消与退款政策",
      policyConsentLabel: "我已阅读并同意上述取消与退款政策。",
    },
    rosterForm: {
      label: "入住客人名单",
      placeholder: "请输入实际入住客人的姓名。例：金学泰 / 李英熙",
      hint: "入住时用于核对护照及临时居住登记。",
      saving: "保存中…",
      save: "保存名单",
      saved: "已保存。",
      error: "保存失败，请稍后再试。",
    },
    bookPage: {
      title: "预订申请",
      step: "步骤 1/2",
      totalLabel: "应付总额",
      holdInfo: (h) => `提交后该别墅将保留 ${h} 小时。付款确认后预订即确定。`,
    },
    donePage: {
      title: "您的预订已受理",
      bookingNo: (code) => `预订号 ${code}`,
      bankLabel: "付款信息",
      bankTitle: "银行转账信息",
      bankName: "银行",
      bankNumber: "账号",
      bankHolder: "户名",
      amount: "付款金额",
      noBankInfo: "付款账户将由负责人另行告知。",
      rosterCta: "录入客人名单",
      backToProposal: "返回提案",
      footerNote: "付款确认后预订即确定；未付款的预订可能被自动取消。",
      paymentNoticeTitle: "已完成付款？",
      paymentNoticeDesc: "完成转账后请告知我们。负责人确认付款后即确定预订。",
      depositorNameLabel: "付款人姓名（选填）",
      depositorNamePlaceholder: "如与户名不同请填写",
      paymentNoticeCta: "我已付款",
      paymentNoticeSending: "通知中…",
      paymentNoticeDone: "已通知付款 — 确认中",
      paymentNoticeError: "通知失败，请稍后再试。",
    },
    rosterPage: {
      title: "录入客人名单",
      subtitle: "请输入实际入住客人的姓名。用于入住准备（临时居住登记）。",
      summary: (nights, guests) => `${nights}晚 · ${guests}人`,
    },
    partnerAddon: {
      label: "附加服务",
      title: "申请附加服务",
      subtitle: "可选择水果篮、便当等附加服务。运营方确认后将另行告知。",
      empty: "目前没有可申请的附加服务。",
      priceInquiry: "价格咨询",
      increase: "增加数量",
      decrease: "减少数量",
      requestCta: "申请附加服务",
      requesting: "提交中…",
      requested: "申请已受理。运营方确认后将另行告知。",
      error: "提交失败，请稍后再试。",
      requestedTitle: "申请记录",
      statusPending: "确认中",
      statusConfirmed: "已确认",
      statusOther: "处理中",
      settleNote: "所申请的附加服务将在运营方确认后告知，最终金额另行通知。",
      noteLabel: "特殊要求（选填）",
      notePlaceholder: "如有特殊要求请填写（例如：过敏、到达时间）",
      orderingClosed: "提案有效期已过，暂不接受新的附加服务申请。如有需要请联系负责人。",
    },
    carousel: {
      zoom: (alt, n) => `放大 ${alt} 照片 ${n}`,
      photo: (alt, n) => `${alt} 照片 ${n}`,
      dialog: (alt) => `${alt} 照片`,
      close: "关闭",
      prev: "上一张",
      next: "下一张",
    },
    errorBoundary: {
      title: "出现了暂时的问题",
      desc: "请稍后重试。如果问题持续，请联系您的旅行社。",
      retry: "重试",
    },
  },

  // ─────────────────────────────── Tiếng Việt ───────────────────────────────
  vi: {
    back: "Quay lại",
    share: "Chia sẻ",
    shareCopied: "Đã sao chép liên kết",
    copy: "Sao chép",
    copied: "Đã chép",
    footer: { terms: "Điều khoản", privacy: "Chính sách bảo mật", depositPolicy: "Chính sách đặt cọc" },
    krwSuffix: "₩",
    usdBankNotice: "Với thanh toán bằng USD, người phụ trách sẽ thông báo riêng. Vui lòng hỏi trước khi chuyển khoản.",
    expiryBadge: (h) => (h >= 1 ? `Hết hạn sau ${h} giờ` : "Sắp hết hạn"),
    proposal: {
      forClient: (name) => `Đề xuất dành cho ${name}`,
      subtitle: "Tuyển chọn biệt thự cao cấp độc quyền tại Phú Quốc.",
      nights: (n) => `${n} đêm`,
      bedrooms: (n) => `${n} phòng ngủ`,
      pool: "Hồ bơi",
      breakfastOn: "Gồm bữa sáng",
      breakfastOff: "Không bữa sáng",
      perNight: "Mỗi đêm",
      total: "Tổng",
      bookCta: "Giữ chỗ biệt thự này",
      holdNotice: (h) => `Thanh toán trong ${h} giờ sau khi giữ chỗ\nđể xác nhận đặt phòng`,
      holdNoticeSub: "Giữ chỗ chưa thanh toán có thể bị tự động hủy.",
      bankLabel: "Tài khoản thanh toán",
      bankTitle: "Thông tin chuyển khoản",
      bankName: "Ngân hàng",
      bankNumber: "Số tài khoản",
      bankHolder: "Chủ tài khoản",
      bankNote: "Số tiền được thông báo sau khi giữ chỗ; đặt phòng xác nhận sau khi kiểm tra thanh toán.",
    },
    sales: {
      beddingTitle: "Bố trí giường",
      maxGuests: (n) => `Tối đa ${n}`,
      bedroomCount: (n) => `${n} phòng ngủ`,
      extraBed: "Có thể thêm giường phụ",
      mapView: "Xem bản đồ",
      beach: "Tới biển",
      area: "Diện tích",
      floors: "Số tầng",
      floorUnit: (n) => `${n} tầng`,
      rulesTitle: "Thông tin",
      checkIn: "Nhận phòng",
      checkOut: "Trả phòng",
      smokingOn: "Được hút thuốc",
      smokingOff: "Cấm hút thuốc",
      petsOn: "Cho thú cưng",
      petsOff: "Không thú cưng",
      partyOn: "Được tổ chức tiệc",
      partyOff: "Không tiệc tùng",
      parkingOn: (n) => `${n} chỗ đậu xe`,
      parkingOff: "Không đậu xe",
      depositTitle: "Lưu ý đặt cọc tại chỗ",
      depositBefore: "Khi nhận phòng có thể được yêu cầu đặt cọc ",
      depositAfter: " tại chỗ, hoàn lại sau khi kiểm tra trả phòng.",
      cancelTitle: "Hủy & hoàn tiền",
      cancelNoneBefore: "Hủy trong vòng ",
      cancelNoneMid: " ngày trước nhận phòng: ",
      cancelNoneAfter: "không hoàn tiền",
      cancelTierBefore: "Hủy trước ",
      cancelTierMid: " ngày trước nhận phòng: ",
      cancelTierAfter: "% hoàn tiền",
    },
    expired: {
      expiredTitle: "Đề xuất đã hết hạn",
      closedTitle: "Đã đóng",
      expiredBody: ["Đề xuất đã quá thời hạn hiệu lực.", "Vui lòng yêu cầu đề xuất mới từ người phụ trách."],
      closedBody: ["Biệt thự cho ngày đã chọn không còn trống.", "Bạn có thể yêu cầu ngày khác."],
      contactKakao: "Hỏi qua KakaoTalk",
      contactPhone: "Gọi điện",
    },
    guestExpired: {
      expiredTitle: "Liên kết nhận phòng đã hết hạn",
      expiredBody: ["Liên kết nhận phòng này không còn hiệu lực.", "Vui lòng liên hệ người phụ trách để nhận phòng."],
    },
    hold: { expired: "Giữ chỗ đã hết hạn", remainingSuffix: "còn lại — thanh toán kịp thời để xác nhận" },
    bookingForm: {
      name: "Họ tên",
      namePlaceholder: "Nhập họ tên của bạn",
      phone: "Liên hệ",
      count: "Số khách",
      countOption: (n) => `${n} khách`,
      submitting: "Đang gửi…",
      submit: "Gửi yêu cầu giữ chỗ",
      errName: "Vui lòng nhập họ tên",
      errPhone: "Vui lòng nhập số điện thoại hợp lệ",
      errCount: "Vui lòng chọn số khách",
      errOverCapacity: "Vượt quá sức chứa của villa — vui lòng giảm số khách",
      alertError: "Đã xảy ra lỗi. Vui lòng thử lại sau.",
      policyConsentTitle: "Chính sách hủy & hoàn tiền",
      policyConsentLabel: "Tôi đã đọc và đồng ý với chính sách hủy & hoàn tiền ở trên.",
    },
    rosterForm: {
      label: "Danh sách khách",
      placeholder: "Nhập tên những khách thực tế lưu trú. VD) Kim Hak-tae / Lee Young-hee",
      hint: "Dùng khi nhận phòng để đối chiếu hộ chiếu và khai báo tạm trú.",
      saving: "Đang lưu…",
      save: "Lưu danh sách",
      saved: "Đã lưu.",
      error: "Lưu thất bại. Vui lòng thử lại sau.",
    },
    bookPage: {
      title: "Yêu cầu giữ chỗ",
      step: "Bước 1/2",
      totalLabel: "Tổng thanh toán",
      holdInfo: (h) => `Biệt thự được giữ ${h} giờ sau khi gửi. Xác nhận sau khi kiểm tra thanh toán.`,
    },
    donePage: {
      title: "Đã nhận yêu cầu giữ chỗ",
      bookingNo: (code) => `Mã đặt phòng ${code}`,
      bankLabel: "Thông tin thanh toán",
      bankTitle: "Thông tin chuyển khoản",
      bankName: "Ngân hàng",
      bankNumber: "Số tài khoản",
      bankHolder: "Chủ tài khoản",
      amount: "Số tiền",
      noBankInfo: "Người phụ trách sẽ thông báo tài khoản riêng.",
      rosterCta: "Nhập danh sách khách",
      backToProposal: "Về đề xuất",
      footerNote: "Xác nhận sau khi kiểm tra thanh toán; giữ chỗ chưa thanh toán có thể bị hủy.",
      paymentNoticeTitle: "Bạn đã thanh toán?",
      paymentNoticeDesc: "Hãy báo cho chúng tôi sau khi chuyển khoản. Đặt phòng được xác nhận sau khi kiểm tra thanh toán.",
      depositorNameLabel: "Tên người chuyển (tùy chọn)",
      depositorNamePlaceholder: "Nhập nếu khác với chủ tài khoản",
      paymentNoticeCta: "Tôi đã thanh toán",
      paymentNoticeSending: "Đang gửi…",
      paymentNoticeDone: "Đã báo thanh toán — đang kiểm tra",
      paymentNoticeError: "Gửi thất bại. Vui lòng thử lại sau.",
    },
    rosterPage: {
      title: "Nhập danh sách khách",
      subtitle: "Nhập tên những khách thực tế lưu trú. Dùng để chuẩn bị nhận phòng (khai báo tạm trú).",
      summary: (nights, guests) => `${nights} đêm · ${guests} khách`,
    },
    partnerAddon: {
      label: "Dịch vụ thêm",
      title: "Yêu cầu dịch vụ thêm",
      subtitle: "Chọn các dịch vụ thêm như giỏ trái cây, hộp cơm... Chúng tôi sẽ xác nhận và thông báo sau khi xem xét.",
      empty: "Hiện chưa có dịch vụ thêm nào để yêu cầu.",
      priceInquiry: "Hỏi giá",
      increase: "Tăng số lượng",
      decrease: "Giảm số lượng",
      requestCta: "Yêu cầu dịch vụ thêm",
      requesting: "Đang gửi…",
      requested: "Đã nhận yêu cầu. Chúng tôi sẽ thông báo sau khi xem xét.",
      error: "Gửi thất bại. Vui lòng thử lại sau.",
      requestedTitle: "Các mục đã yêu cầu",
      statusPending: "Đang xác nhận",
      statusConfirmed: "Đã xác nhận",
      statusOther: "Đang xử lý",
      settleNote: "Dịch vụ đã yêu cầu sẽ được xác nhận sau khi xem xét; số tiền cuối cùng sẽ được thông báo riêng.",
      noteLabel: "Yêu cầu thêm (không bắt buộc)",
      notePlaceholder: "Cho chúng tôi biết yêu cầu đặc biệt (vd: dị ứng, giờ đến)",
      orderingClosed: "Thời hạn đề xuất đã kết thúc, không nhận yêu cầu dịch vụ mới. Nếu cần, vui lòng liên hệ người phụ trách.",
    },
    carousel: {
      zoom: (alt, n) => `Phóng to ảnh ${alt} ${n}`,
      photo: (alt, n) => `${alt} ảnh ${n}`,
      dialog: (alt) => `${alt} ảnh`,
      close: "Đóng",
      prev: "Ảnh trước",
      next: "Ảnh sau",
    },
    errorBoundary: {
      title: "Đã xảy ra sự cố tạm thời",
      desc: "Vui lòng thử lại sau giây lát. Nếu vẫn lỗi, hãy liên hệ công ty du lịch của bạn.",
      retry: "Thử lại",
    },
  },
};
