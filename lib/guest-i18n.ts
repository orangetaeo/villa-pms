// lib/guest-i18n.ts — /g/[token] 게스트 셀프 체크인 5개 언어 딕셔너리 (ADR-0019 S3)
//
// 설계: /p(public-i18n)와 동일 패턴 — 서버가 lang을 해석해 GUEST_LABELS[lang]을 클라이언트에 주입.
//   게스트=한국 여행객 기본 ko, ?lang=ko/vi/en/zh/ru 지원. PublicLang(ko/en/ru/zh/vi) 재사용.
// 범위: G1~G5 정적 UI 텍스트만 5개 언어. 빌라명·옵션명 등 동적 데이터는 카탈로그 ko/vi/en에서 해석.
// ⚠ 마진 비공개: 이 모듈은 라벨만 — 원가·마진 문자열 없음. 판매가 표기는 단위/통화 접미만 담당.

import type { PublicLang } from "@/lib/public-i18n";

export interface GuestLabels {
  brandTagline: string; // 헤더 보조 문구
  // 공통
  next: string;
  back: string;
  confirm: string;
  done: string;
  // 진행 단계 라벨 (4스텝: 비품→동의→여권→완료)
  steps: { amenities: string; agreement: string; passport: string; done: string };
  stepCount: (cur: number, total: number) => string;
  // G1 예약 확인
  home: {
    kicker: string;
    title: string;
    subtitle: string;
    badgeConfirmed: string;
    stayChargeLabel: string;
    nights: (n: number) => string;
    guests: (n: number) => string;
    breakfastOn: string;
    breakfastOff: string;
    privacyNote: string;
    startCta: string;
  };
  // G2 비품 확인
  amenities: {
    title: string;
    intro: string;
    minibarTitle: string;
    minibarPaid: string;
    stocked: (n: number) => string;
    minibarNote: string;
    confirmCheck: string;
    categories: { KITCHEN: string; BATHROOM: string; APPLIANCE: string; MINIBAR: string };
  };
  // G3 동의서
  agreement: {
    title: string;
    docTitleFallback: string;
    versionChip: (v: string) => string;
    signLabel: string;
    clear: string;
    signPrompt: string;
    signUploading: string;
    agreeCheck: string;
    submitCta: string;
    submitting: string;
    alreadySigned: string;
    alreadySignedAt: (v: string) => string;
    error: string;
  };
  // G4 여권 사진(신규)
  passport: {
    title: string;
    intro: string;
    privacyNote: string; // "임시거주신고용, 비공개 보관"
    slotLabel: (n: number) => string; // "투숙객 N"
    addPhoto: string; // "사진 추가"
    retake: string; // "다시 찍기"
    uploading: string;
    uploaded: string; // 업로드 완료
    error: string;
    processFailed: string; // 변환 실패(HEIC 디코딩 실패·5MB 초과) — 재촬영 안내
    skip: string; // 건너뛰기
    finishCta: string; // 완료로
  };
  // 옵션 페이지(별도 라우트 /g/[token]/options)
  addons: {
    title: string;
    pageIntro: string; // 옵션 페이지 상단 안내
    banner: string;
    optionLabel: string; // "옵션 선택"
    timeLabel: string; // "시간 선택"
    typeLabel: string; // "종류"
    addonsLabel: string; // "세부 시술 선택"
    addonsTrigger: (n: number) => string;
    selectedCount: (n: number) => string;
    apply: string;
    sheetTitle: string;
    sheetHint: string;
    estTotal: string;
    itemTotal: string; // 카드 하단 품목 합계 라벨(단가×수량·티켓 구분별 소계 합)
    requestCta: string;
    requesting: string;
    requested: string; // 요청 완료 토스트
    error: string;
    configError: string; // 품목 설정 오류(VARIANT_REQUIRED/NO_PRICE 등) — 운영자 문의 안내
    perUnit: (label: string) => string;
    variantRequired: string;
    goNext: string; // 옵션 없이 다음
    // 희망 날짜·시간(신규)
    serviceDateLabel: string; // "희망 날짜"
    serviceDatePlaceholder: string; // 빈 날짜칸 안내(iOS Safari 공백 렌더 보완) "날짜 선택"
    serviceTimeLabel: string; // "희망 시간"
    serviceTimePlaceholder: string; // "예: 14:00"
    noteLabel: string; // "요청사항 (선택)" — 게스트 특이사항(이행자 전달용)
    notePlaceholder: string; // 메모 placeholder 예시
    customerNameLabel: string; // "이용자 이름" — 서비스 받을 사람(대표자 prefill)
    customerNameHint: string; // 짧은 힌트: 서비스 받으실 분 이름 — 담당 업체에 전달됨
    customerNamePlaceholder: string; // 입력 placeholder(이름)
    ticketPeopleTitle: string; // 통합 "티켓 이용자 정보" 카드 제목 — 이름·생년월일·신장 1회 입력(테오 2026-07-12)
    ticketPeopleHint: string; // 통합 카드 안내 — 신장 1회 입력이 모든 티켓 품목에 공유됨
    ticketGuestTitle: string; // TICKET 이용자 선택 섹션 제목 "티켓 이용자 선택"(ADR-0036)
    ticketGuestHint: string; // 단일가 안내: "체크인 명단에서 티켓 이용자를 선택하세요"
    ticketGuestVariantHint: string; // 수동 모드: 각 이용자 구분 선택 안내(ADR-0036 개정)
    ticketGuestAutoHint: string; // 자동 모드: 생년월일·신장 자동 판정 안내
    ticketGuestManualHint: string; // 자동 판정 실패 폴백: 직접 선택 안내
    ticketHeightLabel: string; // 신장 입력 라벨 "신장"
    ticketHeightPlaceholder: string; // 신장 입력 placeholder "예: 120"
    ticketHeightNotice: string; // 신장 자가신고 고지(현장 재측정·차액) — 허위신고 방지
    ticketVariantRequired: string; // 하단 경고: 구분 미배정 시
    priceInquiry: string; // 환율 미설정 시 "가격 문의"
    rateNote: string; // 하단 환산액 안내 "오늘 환율 기준"
    backToCheckin: string; // 체크인으로 돌아가기
    empty: string;
    myOrders: string; // 신청 내역 페이지 제목/링크
    dateTimeRequired: string; // 날짜·시간 미입력 안내(필수)
    fulfillDelivery: string; // 배송형(BBQ·조식·과일·차량·오토바이) 안내
    fulfillAppointment: string; // 예약형 — 픽업 미정(운영자 확인) 폴백
    fulfillPickup: string; // 예약형 — 픽업 제공(차량 모심)
    fulfillVisit: string; // 예약형 — 고객 직접 매장 방문
    fulfillOther: string; // 기타(입장권·가이드) 안내
  };
  // G5 완료
  result: {
    title: string;
    subtitle: string;
    agreementDone: string;
    agreementDoneAt: (v: string) => string;
    requestedTitle: string;
    statusPending: string; // REQUESTED — "담당자 확인 중"(자동 발주 후 벤더 수락 대기)
    statusConfirmed: string; // CONFIRMED — "확정"(벤더 수락 완료)
    statusOther: string;
    statusCancelled: string;
    estTotal: string;
    settleNote: string;
    empty: string;
    finishCta: string;
    openOptionsCta: string; // "부가 옵션 신청하기" — 옵션 페이지로 이동
    optionsHint: string; // 옵션 버튼 보조 문구
    // ADR-0033 직접 발주 — 신청 직후 성공 배너 + 확정 후 담당자 연락처
    orderedBanner: string; // "신청 완료 — 담당자에게 바로 전달됨" 배너
    vendorContactLabel: string; // "담당자" 라벨
    vendorContactHint: string; // "궁금한 점은 담당자에게 직접 연락하세요"
    ticketContactNotice: string; // 티켓 문의 본사 일원화 — "티켓 관련 문의는 Villa Go로 연락해 주세요"
    ticketContactKakao: string; // 티켓 문의 카카오톡 버튼 라벨
    ticketContactPhone: string; // 티켓 문의 전화 버튼 라벨
  };
  // 출입 정보(A1) — G5 완료화면 카드. wifi 비번은 서명 후에만 노출.
  access: {
    title: string; // "출입 정보"
    addressLabel: string; // "주소"
    mapLink: string; // "지도에서 보기"
    wifiTitle: string; // "와이파이"
    wifiSsidLabel: string; // "네트워크"
    wifiPwLabel: string; // "비밀번호"
    copy: string; // "복사"
    copied: string; // "복사됨"
    wifiLocked: string; // "동의서 작성 후 표시됩니다"
  };
  // 체크아웃 정산 미리보기(A2) — /orders 합계 섹션 + 셀프 취소(A3)
  checkout: {
    summaryTitle: string; // "신청 합계"
    pendingLabel: string; // "확정 대기"
    confirmedLabel: string; // "확정"
    pendingTotal: string; // "확정 대기 합계"
    confirmedTotal: string; // "확정 합계"
    grandTotal: string; // "신청 합계"
    cancel: string; // "취소"
    cancelling: string; // "취소 중…"
    cancelConfirm: string; // "이 신청을 취소하시겠습니까?"
    cancelError: string; // 취소 실패 안내
    cancelDispatched: string; // 발주된 주문 — 셀프 취소 불가, 운영자 문의
  };
  // 티켓형(TICKET) QR 티켓 열람(ADR-0034) — 발행된 티켓 썸네일 섹션 + 확대 오버레이
  tickets: {
    title: (n: number) => string; // "내 티켓 (N장)"
    partial: (issued: number, needed: number) => string; // 주문 수량보다 발행이 적을 때 경고 — "전부 지급됨" 오인 방지
    hint: string; // "입장 시 QR을 제시하세요"
    close: string; // 확대 오버레이 닫기
    save: string; // 티켓 1장 저장 버튼
    saveAll: string; // 그룹(주문) 단위 모두 저장 버튼
    offlineHint: string; // 오프라인 대비 안내("현장 인터넷이 안 될 수 있어 미리 저장하세요")
    iosHint: string; // iOS 보조 안내("이미지를 길게 눌러 사진에 저장할 수도 있어요")
    freeEntry: string; // 무료 티켓(판매가 0) 안내 — "티켓 없이 입장 가능(무료)"
  };
  // 벤더 시간 제안 응답(ADR-0035) — 미해결 제안 배너 + 제안 카드 블록(원래→제안 시간, 승인/거절)
  proposal: {
    banner: string; // 상단 배너("담당자가 시간 변경을 제안했습니다")
    title: string; // 제안 블록 제목
    originalLabel: string; // "기존 시간"
    proposedLabel: string; // "제안 시간"
    noteLabel: string; // "담당자 메모"
    accept: string; // "승인"
    decline: string; // "거절"
    processing: string; // "처리 중…"
    declinedNote: string; // 거절 후 안내("담당자가 다시 확인합니다")
    error: string; // 처리 실패 안내
  };
  // 서비스 카테고리 탭(옵션 페이지 /g/[token]/options) — 전체 + ServiceType 9종.
  //   카탈로그에 실존하는 타입만 노출·클라 필터. 라벨은 탭에 맞춰 짧게.
  serviceTypes: {
    ALL: string; // "전체"
    BBQ: string;
    TICKET: string;
    GUIDE: string;
    CAR_RENTAL: string;
    BREAKFAST: string;
    MOTORBIKE_RENTAL: string;
    MASSAGE: string;
    BARBER: string;
    FRUIT: string;
  };
  // 정산 내역(영수증) — /g/[token]/receipt (T-guest-settlement-receipt). 체크아웃 후 이용 금액·보증금 환불 확인.
  receipt: {
    entryTitle: string; // 진입점 카드 제목
    entryHint: string; // 진입점 보조 문구
    entryCta: string; // 진입점 버튼 라벨 "정산 내역(영수증) 보기"
    pageTitle: string; // 페이지 제목
    pageSubtitle: string; // 페이지 부제
    reservationTitle: string; // 예약 요약 섹션 제목
    guestLabel: string; // 예약자 라벨
    minibarTitle: string; // 미니바 이용 내역 섹션
    minibarEmpty: string; // 이용 미니바 없음
    qtyUnit: (n: number) => string; // 수량 표기 "N개"
    serviceTitle: string; // 부가서비스 내역 섹션
    serviceEmpty: string; // 이용 부가서비스 없음
    usageTitle: string; // 총 이용 금액 섹션
    usageApprox: (v: string) => string; // 환산 합계 "≈ {v}"
    depositTitle: string; // 보증금 정산 섹션
    depositReceived: string; // 수취 보증금
    depositOffset: string; // 보증금 상계
    damageDeduct: string; // 파손 차감
    totalDeduct: string; // 차감 총액(구 데이터)
    refund: string; // 환불액
    paymentTitle: string; // 결제 내역 섹션
    paidLabel: string; // 수납(구 데이터 폴백 라벨)
    outstandingLabel: string; // 미수납 잔액(청구가 결제로 다 안 채워진 구 데이터)
    methodCash: string; // 현금
    methodBank: string; // 계좌이체
    methodOther: string; // 기타
    methodDeposit: string; // 보증금 차감(수납 라인)
    settledAtLabel: string; // 정산 일시
    note: string; // 하단 안내
  };
  footerNote: string;
}

// KRW 접미(ko "원" / 그 외 "₩") — public-i18n과 동일 규칙
const krwSuffix = (lang: PublicLang): string => (lang === "ko" ? "원" : "₩");

/** 판매가 표기 — KRW 우선(있으면), 없으면 VND. 천단위 쉼표는 formatThousands가 처리. */
export function guestKrwSuffix(lang: PublicLang): string {
  return krwSuffix(lang);
}

export const GUEST_LABELS: Record<PublicLang, GuestLabels> = {
  // ─────────────────────────────── 한국어 ───────────────────────────────
  ko: {
    brandTagline: "셀프 체크인",
    next: "다음",
    back: "뒤로",
    confirm: "확인",
    done: "완료",
    steps: { amenities: "비품 확인", agreement: "이용 동의", passport: "여권 사진", done: "완료" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "셀프 체크인",
      title: "체크인을 시작합니다",
      subtitle: "도착 전 미리 비품 확인·동의서 서명·옵션 선택을 마치면 현장 절차가 빨라집니다.",
      badgeConfirmed: "예약 확정",
      stayChargeLabel: "숙박 요금",
      nights: (n) => `${n}박`,
      guests: (n) => `성인 ${n}명`,
      breakfastOn: "조식 포함",
      breakfastOff: "조식 불포함",
      privacyNote: "이 링크는 고객님의 예약 한 건에만 연결됩니다. 약 2분이면 끝납니다.",
      startCta: "체크인 진행하기",
    },
    amenities: {
      title: "비품 확인",
      intro: "빌라에 비치된 비품입니다. 가볍게 확인하신 뒤 다음으로 넘어가 주세요.",
      minibarTitle: "미니바",
      minibarPaid: "소비 시 유료",
      stocked: (n) => `비치 ${n}개`,
      minibarNote: "소비하신 미니바는 체크아웃 시 정산됩니다 (현금/계좌이체).",
      confirmCheck: "비품을 확인했습니다",
      categories: { KITCHEN: "주방", BATHROOM: "욕실", APPLIANCE: "가전", MINIBAR: "미니바" },
    },
    agreement: {
      title: "이용 동의서",
      docTitleFallback: "빌라 이용 동의서",
      versionChip: (v) => `버전 ${v}`,
      signLabel: "서명",
      clear: "지우기",
      signPrompt: "여기에 서명해주세요",
      signUploading: "업로드 중…",
      agreeCheck: "위 내용에 동의하며 서명합니다",
      submitCta: "동의하고 서명 완료",
      submitting: "처리 중…",
      alreadySigned: "이용 동의서 서명이 완료되었습니다.",
      alreadySignedAt: (v) => `버전 ${v}`,
      error: "서명 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    },
    passport: {
      title: "여권 사진",
      intro: "투숙객 전원의 여권 사진을 한 장씩 촬영해 주세요.",
      privacyNote: "임시거주신고용으로만 사용되며 비공개로 안전하게 보관됩니다.",
      slotLabel: (n) => `투숙객 ${n}`,
      addPhoto: "사진 촬영·선택",
      retake: "다시 선택",
      uploading: "업로드 중…",
      uploaded: "업로드 완료",
      error: "업로드 중 문제가 발생했습니다. 다시 시도해주세요.",
      processFailed: "이 사진은 처리할 수 없습니다. 다시 촬영해 주세요.",
      skip: "나중에 하기",
      finishCta: "체크인 완료",
    },
    addons: {
      title: "부가 옵션 신청",
      pageIntro: "투숙 중 필요한 옵션을 언제든 신청하실 수 있습니다.",
      banner: "요청 후 운영자 확인 시 확정됩니다. 결제는 체크아웃 시 현금/계좌이체로 정산합니다.",
      optionLabel: "옵션 선택",
      timeLabel: "시간 선택",
      typeLabel: "종류",
      addonsLabel: "세부 시술 선택",
      addonsTrigger: (n) => `세부 시술 선택 (${n})`,
      selectedCount: (n) => `${n}개 선택`,
      apply: "적용",
      sheetTitle: "세부 시술 선택",
      sheetHint: "여러 개 선택할 수 있어요",
      estTotal: "합계 (예상)",
      itemTotal: "합계",
      requestCta: "이 옵션 요청하기",
      requesting: "요청 처리 중…",
      requested: "요청이 접수되었습니다.",
      error: "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
      configError: "이 품목의 설정에 문제가 있어요. 운영자에게 문의해 주세요.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "옵션을 선택해주세요",
      goNext: "옵션 없이 완료",
      serviceDateLabel: "희망 날짜",
      serviceDatePlaceholder: "날짜 선택",
      serviceTimeLabel: "희망 시간",
      serviceTimePlaceholder: "예: 14:00",
      noteLabel: "요청사항 (선택)",
      notePlaceholder: "특이사항이 있으면 적어주세요 (예: 왼쪽 다리 위주로, 조식 알레르기)",
      customerNameLabel: "이용자 이름",
      customerNameHint: "서비스 받으실 분 이름 — 담당 업체에 전달됩니다.",
      customerNamePlaceholder: "이름을 입력하세요",
      ticketPeopleTitle: "티켓 이용자 정보",
      ticketPeopleHint: "티켓을 사용할 분들의 정보예요. 신장은 여기서 한 번만 입력하면 모든 티켓에 적용됩니다.",
      ticketGuestTitle: "티켓 이용자 선택",
      ticketGuestHint: "체크인 명단에서 이 티켓을 사용할 분을 선택하세요. 선택한 인원 수만큼 발권됩니다.",
      ticketGuestVariantHint: "각 이용자의 구분을 선택하세요. 구분마다 따로 발권됩니다.",
      ticketGuestAutoHint: "생년월일·신장 기준으로 구분이 자동 지정됩니다. 구분마다 따로 발권됩니다.",
      ticketGuestManualHint: "자동 판정이 안 돼요 — 직접 선택하세요.",
      ticketHeightLabel: "신장",
      ticketHeightPlaceholder: "예: 120",
      ticketHeightNotice: "키는 현장에서 다시 잽니다. 신고와 다르면 차액을 현장에서 받을 수 있어요.",
      ticketVariantRequired: "티켓 이용자의 구분을 선택하세요",
      priceInquiry: "가격 문의",
      rateNote: "오늘 환율 기준",
      backToCheckin: "체크인 화면으로",
      empty: "현재 신청 가능한 옵션이 없습니다.",
      myOrders: "신청 내역",
      dateTimeRequired: "희망 날짜와 시간을 선택해주세요.",
      fulfillDelivery: "선택하신 날짜·시간에 맞춰 빌라로 제공/배송됩니다.",
      fulfillAppointment: "예약하신 시간에 진행됩니다. 픽업(차량 모심) 가능 여부는 운영자 확인 후 안내드립니다.",
      fulfillPickup: "예약하신 시간에 차량이 모시러 갑니다(픽업 제공).",
      fulfillVisit: "고객님이 직접 매장으로 방문하셔야 합니다.",
      fulfillOther: "선택하신 날짜·시간을 기준으로 안내해 드립니다.",
    },
    result: {
      title: "체크인 정보가\n접수되었습니다",
      subtitle: "도착하시면 빠르게 안내해 드리겠습니다.",
      agreementDone: "이용 동의서 서명 완료",
      agreementDoneAt: (v) => `버전 ${v}`,
      requestedTitle: "요청한 옵션",
      statusPending: "담당자 확인 중",
      statusConfirmed: "확정",
      statusOther: "처리됨",
      statusCancelled: "취소됨",
      estTotal: "예상 합계",
      settleNote: "미니바 및 선택하신 옵션은 체크아웃 시 정산됩니다 (현금/계좌이체). 운영자 확인 후 최종 금액을 안내해 드립니다.",
      empty: "아직 요청한 옵션이 없습니다.",
      finishCta: "확인",
      openOptionsCta: "부가 옵션 신청하기",
      optionsHint: "BBQ·마사지·차량 등 투숙 중 필요한 서비스를 신청하실 수 있습니다.",
      orderedBanner: "신청 완료 — 서비스 담당자에게 바로 전달되었습니다. 담당자가 확인하면 이 페이지에서 확정 상태를 확인하실 수 있어요.",
      vendorContactLabel: "담당자",
      vendorContactHint: "궁금한 점은 담당자에게 직접 연락하세요.",
      ticketContactNotice: "티켓 관련 문의는 Villa Go로 연락해 주세요.",
      ticketContactKakao: "카카오톡 문의",
      ticketContactPhone: "전화 연결",
    },
    access: {
      title: "출입 정보",
      addressLabel: "주소",
      mapLink: "지도에서 보기",
      wifiTitle: "와이파이",
      wifiSsidLabel: "네트워크",
      wifiPwLabel: "비밀번호",
      copy: "복사",
      copied: "복사됨",
      wifiLocked: "동의서 작성 후 표시됩니다.",
    },
    checkout: {
      summaryTitle: "신청 합계",
      pendingLabel: "확정 대기",
      confirmedLabel: "확정",
      pendingTotal: "확정 대기 합계",
      confirmedTotal: "확정 합계",
      grandTotal: "신청 합계",
      cancel: "취소",
      cancelling: "취소 중…",
      cancelConfirm: "이 신청을 취소하시겠습니까?",
      cancelError: "취소 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
      cancelDispatched: "이미 준비가 시작되어 직접 취소할 수 없습니다. 운영자에게 문의해주세요.",
    },
    tickets: {
      title: (n) => `내 티켓 (${n}장)`,
      partial: (issued, needed) => `주문 ${needed}장 중 ${issued}장만 발행되었습니다 — 나머지는 준비 중이에요.`,
      hint: "입장 시 QR 코드를 제시하세요.",
      close: "닫기",
      save: "저장",
      saveAll: "티켓 모두 저장",
      offlineHint: "현장에서 인터넷이 안 될 수 있어요. 티켓을 미리 저장해 두세요.",
      iosHint: "이미지를 길게 눌러 사진에 저장할 수도 있어요.",
      freeEntry: "티켓 없이 입장 가능(무료)",
    },
    proposal: {
      banner: "담당자가 시간 변경을 제안했습니다 — 아래에서 확인해 주세요.",
      title: "시간 변경 제안",
      originalLabel: "기존 시간",
      proposedLabel: "제안 시간",
      noteLabel: "담당자 메모",
      accept: "승인",
      decline: "거절",
      processing: "처리 중…",
      declinedNote: "제안을 거절했습니다. 담당자가 다시 확인해 시간을 안내해 드립니다.",
      error: "처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    },
    serviceTypes: {
      ALL: "전체",
      BBQ: "바베큐",
      TICKET: "티켓",
      GUIDE: "가이드",
      CAR_RENTAL: "차량",
      BREAKFAST: "조식",
      MOTORBIKE_RENTAL: "오토바이",
      MASSAGE: "마사지",
      BARBER: "이발",
      FRUIT: "과일",
    },
    receipt: {
      entryTitle: "정산 내역",
      entryHint: "체크아웃 정산이 완료되었습니다. 이용 금액과 보증금 환불 내역을 확인하세요.",
      entryCta: "정산 내역(영수증) 보기",
      pageTitle: "정산 내역",
      pageSubtitle: "체크아웃 정산 결과입니다.",
      reservationTitle: "예약 정보",
      guestLabel: "예약자",
      minibarTitle: "미니바 이용 내역",
      minibarEmpty: "이용하신 미니바가 없습니다.",
      qtyUnit: (n) => `${n}개`,
      serviceTitle: "부가서비스 내역",
      serviceEmpty: "이용하신 부가서비스가 없습니다.",
      usageTitle: "총 이용 금액",
      usageApprox: (v) => `환산 합계 ≈ ${v}`,
      depositTitle: "보증금 정산",
      depositReceived: "수취 보증금",
      depositOffset: "보증금 상계",
      damageDeduct: "파손 차감",
      totalDeduct: "차감 총액",
      refund: "환불액",
      paymentTitle: "결제 내역",
      paidLabel: "수납",
      outstandingLabel: "미수납 잔액",
      methodCash: "현금",
      methodBank: "계좌이체",
      methodOther: "기타",
      methodDeposit: "보증금 차감",
      settledAtLabel: "정산 일시",
      note: "본 내역은 체크아웃 시점의 정산 결과입니다. 문의는 예약하신 여행사로 연락해 주세요.",
    },
    footerNote: "문의사항은 예약하신 여행사로 연락해 주세요.",
  },

  // ─────────────────────────────── English ───────────────────────────────
  en: {
    brandTagline: "Self check-in",
    next: "Next",
    back: "Back",
    confirm: "Confirm",
    done: "Done",
    steps: { amenities: "Amenities", agreement: "Agreement", passport: "Passport", done: "Done" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "Self check-in",
      title: "Let's start check-in",
      subtitle: "Confirming amenities, signing the agreement, and choosing options before arrival speeds up the on-site process.",
      badgeConfirmed: "Confirmed",
      stayChargeLabel: "Room charge",
      nights: (n) => `${n} night${n === 1 ? "" : "s"}`,
      guests: (n) => `${n} adult${n === 1 ? "" : "s"}`,
      breakfastOn: "Breakfast included",
      breakfastOff: "No breakfast",
      privacyNote: "This link is tied to your single booking only. It takes about 2 minutes.",
      startCta: "Start check-in",
    },
    amenities: {
      title: "Amenities",
      intro: "These amenities are provided in the villa. Take a quick look and continue.",
      minibarTitle: "Minibar",
      minibarPaid: "Paid if consumed",
      stocked: (n) => `${n} stocked`,
      minibarNote: "Minibar items you consume are settled at check-out (cash/bank transfer).",
      confirmCheck: "I have reviewed the amenities",
      categories: { KITCHEN: "Kitchen", BATHROOM: "Bathroom", APPLIANCE: "Appliances", MINIBAR: "Minibar" },
    },
    agreement: {
      title: "Agreement",
      docTitleFallback: "Villa House Rules Agreement",
      versionChip: (v) => `Version ${v}`,
      signLabel: "Signature",
      clear: "Clear",
      signPrompt: "Sign here",
      signUploading: "Uploading…",
      agreeCheck: "I agree to the above and sign",
      submitCta: "Agree & sign",
      submitting: "Processing…",
      alreadySigned: "The house rules agreement has been signed.",
      alreadySignedAt: (v) => `Version ${v}`,
      error: "Something went wrong while signing. Please try again shortly.",
    },
    passport: {
      title: "Passport photos",
      intro: "Please take one passport photo for each guest.",
      privacyNote: "Used only for temporary residence registration and stored securely in private.",
      slotLabel: (n) => `Guest ${n}`,
      addPhoto: "Take / choose photo",
      retake: "Choose again",
      uploading: "Uploading…",
      uploaded: "Uploaded",
      error: "Upload failed. Please try again.",
      processFailed: "This photo can't be processed. Please retake it.",
      skip: "Do this later",
      finishCta: "Finish check-in",
    },
    addons: {
      title: "Add-on options",
      pageIntro: "You can request options anytime during your stay.",
      banner: "Requests are confirmed after the operator reviews them. Payment is settled at check-out (cash/bank transfer).",
      optionLabel: "Choose option",
      timeLabel: "Choose duration",
      typeLabel: "Type",
      addonsLabel: "Choose add-ons",
      addonsTrigger: (n) => `Choose add-ons (${n})`,
      selectedCount: (n) => `${n} selected`,
      apply: "Apply",
      sheetTitle: "Choose add-ons",
      sheetHint: "You can pick several",
      estTotal: "Estimated total",
      itemTotal: "Subtotal",
      requestCta: "Request these options",
      requesting: "Submitting…",
      requested: "Your request has been received.",
      error: "Something went wrong. Please try again shortly.",
      configError: "There's a problem with this item's setup. Please contact the operator.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "Please choose an option",
      goNext: "Finish without options",
      serviceDateLabel: "Preferred date",
      serviceDatePlaceholder: "Select date",
      serviceTimeLabel: "Preferred time",
      serviceTimePlaceholder: "e.g. 14:00",
      noteLabel: "Special request (optional)",
      notePlaceholder: "Let us know any special requests (e.g. focus on left leg, breakfast allergy)",
      customerNameLabel: "Guest name",
      customerNameHint: "Name of the person receiving the service — shared with the provider.",
      customerNamePlaceholder: "Enter a name",
      ticketPeopleTitle: "Ticket guests",
      ticketPeopleHint: "Details of guests using tickets. Enter height once here and it applies to every ticket.",
      ticketGuestTitle: "Select ticket holders",
      ticketGuestHint: "Choose who will use this ticket from your checked-in guests. One ticket is issued per person selected.",
      ticketGuestVariantHint: "Choose a category for each guest. Each category is ticketed separately.",
      ticketGuestAutoHint: "Categories are set automatically from birth date and height. Each category is ticketed separately.",
      ticketGuestManualHint: "Couldn't determine automatically — please select.",
      ticketHeightLabel: "Height",
      ticketHeightPlaceholder: "e.g. 120",
      ticketHeightNotice: "Height is re-measured on site. If it differs from what you declare, the difference may be charged there.",
      ticketVariantRequired: "Select a category for each ticket guest",
      priceInquiry: "Ask for price",
      rateNote: "Today's exchange rate",
      backToCheckin: "Back to check-in",
      empty: "No options are available right now.",
      myOrders: "My requests",
      dateTimeRequired: "Please select your preferred date and time.",
      fulfillDelivery: "Delivered/served to your villa at your selected date & time.",
      fulfillAppointment: "Provided at your booked time. Pickup (car service) availability will be confirmed by our staff.",
      fulfillPickup: "A car will pick you up at your booked time (pickup provided).",
      fulfillVisit: "You will need to visit the shop in person.",
      fulfillOther: "We will assist you based on your selected date & time.",
    },
    result: {
      title: "Your check-in info\nhas been received",
      subtitle: "We'll guide you quickly upon arrival.",
      agreementDone: "House rules agreement signed",
      agreementDoneAt: (v) => `Version ${v}`,
      requestedTitle: "Requested options",
      statusPending: "Awaiting provider",
      statusConfirmed: "Confirmed",
      statusOther: "Processed",
      statusCancelled: "Cancelled",
      estTotal: "Estimated total",
      settleNote: "Minibar and selected options are settled at check-out (cash/bank transfer). The operator will confirm the final amount.",
      empty: "No options requested yet.",
      finishCta: "Done",
      openOptionsCta: "Request add-on options",
      optionsHint: "Request services you may need during your stay, such as BBQ, massage, or a car.",
      orderedBanner: "Request sent — it went straight to your service provider. Once they confirm, you'll see the confirmed status on this page.",
      vendorContactLabel: "Provider",
      vendorContactHint: "For any questions, contact the provider directly.",
      ticketContactNotice: "For ticket inquiries, please contact Villa Go.",
      ticketContactKakao: "KakaoTalk",
      ticketContactPhone: "Call",
    },
    access: {
      title: "Access info",
      addressLabel: "Address",
      mapLink: "Open in maps",
      wifiTitle: "Wi-Fi",
      wifiSsidLabel: "Network",
      wifiPwLabel: "Password",
      copy: "Copy",
      copied: "Copied",
      wifiLocked: "Shown after you sign the agreement.",
    },
    checkout: {
      summaryTitle: "Request total",
      pendingLabel: "Pending",
      confirmedLabel: "Confirmed",
      pendingTotal: "Pending total",
      confirmedTotal: "Confirmed total",
      grandTotal: "Request total",
      cancel: "Cancel",
      cancelling: "Cancelling…",
      cancelConfirm: "Cancel this request?",
      cancelError: "Could not cancel. Please try again shortly.",
      cancelDispatched: "Preparation has already started, so you can't cancel this yourself. Please contact the operator.",
    },
    tickets: {
      title: (n) => `My tickets (${n})`,
      partial: (issued, needed) => `Only ${issued} of ${needed} tickets issued so far — the rest are on the way.`,
      hint: "Show the QR code at the entrance.",
      close: "Close",
      save: "Save",
      saveAll: "Save all tickets",
      offlineHint: "The internet may not work on site. Save your tickets in advance.",
      iosHint: "You can also press and hold the image to save it to Photos.",
      freeEntry: "Free entry — no ticket needed",
    },
    proposal: {
      banner: "The provider suggested a new time — please review below.",
      title: "Suggested time change",
      originalLabel: "Original time",
      proposedLabel: "Suggested time",
      noteLabel: "Provider note",
      accept: "Accept",
      decline: "Decline",
      processing: "Processing…",
      declinedNote: "You declined the suggestion. The provider will review again and confirm a time.",
      error: "Something went wrong. Please try again shortly.",
    },
    serviceTypes: {
      ALL: "All",
      BBQ: "BBQ",
      TICKET: "Tickets",
      GUIDE: "Guide",
      CAR_RENTAL: "Car",
      BREAKFAST: "Breakfast",
      MOTORBIKE_RENTAL: "Motorbike",
      MASSAGE: "Massage",
      BARBER: "Barber",
      FRUIT: "Fruit",
    },
    receipt: {
      entryTitle: "Settlement receipt",
      entryHint: "Your check-out settlement is complete. Review your charges and deposit refund.",
      entryCta: "View settlement receipt",
      pageTitle: "Settlement receipt",
      pageSubtitle: "Your check-out settlement results.",
      reservationTitle: "Reservation",
      guestLabel: "Guest",
      minibarTitle: "Minibar usage",
      minibarEmpty: "No minibar items used.",
      qtyUnit: (n) => `${n}`,
      serviceTitle: "Add-on services",
      serviceEmpty: "No add-on services used.",
      usageTitle: "Total charges",
      usageApprox: (v) => `Converted total ≈ ${v}`,
      depositTitle: "Deposit settlement",
      depositReceived: "Deposit received",
      depositOffset: "Applied to charges",
      damageDeduct: "Damage deduction",
      totalDeduct: "Total deducted",
      refund: "Refund",
      paymentTitle: "Payment",
      paidLabel: "Paid",
      outstandingLabel: "Outstanding balance",
      methodCash: "Cash",
      methodBank: "Bank transfer",
      methodOther: "Other",
      methodDeposit: "From deposit",
      settledAtLabel: "Settled at",
      note: "This is the settlement result at check-out. For inquiries, please contact your travel agency.",
    },
    footerNote: "For inquiries, please contact your travel agency.",
  },

  // ─────────────────────────────── Русский ───────────────────────────────
  ru: {
    brandTagline: "Самостоятельное заселение",
    next: "Далее",
    back: "Назад",
    confirm: "Подтвердить",
    done: "Готово",
    steps: { amenities: "Удобства", agreement: "Соглашение", passport: "Паспорт", done: "Готово" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "Самостоятельное заселение",
      title: "Начнём заселение",
      subtitle: "Проверка удобств, подпись соглашения и выбор опций заранее ускоряют процесс на месте.",
      badgeConfirmed: "Подтверждено",
      stayChargeLabel: "Стоимость проживания",
      nights: (n) => `${n} ноч.`,
      guests: (n) => `${n} взросл.`,
      breakfastOn: "Завтрак включён",
      breakfastOff: "Без завтрака",
      privacyNote: "Эта ссылка привязана только к вашему бронированию. Займёт около 2 минут.",
      startCta: "Начать заселение",
    },
    amenities: {
      title: "Удобства",
      intro: "Эти удобства предоставлены на вилле. Кратко ознакомьтесь и продолжите.",
      minibarTitle: "Мини-бар",
      minibarPaid: "Платно при использовании",
      stocked: (n) => `В наличии ${n}`,
      minibarNote: "Использованные позиции мини-бара оплачиваются при выезде (наличные/перевод).",
      confirmCheck: "Я ознакомился с удобствами",
      categories: { KITCHEN: "Кухня", BATHROOM: "Ванная", APPLIANCE: "Техника", MINIBAR: "Мини-бар" },
    },
    agreement: {
      title: "Соглашение",
      docTitleFallback: "Соглашение о правилах виллы",
      versionChip: (v) => `Версия ${v}`,
      signLabel: "Подпись",
      clear: "Очистить",
      signPrompt: "Распишитесь здесь",
      signUploading: "Загрузка…",
      agreeCheck: "Я согласен с вышеизложенным и подписываю",
      submitCta: "Согласиться и подписать",
      submitting: "Обработка…",
      alreadySigned: "Соглашение о правилах подписано.",
      alreadySignedAt: (v) => `Версия ${v}`,
      error: "Произошла ошибка при подписании. Повторите попытку позже.",
    },
    passport: {
      title: "Фото паспорта",
      intro: "Пожалуйста, сделайте по одному фото паспорта каждого гостя.",
      privacyNote: "Используется только для регистрации временного проживания и хранится конфиденциально.",
      slotLabel: (n) => `Гость ${n}`,
      addPhoto: "Снять / выбрать фото",
      retake: "Выбрать снова",
      uploading: "Загрузка…",
      uploaded: "Загружено",
      error: "Ошибка загрузки. Повторите попытку.",
      processFailed: "Это фото невозможно обработать. Сделайте новый снимок.",
      skip: "Сделать позже",
      finishCta: "Завершить заселение",
    },
    addons: {
      title: "Дополнительные опции",
      pageIntro: "Вы можете запросить опции в любое время во время проживания.",
      banner: "Запросы подтверждаются после проверки оператором. Оплата при выезде (наличные/перевод).",
      optionLabel: "Выберите опцию",
      timeLabel: "Выберите длительность",
      typeLabel: "Тип",
      addonsLabel: "Выберите доп. услуги",
      addonsTrigger: (n) => `Выберите доп. услуги (${n})`,
      selectedCount: (n) => `Выбрано ${n}`,
      apply: "Применить",
      sheetTitle: "Выберите доп. услуги",
      sheetHint: "Можно выбрать несколько",
      estTotal: "Примерный итог",
      itemTotal: "Итог",
      requestCta: "Запросить эти опции",
      requesting: "Отправка…",
      requested: "Ваш запрос принят.",
      error: "Произошла ошибка. Повторите попытку позже.",
      configError: "Проблема с настройкой этой позиции. Пожалуйста, свяжитесь с оператором.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "Выберите опцию",
      goNext: "Завершить без опций",
      serviceDateLabel: "Желаемая дата",
      serviceDatePlaceholder: "Выберите дату",
      serviceTimeLabel: "Желаемое время",
      serviceTimePlaceholder: "напр. 14:00",
      noteLabel: "Особые пожелания (необязательно)",
      notePlaceholder: "Сообщите особые пожелания (напр.: упор на левую ногу, аллергия на завтрак)",
      customerNameLabel: "Имя гостя",
      customerNameHint: "Имя того, кто получит услугу — передаётся исполнителю.",
      customerNamePlaceholder: "Введите имя",
      ticketPeopleTitle: "Гости с билетами",
      ticketPeopleHint: "Данные гостей, которые воспользуются билетами. Укажите рост один раз — он применится ко всем билетам.",
      ticketGuestTitle: "Выбор владельцев билетов",
      ticketGuestHint: "Выберите из зарегистрированных гостей тех, кто воспользуется билетом. Билет выдаётся на каждого выбранного.",
      ticketGuestVariantHint: "Выберите категорию для каждого гостя. Каждая категория оформляется отдельно.",
      ticketGuestAutoHint: "Категория определяется автоматически по дате рождения и росту. Каждая категория оформляется отдельно.",
      ticketGuestManualHint: "Не удалось определить автоматически — выберите вручную.",
      ticketHeightLabel: "Рост",
      ticketHeightPlaceholder: "напр. 120",
      ticketHeightNotice: "Рост измеряют на месте. При расхождении с заявленным возможна доплата.",
      ticketVariantRequired: "Выберите категорию для каждого гостя",
      priceInquiry: "Уточнить цену",
      rateNote: "По курсу на сегодня",
      backToCheckin: "Назад к заселению",
      empty: "Сейчас нет доступных опций.",
      myOrders: "Мои запросы",
      dateTimeRequired: "Пожалуйста, выберите желаемую дату и время.",
      fulfillDelivery: "Доставка/подача на вашу виллу в выбранные дату и время.",
      fulfillAppointment: "Услуга в забронированное время. Возможность трансфера (авто) уточнит наш персонал.",
      fulfillPickup: "В забронированное время за вами приедет машина (трансфер включён).",
      fulfillVisit: "Вам нужно будет лично посетить салон.",
      fulfillOther: "Мы поможем вам с учётом выбранной даты и времени.",
    },
    result: {
      title: "Данные заселения\nприняты",
      subtitle: "По прибытии мы быстро вас обслужим.",
      agreementDone: "Соглашение о правилах подписано",
      agreementDoneAt: (v) => `Версия ${v}`,
      requestedTitle: "Запрошенные опции",
      statusPending: "Ожидает исполнителя",
      statusConfirmed: "Подтверждено",
      statusOther: "Обработано",
      statusCancelled: "Отменено",
      estTotal: "Примерный итог",
      settleNote: "Мини-бар и выбранные опции оплачиваются при выезде (наличные/перевод). Оператор подтвердит итоговую сумму.",
      empty: "Опции ещё не запрошены.",
      finishCta: "Готово",
      openOptionsCta: "Запросить доп. опции",
      optionsHint: "Запросите услуги, которые могут понадобиться во время проживания: барбекю, массаж, авто.",
      orderedBanner: "Запрос отправлен — он сразу передан вашему исполнителю. После подтверждения статус появится на этой странице.",
      vendorContactLabel: "Исполнитель",
      vendorContactHint: "По любым вопросам обращайтесь напрямую к исполнителю.",
      ticketContactNotice: "По вопросам о билетах обращайтесь в Villa Go.",
      ticketContactKakao: "KakaoTalk",
      ticketContactPhone: "Позвонить",
    },
    access: {
      title: "Информация о доступе",
      addressLabel: "Адрес",
      mapLink: "Открыть на карте",
      wifiTitle: "Wi-Fi",
      wifiSsidLabel: "Сеть",
      wifiPwLabel: "Пароль",
      copy: "Копировать",
      copied: "Скопировано",
      wifiLocked: "Отобразится после подписания соглашения.",
    },
    checkout: {
      summaryTitle: "Итог по запросам",
      pendingLabel: "Ожидает",
      confirmedLabel: "Подтверждено",
      pendingTotal: "Итог ожидающих",
      confirmedTotal: "Итог подтверждённых",
      grandTotal: "Итог по запросам",
      cancel: "Отменить",
      cancelling: "Отмена…",
      cancelConfirm: "Отменить этот запрос?",
      cancelError: "Не удалось отменить. Повторите попытку позже.",
      cancelDispatched: "Подготовка уже началась, отменить самостоятельно нельзя. Пожалуйста, свяжитесь с оператором.",
    },
    tickets: {
      title: (n) => `Мои билеты (${n})`,
      partial: (issued, needed) => `Выпущено ${issued} из ${needed} билетов — остальные готовятся.`,
      hint: "Покажите QR-код при входе.",
      close: "Закрыть",
      save: "Сохранить",
      saveAll: "Сохранить все билеты",
      offlineHint: "На месте интернет может не работать. Сохраните билеты заранее.",
      iosHint: "Также можно нажать и удерживать изображение, чтобы сохранить его в «Фото».",
      freeEntry: "Бесплатный вход — билет не нужен",
    },
    proposal: {
      banner: "Исполнитель предложил новое время — проверьте ниже.",
      title: "Предложение нового времени",
      originalLabel: "Исходное время",
      proposedLabel: "Предложенное время",
      noteLabel: "Примечание исполнителя",
      accept: "Принять",
      decline: "Отклонить",
      processing: "Обработка…",
      declinedNote: "Вы отклонили предложение. Исполнитель проверит снова и подтвердит время.",
      error: "Произошла ошибка. Повторите попытку позже.",
    },
    serviceTypes: {
      ALL: "Все",
      BBQ: "Барбекю",
      TICKET: "Билеты",
      GUIDE: "Гид",
      CAR_RENTAL: "Авто",
      BREAKFAST: "Завтрак",
      MOTORBIKE_RENTAL: "Мотобайк",
      MASSAGE: "Массаж",
      BARBER: "Барбер",
      FRUIT: "Фрукты",
    },
    receipt: {
      entryTitle: "Итоговый расчёт",
      entryHint: "Расчёт при выезде завершён. Проверьте суммы и возврат депозита.",
      entryCta: "Открыть итоговый расчёт",
      pageTitle: "Итоговый расчёт",
      pageSubtitle: "Результаты расчёта при выезде.",
      reservationTitle: "Бронирование",
      guestLabel: "Гость",
      minibarTitle: "Мини-бар",
      minibarEmpty: "Мини-бар не использовался.",
      qtyUnit: (n) => `${n}`,
      serviceTitle: "Дополнительные услуги",
      serviceEmpty: "Дополнительные услуги не использовались.",
      usageTitle: "Итого к оплате",
      usageApprox: (v) => `Итого в пересчёте ≈ ${v}`,
      depositTitle: "Расчёт депозита",
      depositReceived: "Внесённый депозит",
      depositOffset: "Зачтено в счёт оплаты",
      damageDeduct: "Удержание за ущерб",
      totalDeduct: "Всего удержано",
      refund: "Возврат",
      paymentTitle: "Оплата",
      paidLabel: "Оплачено",
      outstandingLabel: "Остаток к оплате",
      methodCash: "Наличные",
      methodBank: "Банковский перевод",
      methodOther: "Другое",
      methodDeposit: "Из депозита",
      settledAtLabel: "Дата расчёта",
      note: "Это результат расчёта на момент выезда. По вопросам обращайтесь в ваше турагентство.",
    },
    footerNote: "По вопросам обращайтесь в ваше турагентство.",
  },

  // ─────────────────────────────── 中文(简体) ───────────────────────────────
  zh: {
    brandTagline: "自助入住",
    next: "下一步",
    back: "返回",
    confirm: "确认",
    done: "完成",
    steps: { amenities: "设施确认", agreement: "使用同意", passport: "护照照片", done: "完成" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "自助入住",
      title: "开始办理入住",
      subtitle: "抵达前先确认设施、签署同意书并选择选项，可加快现场流程。",
      badgeConfirmed: "预订确认",
      stayChargeLabel: "住宿费用",
      nights: (n) => `${n}晚`,
      guests: (n) => `成人${n}人`,
      breakfastOn: "含早餐",
      breakfastOff: "不含早餐",
      privacyNote: "此链接仅对应您的一笔预订。大约2分钟即可完成。",
      startCta: "开始办理入住",
    },
    amenities: {
      title: "设施确认",
      intro: "以下是别墅内配备的设施用品。请简单确认后继续。",
      minibarTitle: "迷你吧",
      minibarPaid: "消费需付费",
      stocked: (n) => `配备${n}个`,
      minibarNote: "您消费的迷你吧将在退房时结算（现金/转账）。",
      confirmCheck: "我已确认设施用品",
      categories: { KITCHEN: "厨房", BATHROOM: "浴室", APPLIANCE: "电器", MINIBAR: "迷你吧" },
    },
    agreement: {
      title: "使用同意书",
      docTitleFallback: "别墅使用同意书",
      versionChip: (v) => `版本 ${v}`,
      signLabel: "签名",
      clear: "清除",
      signPrompt: "请在此处签名",
      signUploading: "上传中…",
      agreeCheck: "我同意以上内容并签名",
      submitCta: "同意并完成签名",
      submitting: "处理中…",
      alreadySigned: "使用同意书已完成签名。",
      alreadySignedAt: (v) => `版本 ${v}`,
      error: "签名处理出现问题，请稍后再试。",
    },
    passport: {
      title: "护照照片",
      intro: "请为每位住客各拍摄一张护照照片。",
      privacyNote: "仅用于临时居住登记，并以非公开方式安全保管。",
      slotLabel: (n) => `住客 ${n}`,
      addPhoto: "拍摄 / 选择照片",
      retake: "重新选择",
      uploading: "上传中…",
      uploaded: "已上传",
      error: "上传出现问题，请重试。",
      processFailed: "无法处理这张照片，请重新拍摄。",
      skip: "稍后再做",
      finishCta: "完成入住",
    },
    addons: {
      title: "附加选项",
      pageIntro: "入住期间您可随时申请所需选项。",
      banner: "请求经运营者确认后即确定。付款于退房时以现金/转账结算。",
      optionLabel: "选择选项",
      timeLabel: "选择时长",
      typeLabel: "种类",
      addonsLabel: "选择细项",
      addonsTrigger: (n) => `选择细项 (${n})`,
      selectedCount: (n) => `已选${n}个`,
      apply: "应用",
      sheetTitle: "选择细项",
      sheetHint: "可选择多项",
      estTotal: "合计（预估）",
      itemTotal: "小计",
      requestCta: "请求这些选项",
      requesting: "提交中…",
      requested: "您的请求已受理。",
      error: "处理时出现问题，请稍后再试。",
      configError: "此项目的设置有问题，请联系运营方。",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "请选择选项",
      goNext: "不选选项直接完成",
      serviceDateLabel: "期望日期",
      serviceDatePlaceholder: "选择日期",
      serviceTimeLabel: "期望时间",
      serviceTimePlaceholder: "例如 14:00",
      noteLabel: "特殊要求（选填）",
      notePlaceholder: "如有特殊要求请填写（例如：重点按左腿、早餐过敏）",
      customerNameLabel: "使用者姓名",
      customerNameHint: "接受服务者的姓名 — 将转达给服务方。",
      customerNamePlaceholder: "请输入姓名",
      ticketPeopleTitle: "门票使用者信息",
      ticketPeopleHint: "使用门票的客人信息。身高在此填写一次即适用于所有门票。",
      ticketGuestTitle: "选择门票使用者",
      ticketGuestHint: "请从已入住的住客名单中选择使用此门票的人。按所选人数出票。",
      ticketGuestVariantHint: "请为每位使用者选择类别。不同类别分别出票。",
      ticketGuestAutoHint: "系统会根据出生日期和身高自动判定类别。不同类别分别出票。",
      ticketGuestManualHint: "无法自动判定——请手动选择。",
      ticketHeightLabel: "身高",
      ticketHeightPlaceholder: "例如 120",
      ticketHeightNotice: "身高将在现场重新测量。若与申报不符，可能在现场补差价。",
      ticketVariantRequired: "请为每位门票使用者选择类别",
      priceInquiry: "价格咨询",
      rateNote: "按今日汇率",
      backToCheckin: "返回入住页面",
      empty: "目前没有可申请的选项。",
      myOrders: "申请记录",
      dateTimeRequired: "请选择您希望的日期和时间。",
      fulfillDelivery: "将按您选择的日期·时间配送/提供至您的别墅。",
      fulfillAppointment: "在您预约的时间进行。是否提供接送（车辆）将由管理员确认后告知。",
      fulfillPickup: "将在您预约的时间派车接您（提供接送）。",
      fulfillVisit: "需要您亲自前往店内。",
      fulfillOther: "我们将以您选择的日期·时间为准为您安排。",
    },
    result: {
      title: "入住信息\n已受理",
      subtitle: "您抵达后我们将迅速为您安排。",
      agreementDone: "使用同意书签名完成",
      agreementDoneAt: (v) => `版本 ${v}`,
      requestedTitle: "已请求的选项",
      statusPending: "服务方确认中",
      statusConfirmed: "已确定",
      statusOther: "已处理",
      statusCancelled: "已取消",
      estTotal: "预估合计",
      settleNote: "迷你吧及所选选项将在退房时结算（现金/转账）。运营者确认后将告知最终金额。",
      empty: "尚未请求任何选项。",
      finishCta: "确认",
      openOptionsCta: "申请附加选项",
      optionsHint: "可申请入住期间所需服务，如烧烤、按摩、用车等。",
      orderedBanner: "申请完成 — 已直接发送给服务方。对方确认后，您可在本页面查看确定状态。",
      vendorContactLabel: "服务方",
      vendorContactHint: "如有疑问，请直接联系服务方。",
      ticketContactNotice: "门票相关问题，请联系 Villa Go。",
      ticketContactKakao: "KakaoTalk 咨询",
      ticketContactPhone: "电话联系",
    },
    access: {
      title: "出入信息",
      addressLabel: "地址",
      mapLink: "在地图中查看",
      wifiTitle: "Wi-Fi",
      wifiSsidLabel: "网络名称",
      wifiPwLabel: "密码",
      copy: "复制",
      copied: "已复制",
      wifiLocked: "签署同意书后显示。",
    },
    checkout: {
      summaryTitle: "申请合计",
      pendingLabel: "待确认",
      confirmedLabel: "已确定",
      pendingTotal: "待确认合计",
      confirmedTotal: "已确定合计",
      grandTotal: "申请合计",
      cancel: "取消",
      cancelling: "取消中…",
      cancelConfirm: "确定取消此申请吗？",
      cancelError: "取消失败，请稍后再试。",
      cancelDispatched: "已开始准备，无法自行取消。请联系运营方。",
    },
    tickets: {
      title: (n) => `我的门票（${n}张）`,
      partial: (issued, needed) => `已出票 ${issued}/${needed} 张，其余正在准备中。`,
      hint: "入场时请出示二维码。",
      close: "关闭",
      save: "保存",
      saveAll: "保存全部门票",
      offlineHint: "现场可能无法上网，请提前保存门票。",
      iosHint: "也可长按图片保存到相册。",
      freeEntry: "免费入场，无需门票",
    },
    proposal: {
      banner: "服务方建议更改时间 — 请在下方确认。",
      title: "时间变更建议",
      originalLabel: "原时间",
      proposedLabel: "建议时间",
      noteLabel: "服务方备注",
      accept: "同意",
      decline: "拒绝",
      processing: "处理中…",
      declinedNote: "您已拒绝该建议。服务方将重新确认并告知时间。",
      error: "处理时出现问题，请稍后再试。",
    },
    serviceTypes: {
      ALL: "全部",
      BBQ: "烧烤",
      TICKET: "门票",
      GUIDE: "向导",
      CAR_RENTAL: "租车",
      BREAKFAST: "早餐",
      MOTORBIKE_RENTAL: "摩托车",
      MASSAGE: "按摩",
      BARBER: "理发",
      FRUIT: "水果",
    },
    receipt: {
      entryTitle: "结算明细",
      entryHint: "退房结算已完成。请查看消费金额与押金退还明细。",
      entryCta: "查看结算明细（收据）",
      pageTitle: "结算明细",
      pageSubtitle: "退房结算结果。",
      reservationTitle: "预订信息",
      guestLabel: "预订人",
      minibarTitle: "迷你吧消费",
      minibarEmpty: "未使用迷你吧。",
      qtyUnit: (n) => `${n}`,
      serviceTitle: "附加服务明细",
      serviceEmpty: "未使用附加服务。",
      usageTitle: "消费总额",
      usageApprox: (v) => `折算合计 ≈ ${v}`,
      depositTitle: "押金结算",
      depositReceived: "已收押金",
      depositOffset: "抵扣消费",
      damageDeduct: "损坏扣除",
      totalDeduct: "扣除总额",
      refund: "退款",
      paymentTitle: "支付明细",
      paidLabel: "收款",
      outstandingLabel: "未收余额",
      methodCash: "现金",
      methodBank: "银行转账",
      methodOther: "其他",
      methodDeposit: "押金抵扣",
      settledAtLabel: "结算时间",
      note: "本明细为退房时点的结算结果。如有疑问，请联系您预订的旅行社。",
    },
    footerNote: "如有疑问，请联系您预订的旅行社。",
  },

  // ─────────────────────────────── Tiếng Việt ───────────────────────────────
  vi: {
    brandTagline: "Tự nhận phòng",
    next: "Tiếp",
    back: "Quay lại",
    confirm: "Xác nhận",
    done: "Hoàn tất",
    steps: { amenities: "Tiện nghi", agreement: "Đồng ý", passport: "Hộ chiếu", done: "Hoàn tất" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "Tự nhận phòng",
      title: "Bắt đầu nhận phòng",
      subtitle: "Kiểm tra tiện nghi, ký bản đồng ý và chọn tùy chọn trước khi đến giúp thủ tục tại chỗ nhanh hơn.",
      badgeConfirmed: "Đã xác nhận",
      stayChargeLabel: "Phí lưu trú",
      nights: (n) => `${n} đêm`,
      guests: (n) => `${n} người lớn`,
      breakfastOn: "Gồm bữa sáng",
      breakfastOff: "Không bữa sáng",
      privacyNote: "Liên kết này chỉ gắn với một đặt phòng của bạn. Mất khoảng 2 phút.",
      startCta: "Tiến hành nhận phòng",
    },
    amenities: {
      title: "Tiện nghi",
      intro: "Đây là các tiện nghi có sẵn trong biệt thự. Vui lòng kiểm tra nhanh rồi tiếp tục.",
      minibarTitle: "Minibar",
      minibarPaid: "Có phí nếu sử dụng",
      stocked: (n) => `Có sẵn ${n}`,
      minibarNote: "Các món minibar bạn dùng sẽ được tính khi trả phòng (tiền mặt/chuyển khoản).",
      confirmCheck: "Tôi đã kiểm tra tiện nghi",
      categories: { KITCHEN: "Bếp", BATHROOM: "Phòng tắm", APPLIANCE: "Thiết bị điện", MINIBAR: "Minibar" },
    },
    agreement: {
      title: "Bản đồng ý",
      docTitleFallback: "Bản đồng ý sử dụng biệt thự",
      versionChip: (v) => `Phiên bản ${v}`,
      signLabel: "Chữ ký",
      clear: "Xóa",
      signPrompt: "Ký tại đây",
      signUploading: "Đang tải lên…",
      agreeCheck: "Tôi đồng ý với nội dung trên và ký tên",
      submitCta: "Đồng ý & ký",
      submitting: "Đang xử lý…",
      alreadySigned: "Đã ký bản đồng ý sử dụng.",
      alreadySignedAt: (v) => `Phiên bản ${v}`,
      error: "Đã xảy ra lỗi khi ký. Vui lòng thử lại sau.",
    },
    passport: {
      title: "Ảnh hộ chiếu",
      intro: "Vui lòng chụp một ảnh hộ chiếu cho mỗi khách lưu trú.",
      privacyNote: "Chỉ dùng để khai báo tạm trú và được lưu giữ riêng tư, an toàn.",
      slotLabel: (n) => `Khách ${n}`,
      addPhoto: "Chụp / chọn ảnh",
      retake: "Chọn lại",
      uploading: "Đang tải lên…",
      uploaded: "Đã tải lên",
      error: "Tải lên gặp sự cố. Vui lòng thử lại.",
      processFailed: "Không thể xử lý ảnh này. Vui lòng chụp lại.",
      skip: "Để sau",
      finishCta: "Hoàn tất nhận phòng",
    },
    addons: {
      title: "Tùy chọn bổ sung",
      pageIntro: "Bạn có thể yêu cầu tùy chọn bất cứ lúc nào trong thời gian lưu trú.",
      banner: "Yêu cầu được xác nhận sau khi người vận hành kiểm tra. Thanh toán khi trả phòng (tiền mặt/chuyển khoản).",
      optionLabel: "Chọn tùy chọn",
      timeLabel: "Chọn thời lượng",
      typeLabel: "Loại",
      addonsLabel: "Chọn dịch vụ thêm",
      addonsTrigger: (n) => `Chọn dịch vụ thêm (${n})`,
      selectedCount: (n) => `Đã chọn ${n}`,
      apply: "Áp dụng",
      sheetTitle: "Chọn dịch vụ thêm",
      sheetHint: "Bạn có thể chọn nhiều",
      estTotal: "Tổng (dự kiến)",
      itemTotal: "Tổng",
      requestCta: "Yêu cầu các tùy chọn này",
      requesting: "Đang gửi…",
      requested: "Đã nhận yêu cầu của bạn.",
      error: "Đã xảy ra lỗi. Vui lòng thử lại sau.",
      configError: "Mục này có vấn đề về thiết lập. Vui lòng liên hệ người điều hành.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "Vui lòng chọn tùy chọn",
      goNext: "Hoàn tất không chọn tùy chọn",
      serviceDateLabel: "Ngày mong muốn",
      serviceDatePlaceholder: "Chọn ngày",
      serviceTimeLabel: "Giờ mong muốn",
      serviceTimePlaceholder: "vd: 14:00",
      noteLabel: "Yêu cầu thêm (không bắt buộc)",
      notePlaceholder: "Cho chúng tôi biết yêu cầu đặc biệt (vd: tập trung chân trái, dị ứng bữa sáng)",
      customerNameLabel: "Tên người dùng dịch vụ",
      customerNameHint: "Tên người nhận dịch vụ — sẽ được gửi cho nhà cung cấp.",
      customerNamePlaceholder: "Nhập tên",
      ticketPeopleTitle: "Thông tin người dùng vé",
      ticketPeopleHint: "Thông tin những người dùng vé. Chỉ cần nhập chiều cao một lần ở đây, áp dụng cho tất cả vé.",
      ticketGuestTitle: "Chọn người dùng vé",
      ticketGuestHint: "Chọn người sẽ dùng vé này từ danh sách khách đã nhận phòng. Xuất vé theo số người được chọn.",
      ticketGuestVariantHint: "Chọn loại vé cho từng khách. Mỗi loại được xuất vé riêng.",
      ticketGuestAutoHint: "Loại vé được xác định tự động theo ngày sinh và chiều cao. Mỗi loại được xuất vé riêng.",
      ticketGuestManualHint: "Không xác định tự động được — vui lòng chọn.",
      ticketHeightLabel: "Chiều cao",
      ticketHeightPlaceholder: "vd: 120",
      ticketHeightNotice: "Chiều cao sẽ được đo lại tại chỗ. Nếu khác với khai báo, có thể phải trả thêm phần chênh lệch.",
      ticketVariantRequired: "Chọn loại vé cho từng khách",
      priceInquiry: "Hỏi giá",
      rateNote: "Theo tỷ giá hôm nay",
      backToCheckin: "Về trang nhận phòng",
      empty: "Hiện chưa có tùy chọn nào.",
      myOrders: "Lịch sử yêu cầu",
      dateTimeRequired: "Vui lòng chọn ngày và giờ mong muốn.",
      fulfillDelivery: "Được giao/phục vụ tận villa theo ngày · giờ bạn chọn.",
      fulfillAppointment: "Thực hiện vào giờ đã đặt. Khả năng đón (xe đưa rước) sẽ được nhân viên xác nhận.",
      fulfillPickup: "Sẽ có xe đến đón bạn vào giờ đã đặt (có đưa rước).",
      fulfillVisit: "Bạn cần tự đến cửa hàng.",
      fulfillOther: "Chúng tôi sẽ hỗ trợ dựa trên ngày · giờ bạn đã chọn.",
    },
    result: {
      title: "Thông tin nhận phòng\nđã được ghi nhận",
      subtitle: "Khi bạn đến, chúng tôi sẽ hỗ trợ nhanh chóng.",
      agreementDone: "Đã ký bản đồng ý sử dụng",
      agreementDoneAt: (v) => `Phiên bản ${v}`,
      requestedTitle: "Tùy chọn đã yêu cầu",
      statusPending: "Đang chờ nhân viên xác nhận",
      statusConfirmed: "Đã xác nhận",
      statusOther: "Đã xử lý",
      statusCancelled: "Đã hủy",
      estTotal: "Tổng dự kiến",
      settleNote: "Minibar và các tùy chọn đã chọn sẽ được tính khi trả phòng (tiền mặt/chuyển khoản). Người vận hành sẽ xác nhận số tiền cuối cùng.",
      empty: "Chưa yêu cầu tùy chọn nào.",
      finishCta: "Xác nhận",
      openOptionsCta: "Yêu cầu tùy chọn bổ sung",
      optionsHint: "Yêu cầu dịch vụ cần trong thời gian lưu trú như BBQ, massage, thuê xe.",
      orderedBanner: "Đã gửi yêu cầu — chuyển thẳng đến nhân viên phụ trách. Khi họ xác nhận, bạn sẽ thấy trạng thái đã xác nhận trên trang này.",
      vendorContactLabel: "Nhân viên phụ trách",
      vendorContactHint: "Mọi thắc mắc, vui lòng liên hệ trực tiếp nhân viên phụ trách.",
      ticketContactNotice: "Mọi thắc mắc về vé, vui lòng liên hệ Villa Go.",
      ticketContactKakao: "KakaoTalk",
      ticketContactPhone: "Gọi điện",
    },
    access: {
      title: "Thông tin ra vào",
      addressLabel: "Địa chỉ",
      mapLink: "Mở trên bản đồ",
      wifiTitle: "Wi-Fi",
      wifiSsidLabel: "Tên mạng",
      wifiPwLabel: "Mật khẩu",
      copy: "Sao chép",
      copied: "Đã sao chép",
      wifiLocked: "Hiển thị sau khi bạn ký bản đồng ý.",
    },
    checkout: {
      summaryTitle: "Tổng yêu cầu",
      pendingLabel: "Chờ xác nhận",
      confirmedLabel: "Đã xác nhận",
      pendingTotal: "Tổng chờ xác nhận",
      confirmedTotal: "Tổng đã xác nhận",
      grandTotal: "Tổng yêu cầu",
      cancel: "Hủy",
      cancelling: "Đang hủy…",
      cancelConfirm: "Hủy yêu cầu này?",
      cancelError: "Không thể hủy. Vui lòng thử lại sau.",
      cancelDispatched: "Đã bắt đầu chuẩn bị nên bạn không thể tự hủy. Vui lòng liên hệ người điều hành.",
    },
    tickets: {
      title: (n) => `Vé của tôi (${n})`,
      partial: (issued, needed) => `Mới phát hành ${issued}/${needed} vé — số còn lại đang được chuẩn bị.`,
      hint: "Xuất trình mã QR khi vào cổng.",
      close: "Đóng",
      save: "Lưu",
      saveAll: "Lưu tất cả vé",
      offlineHint: "Tại chỗ có thể không có internet. Hãy lưu vé trước.",
      iosHint: "Bạn cũng có thể nhấn giữ ảnh để lưu vào Ảnh.",
      freeEntry: "Vào cửa miễn phí — không cần vé",
    },
    proposal: {
      banner: "Nhân viên phụ trách đề xuất đổi giờ — vui lòng xác nhận bên dưới.",
      title: "Đề xuất đổi giờ",
      originalLabel: "Giờ ban đầu",
      proposedLabel: "Giờ đề xuất",
      noteLabel: "Ghi chú của nhân viên",
      accept: "Đồng ý",
      decline: "Từ chối",
      processing: "Đang xử lý…",
      declinedNote: "Bạn đã từ chối đề xuất. Nhân viên sẽ kiểm tra lại và thông báo giờ.",
      error: "Đã xảy ra lỗi. Vui lòng thử lại sau.",
    },
    serviceTypes: {
      ALL: "Tất cả",
      BBQ: "BBQ",
      TICKET: "Vé",
      GUIDE: "Hướng dẫn",
      CAR_RENTAL: "Thuê xe",
      BREAKFAST: "Bữa sáng",
      MOTORBIKE_RENTAL: "Xe máy",
      MASSAGE: "Massage",
      BARBER: "Cắt tóc",
      FRUIT: "Trái cây",
    },
    receipt: {
      entryTitle: "Chi tiết quyết toán",
      entryHint: "Quyết toán khi trả phòng đã hoàn tất. Xem chi phí sử dụng và hoàn tiền đặt cọc.",
      entryCta: "Xem chi tiết quyết toán (hóa đơn)",
      pageTitle: "Chi tiết quyết toán",
      pageSubtitle: "Kết quả quyết toán khi trả phòng.",
      reservationTitle: "Thông tin đặt phòng",
      guestLabel: "Người đặt",
      minibarTitle: "Minibar đã dùng",
      minibarEmpty: "Không sử dụng minibar.",
      qtyUnit: (n) => `${n}`,
      serviceTitle: "Dịch vụ bổ sung",
      serviceEmpty: "Không sử dụng dịch vụ bổ sung.",
      usageTitle: "Tổng chi phí",
      usageApprox: (v) => `Tổng quy đổi ≈ ${v}`,
      depositTitle: "Quyết toán đặt cọc",
      depositReceived: "Tiền cọc đã nhận",
      depositOffset: "Cấn trừ vào chi phí",
      damageDeduct: "Khấu trừ hư hỏng",
      totalDeduct: "Tổng khấu trừ",
      refund: "Hoàn lại",
      paymentTitle: "Thanh toán",
      paidLabel: "Đã thu",
      outstandingLabel: "Số tiền còn thiếu",
      methodCash: "Tiền mặt",
      methodBank: "Chuyển khoản",
      methodOther: "Khác",
      methodDeposit: "Trừ vào tiền cọc",
      settledAtLabel: "Thời điểm quyết toán",
      note: "Đây là kết quả quyết toán tại thời điểm trả phòng. Mọi thắc mắc vui lòng liên hệ công ty du lịch của bạn.",
    },
    footerNote: "Mọi thắc mắc vui lòng liên hệ công ty du lịch của bạn.",
  },
};
