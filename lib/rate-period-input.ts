// 기간별 요금 입력 — zod fragment + prisma data 빌더 (rate-calendar-ux)
//
// 레이어 CRUD·일괄(batch) 라우트가 공유하는 운영자 가격 컬럼 검증/변환. 메인 전체교체 PATCH의
// priceFields와 동일 필드 집합(운영자 전용 — supplierSalePriceVnd 등 공급자 컬럼은 포함하지 않음:
// 그 컬럼은 공급자 cost 라우트가 관리). BigInt는 문자열 수신(float 금지), KRW는 Int.
import { z } from "zod";

export const digits = z.string().regex(/^\d{1,15}$/); // VND 동·퍼센트 — BigInt 문자열 수신
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD (UTC 자정 변환)
export const SEASONS = ["LOW", "SHOULDER", "HIGH", "PEAK"] as const;
export const toUtc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** 가격 컬럼 fragment(시즌·라벨·날짜 제외) — base/period/SET 공용. 메인 PATCH priceFields와 동일 집합. */
export const priceColumns = {
  supplierCostVnd: digits,
  marginType: z.enum(["PERCENT", "FIXED_VND"]),
  marginValue: digits,
  salePriceVnd: digits,
  salePriceKrw: z.number().int().min(0),
  consumerMarginType: z.enum(["PERCENT", "FIXED_VND"]).default("PERCENT"),
  consumerMarginValue: digits.default("0"),
  consumerSalePriceVnd: digits.nullable().optional(),
  consumerSalePriceKrw: z.number().int().min(0).nullable().optional(),
  premiumSupplierCostVnd: digits.nullable().optional(),
  premiumSalePriceVnd: digits.nullable().optional(),
  premiumSalePriceKrw: z.number().int().min(0).nullable().optional(),
  premiumConsumerSalePriceVnd: digits.nullable().optional(),
  premiumConsumerSalePriceKrw: z.number().int().min(0).nullable().optional(),
} as const;

export type PriceColumnsInput = z.infer<z.ZodObject<typeof priceColumns>>;

/** 검증된 가격 컬럼 입력 → prisma create data(가격 컬럼만; villaId·season·isBase·날짜·batchId는 호출자). */
export function buildPriceColumnData(p: PriceColumnsInput) {
  return {
    supplierCostVnd: BigInt(p.supplierCostVnd),
    marginType: p.marginType,
    marginValue: BigInt(p.marginValue),
    salePriceVnd: BigInt(p.salePriceVnd),
    salePriceKrw: p.salePriceKrw,
    consumerMarginType: p.consumerMarginType,
    consumerMarginValue: BigInt(p.consumerMarginValue),
    consumerSalePriceVnd: p.consumerSalePriceVnd != null ? BigInt(p.consumerSalePriceVnd) : null,
    consumerSalePriceKrw: p.consumerSalePriceKrw ?? null,
    premiumSupplierCostVnd: p.premiumSupplierCostVnd != null ? BigInt(p.premiumSupplierCostVnd) : null,
    premiumSalePriceVnd: p.premiumSalePriceVnd != null ? BigInt(p.premiumSalePriceVnd) : null,
    premiumSalePriceKrw: p.premiumSalePriceKrw ?? null,
    premiumConsumerSalePriceVnd:
      p.premiumConsumerSalePriceVnd != null ? BigInt(p.premiumConsumerSalePriceVnd) : null,
    premiumConsumerSalePriceKrw: p.premiumConsumerSalePriceKrw ?? null,
  };
}

/**
 * 일괄 작업의 소스/승자 행 클론에 필요한 전체 컬럼 select. 공급자 자기 판매가 컬럼(supplierSalePriceVnd·
 * premiumSupplierSalePriceVnd)도 포함해 연도복사·조정이 그 값을 보존/조정한다(운영자 라우트 — 누수 아님).
 */
export const RATE_PERIOD_FULL_SELECT = {
  id: true,
  season: true,
  isBase: true,
  startDate: true,
  endDate: true,
  label: true,
  supplierCostVnd: true,
  marginType: true,
  marginValue: true,
  salePriceVnd: true,
  salePriceKrw: true,
  consumerMarginType: true,
  consumerMarginValue: true,
  consumerSalePriceVnd: true,
  consumerSalePriceKrw: true,
  supplierSalePriceVnd: true,
  premiumSupplierCostVnd: true,
  premiumSalePriceVnd: true,
  premiumSalePriceKrw: true,
  premiumConsumerSalePriceVnd: true,
  premiumConsumerSalePriceKrw: true,
  premiumSupplierSalePriceVnd: true,
} as const;
