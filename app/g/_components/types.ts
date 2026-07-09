// app/g/_components/types.ts — 게스트 셀프 체크인 클라이언트 props 타입 (ADR-0019 S3)
//   ★ 서버가 직렬화해 클라로 넘기는 데이터: 판매가만(원가·마진·타예약 0). VND는 문자열.
import type { PublicLang } from "@/lib/public-i18n";
import type { DisplayCurrency } from "@/lib/fx-rates";

export interface GuestBookingView {
  villaName: string;
  complex: string | null;
  checkIn: string; // ISO
  checkOut: string; // ISO
  nights: number;
  guestCount: number;
  breakfastIncluded: boolean;
  // ── 출입 정보(A1) — 게스트 전용. /p 공개페이지엔 없음(원칙2). ──
  address: string | null; // 주소(있을 때만 지도 링크)
  wifiSsid: string | null; // 와이파이 이름
  wifiPassword: string | null; // ⚠ 비번 — 서버 로더가 서명 전엔 null(게이트), 서명 후에만 값 제공
  // 숙박 요금 — 직접 게스트(운영자 판매·파트너 없음)만 채워짐. 그 외 null(비노출)
  stayChargeVnd: string | null;
  stayChargeKrw: number | null;
}

/** G2 비품 — 카테고리별로 묶은 라벨(서버에서 lang 해석 완료) */
export interface GuestAmenityGroup {
  category: string; // KITCHEN/BATHROOM/APPLIANCE
  label: string; // 카테고리 라벨(언어별)
  items: string[]; // 품목 라벨(언어별, custom은 customLabel)
}

export interface GuestMinibarView {
  itemKey: string;
  name: string; // 언어별 이름(ko/vi 폴백)
  qty: number;
  priceVnd: string;
}

/** G4 옵션 카드 — options는 파싱·언어해석 완료된 형태. 가격은 VND 단일통화(KRW는 표시 시점 환율 파생). */
export interface GuestOption {
  key: string;
  label: string; // 언어별 라벨
  priceVnd: string | null;
  desc?: string | null; // 옵션별 설명(언어별) — 원가는 포함 안 함(누수 0)
}

export interface GuestCatalogView {
  id: string;
  type: string;
  name: string; // 언어별 이름
  desc: string | null;
  unitLabel: string | null;
  priceVnd: string | null;
  photoUrl: string | null;
  variants: GuestOption[];
  addons: GuestOption[];
  modifiers: GuestOption[];
  pickupAvailable: boolean | null; // 마사지·이발 픽업: null=미정·true=픽업·false=직접방문
  pickupNote: string | null; // 픽업/매장 안내(주소·조건)
}

export interface GuestRequestedOrder {
  id: string;
  type: string;
  name: string;
  status: string;
  quantity: number;
  priceKrw: number | null;
  priceVnd: string | null;
  /** 원천공급자에게 발주된(살아있는) 주문 — true면 셀프 취소 불가(취소버튼 숨김, 운영자 문의 안내). */
  dispatched: boolean;
  /** 선택한 옵션 라벨(언어 해석 완료) — 예: ["90분", "발 마사지 추가"]. 없으면 빈 배열. */
  optionLabels: string[];
  /** 희망 날짜(YYYY-MM-DD)·시간("HH:MM") — 신청 시 입력(필수). */
  serviceDate: string | null;
  serviceTime: string | null;
  /** 이행 안내 문구(서버에서 type·픽업설정으로 해석 완료) — 배송/픽업/방문. */
  fulfillNote: string;
}

export interface GuestAgreementView {
  version: string;
  docTitle: string;
  clauses: { key: string; content: string }[];
}

/** 체크인 흐름(예약→비품→동의→여권→완료) props — 옵션 선택은 별도 페이지로 분리. */
export interface GuestFlowProps {
  token: string;
  lang: PublicLang;
  alreadySigned: boolean;
  signedVersion: string | null;
  booking: GuestBookingView;
  amenityGroups: GuestAmenityGroup[];
  minibar: GuestMinibarView[];
  agreement: GuestAgreementView;
}

/** 하단 "오늘 환율 기준" 환산 — 언어 모국통화 1개. vi거나 API 장애 시 null(VND만 표기). */
export interface GuestConvert {
  currency: DisplayCurrency;
  vndPerUnit: number; // 1 통화단위 = X VND
}

/** 옵션 선택 페이지(/g/[token]/options) props — 체크인과 독립 라우트, 투숙 중 접근.
 *   ★요청 내역은 별도 페이지(/g/[token]/orders)로 분리 — 옵션이 많아져도 확인·정산이 쉽게. */
export interface GuestOptionsProps {
  token: string;
  lang: PublicLang;
  booking: GuestBookingView;
  catalog: GuestCatalogView[];
  /** 금액은 항상 VND 기본 표기. convert가 있으면 하단에 모국통화 환산액("오늘 환율 기준") 추가. */
  convert: GuestConvert | null;
}

/** 신청 내역 페이지(/g/[token]/orders) props — 요청한 옵션 목록 확인 + 부가 옵션 신청 진입. */
export interface GuestOrdersProps {
  token: string;
  lang: PublicLang;
  requestedOrders: GuestRequestedOrder[];
}
