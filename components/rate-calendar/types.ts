// 기간별 요금 캘린더 — 공용 타입 (rate-calendar-ux)
//
// 운영자(admin, 다크 ko)와 공급자(supplier, 라이트 vi) 두 모드가 공유하는 컴포넌트 계약.
// ★ 마진 비공개 원칙(사업원칙 2): 가격 데이터는 mode별로 **부모가 주입**한다. 컴포넌트는 스스로 fetch하지
//   않으며, supplier 모드에는 net/consumer/premium Net 계열 필드가 null로 들어와(부모가 select 제외)
//   DOM·메모리 어디에도 흐르지 않는다. admin만 3축(net/consumer/cost)을 채운다.

import type { MarginType, SeasonType } from "@prisma/client";

export type CalendarMode = "admin" | "supplier";

/** 가격 축 — admin은 3축 전환, supplier는 'cost'만. */
export type Axis = "net" | "consumer" | "cost";

export type Season = SeasonType; // "LOW" | "SHOULDER" | "HIGH" | "PEAK"

/**
 * 부모(RSC)가 직렬화해 주입하는 레이어 DTO. BigInt는 문자열(동 단위), KRW는 number.
 * ★ supplier 모드: net·consumer·premiumNet·premiumConsumer 계열은 부모가 null로 주입(누수 차단).
 *   admin 모드: 전 필드 채움.
 */
export interface RateLayerDTO {
  id: string;
  isBase: boolean;
  season: Season;
  startDate: string | null; // YYYY-MM-DD (base는 null)
  endDate: string | null; // YYYY-MM-DD half-open (base는 null)
  label: string | null;
  batchId: string | null;
  // 원가 축 (supplier·admin 공통)
  costVnd: string;
  // 판매 축 (admin 전용 — supplier는 null)
  netVnd: string | null;
  netKrw: number | null;
  consumerVnd: string | null;
  consumerKrw: number | null;
  // 프리미엄 컬럼 (admin 전용 — supplier는 null). null = 평일가 폴백.
  premiumCostVnd: string | null;
  premiumNetVnd: string | null;
  premiumNetKrw: number | null;
  premiumConsumerVnd: string | null;
  premiumConsumerKrw: number | null;
  // 마진(편집 폼 자동제안 재산출용) — admin 전용
  marginType: MarginType;
  marginValue: string;
  consumerMarginType: MarginType;
  consumerMarginValue: string;
}

/** 공휴일(전역) — ★ 표시 + 프리미엄 판정. */
export interface HolidayDTO {
  /** YYYY-MM-DD (UTC 자정) */
  date: string;
  label: string;
}

/**
 * 클라 내부 작업 모델 — DTO를 파싱해 Date·BigInt로 변환한 행.
 * resolveRatePeriod(승자 판정)는 season/isBase/날짜/id만 읽으므로 가격 필드는 표시·페이로드용.
 */
export interface WorkLayer {
  id: string;
  isBase: boolean;
  season: Season;
  start: Date | null;
  end: Date | null;
  label: string | null;
  batchId: string | null;
  cost: bigint;
  net: bigint | null;
  netKrw: number | null;
  consumer: bigint | null;
  consumerKrw: number | null;
  pCost: bigint | null;
  pNet: bigint | null;
  pNetKrw: number | null;
  pConsumer: bigint | null;
  pConsumerKrw: number | null;
  marginType: MarginType;
  marginValue: string;
  consumerMarginType: MarginType;
  consumerMarginValue: string;
}

/** 서버 priceColumns 스키마와 동일 집합의 가격 페이로드(레이어 생성·SET·편집 공용). */
export interface PricePayload {
  supplierCostVnd: string;
  marginType: MarginType;
  marginValue: string;
  salePriceVnd: string;
  salePriceKrw: number;
  consumerMarginType: MarginType;
  consumerMarginValue: string;
  consumerSalePriceVnd: string | null;
  consumerSalePriceKrw: number | null;
  premiumSupplierCostVnd: string | null;
  premiumSalePriceVnd: string | null;
  premiumSalePriceKrw: number | null;
  premiumConsumerSalePriceVnd: string | null;
  premiumConsumerSalePriceKrw: number | null;
}

export const SEASON_LIST: Season[] = ["LOW", "SHOULDER", "HIGH", "PEAK"];

/** 시즌색 CSS 변수(globals.css rate-calendar 토큰). */
export const SEASON_VAR: Record<Season, string> = {
  LOW: "var(--rc-low)",
  SHOULDER: "var(--rc-shoulder)",
  HIGH: "var(--rc-high)",
  PEAK: "var(--rc-peak)",
};
