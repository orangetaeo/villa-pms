// 기간별 요금 캘린더 — 가격 폼 상태 + 원가+마진→판매가 자동제안 (rate-calendar-ux)
//
// 구 rate-period-editor.tsx(삭제됨)에서 추출·이관한 suggestMarkupVnd/suggestKrw/withSuggestion 로직.
// 원가 변경 → Net(원가+마진) 재산출 → 소비자가(Net+소비자마진) 연쇄, 프리미엄도 동형(다른 원가 베이스).
// 금액은 BigInt 정수 연산(float 금지). KRW 환산만 환율 나눗셈 + 1,000원 반올림.
import type { MarginType } from "@prisma/client";
import type { PricePayload } from "./types";

export interface PriceFormState {
  season: string; // Season
  supplierCostVnd: string;
  marginType: MarginType;
  marginValue: string;
  salePriceVnd: string;
  salePriceKrw: number;
  consumerMarginType: MarginType;
  consumerMarginValue: string;
  consumerSalePriceVnd: string;
  consumerSalePriceKrw: number;
  premiumEnabled: boolean;
  premiumSupplierCostVnd: string;
  premiumSalePriceVnd: string;
  premiumSalePriceKrw: number;
  premiumConsumerSalePriceVnd: string;
  premiumConsumerSalePriceKrw: number;
  label: string;
}

export const toDigits = (v: string): string => v.replace(/\D/g, "");

/** 판매가(VND) 자동 제안 = 원가 + 마진 (BigInt 정수 연산). Net·소비자가 공용(기준값만 다름) */
export function suggestMarkupVnd(baseVnd: string, marginType: MarginType, marginValue: string): string {
  const base = BigInt(baseVnd || "0");
  const margin = BigInt(marginValue || "0");
  return (marginType === "PERCENT" ? (base * (100n + margin)) / 100n : base + margin).toString();
}

/** 판매가(KRW) 환산 제안 — 1,000원 라운딩. 환율 없으면 null */
export function suggestKrw(saleVnd: string, fx: number | null): number | null {
  if (!fx || fx <= 0) return null;
  const vnd = Number(saleVnd || "0");
  if (!Number.isFinite(vnd)) return null;
  return Math.round(vnd / fx / 1000) * 1000;
}

/** 원가/마진 변경 시 판매가·소비자가·프리미엄 연쇄 재산출(구 rate-period-editor withSuggestion 동형·이관). */
export function withSuggestion(f: PriceFormState, fx: number | null): PriceFormState {
  const saleVnd = suggestMarkupVnd(f.supplierCostVnd, f.marginType, f.marginValue);
  const krw = suggestKrw(saleVnd, fx);
  const consumerVnd = suggestMarkupVnd(saleVnd, f.consumerMarginType, f.consumerMarginValue);
  const consumerKrw = suggestKrw(consumerVnd, fx);
  const next: PriceFormState = {
    ...f,
    salePriceVnd: saleVnd,
    salePriceKrw: krw ?? f.salePriceKrw,
    consumerSalePriceVnd: consumerVnd,
    consumerSalePriceKrw: consumerKrw ?? f.consumerSalePriceKrw,
  };
  if (f.premiumEnabled && f.premiumSupplierCostVnd) {
    const pSaleVnd = suggestMarkupVnd(f.premiumSupplierCostVnd, f.marginType, f.marginValue);
    const pKrw = suggestKrw(pSaleVnd, fx);
    const pConsumerVnd = suggestMarkupVnd(pSaleVnd, f.consumerMarginType, f.consumerMarginValue);
    const pConsumerKrw = suggestKrw(pConsumerVnd, fx);
    next.premiumSalePriceVnd = pSaleVnd;
    next.premiumSalePriceKrw = pKrw ?? f.premiumSalePriceKrw;
    next.premiumConsumerSalePriceVnd = pConsumerVnd;
    next.premiumConsumerSalePriceKrw = pConsumerKrw ?? f.premiumConsumerSalePriceKrw;
  }
  return next;
}

export function emptyPriceForm(season: string): PriceFormState {
  return {
    season,
    supplierCostVnd: "",
    marginType: "PERCENT",
    marginValue: "20",
    salePriceVnd: "",
    salePriceKrw: 0,
    consumerMarginType: "PERCENT",
    consumerMarginValue: "0",
    consumerSalePriceVnd: "",
    consumerSalePriceKrw: 0,
    premiumEnabled: false,
    premiumSupplierCostVnd: "",
    premiumSalePriceVnd: "",
    premiumSalePriceKrw: 0,
    premiumConsumerSalePriceVnd: "",
    premiumConsumerSalePriceKrw: 0,
    label: "",
  };
}

/** 폼 상태 → 서버 priceColumns 페이로드(레이어 생성·SET·편집 공용). 빈값/토글 OFF는 null(평일 폴백). */
export function toPricePayload(f: PriceFormState): PricePayload {
  const on = f.premiumEnabled;
  return {
    supplierCostVnd: f.supplierCostVnd || "0",
    marginType: f.marginType,
    marginValue: f.marginValue || "0",
    salePriceVnd: f.salePriceVnd || "0",
    salePriceKrw: f.salePriceKrw || 0,
    consumerMarginType: f.consumerMarginType,
    consumerMarginValue: f.consumerMarginValue || "0",
    consumerSalePriceVnd: f.consumerSalePriceVnd || null,
    consumerSalePriceKrw: f.consumerSalePriceKrw || null,
    premiumSupplierCostVnd: on && f.premiumSupplierCostVnd ? f.premiumSupplierCostVnd : null,
    premiumSalePriceVnd: on && f.premiumSalePriceVnd ? f.premiumSalePriceVnd : null,
    premiumSalePriceKrw: on && f.premiumSalePriceKrw ? f.premiumSalePriceKrw : null,
    premiumConsumerSalePriceVnd: on && f.premiumConsumerSalePriceVnd ? f.premiumConsumerSalePriceVnd : null,
    premiumConsumerSalePriceKrw: on && f.premiumConsumerSalePriceKrw ? f.premiumConsumerSalePriceKrw : null,
  };
}
