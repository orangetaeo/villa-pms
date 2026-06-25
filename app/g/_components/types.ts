// app/g/_components/types.ts — 게스트 셀프 체크인 클라이언트 props 타입 (ADR-0019 S3)
//   ★ 서버가 직렬화해 클라로 넘기는 데이터: 판매가만(원가·마진·타예약 0). VND는 문자열.
import type { PublicLang } from "@/lib/public-i18n";

export interface GuestBookingView {
  villaName: string;
  complex: string | null;
  checkIn: string; // ISO
  checkOut: string; // ISO
  nights: number;
  guestCount: number;
  breakfastIncluded: boolean;
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

/** G4 옵션 카드 — options는 파싱·언어해석 완료된 형태 */
export interface GuestOption {
  key: string;
  label: string; // 언어별 라벨
  priceKrw: number | null;
  priceVnd: string | null;
}

export interface GuestCatalogView {
  id: string;
  type: string;
  name: string; // 언어별 이름
  desc: string | null;
  unitLabel: string | null;
  priceKrw: number | null;
  priceVnd: string | null;
  photoUrl: string | null;
  variants: GuestOption[];
  addons: GuestOption[];
  modifiers: GuestOption[];
}

export interface GuestRequestedOrder {
  id: string;
  type: string;
  name: string;
  status: string;
  quantity: number;
  priceKrw: number | null;
  priceVnd: string | null;
}

export interface GuestFlowProps {
  token: string;
  lang: PublicLang;
  alreadySigned: boolean;
  signedVersion: string | null;
  booking: GuestBookingView;
  amenityGroups: GuestAmenityGroup[];
  minibar: GuestMinibarView[];
  agreement: {
    version: string;
    docTitle: string;
    clauses: { key: string; content: string }[];
  };
  catalog: GuestCatalogView[];
  requestedOrders: GuestRequestedOrder[];
}
