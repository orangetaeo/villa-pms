// lib/service-catalog.ts — 부가서비스 카탈로그 순수 로직 (ADR-0019 S2)
//
// 카탈로그 항목의 옵션은 3종: variants(상호배타 1택, 기본가 대체) · addons(다중선택, 가산) · modifiers(토글, 가산).
//   게스트가 고른 옵션의 합계는 반드시 서버가 이 모듈로 재계산한다(클라가 보낸 금액 신뢰 금지 — 변조 방지, §9.5).
//   금액 단위: KRW=number(원), VND=BigInt(동). JSON 직렬화 위해 옵션의 VND는 "숫자문자열"로 보관.
//
// ★ 원가(costVnd)는 이 모듈이 다루지 않는다(판매가만). 원가·마진은 운영자(canViewFinance) 전용 — 호출측 게이트.

import type { ServiceType } from "@prisma/client";

/** VND 동 단위 비음수 정수 문자열(최대 15자리). */
export const SERVICE_VND_DIGITS = /^\d{1,15}$/;

export const SERVICE_TYPE_VALUES: readonly ServiceType[] = [
  "BBQ",
  "TICKET",
  "GUIDE",
  "CAR_RENTAL",
  "BREAKFAST",
  "MOTORBIKE_RENTAL",
  "MASSAGE",
  "BARBER",
] as const;

export function isServiceCatalogType(v: string): v is ServiceType {
  return (SERVICE_TYPE_VALUES as readonly string[]).includes(v);
}

/** 옵션 1개 정의 — variant/addon은 절대가격, modifier는 가산delta(같은 필드 재사용). */
export interface CatalogOptionDef {
  key: string;
  labelKo: string;
  labelVi?: string | null;
  /** KRW 금액(원, 정수) — variant=대체가, addon/modifier=가산액. */
  priceKrw?: number | null;
  /** VND 금액(동, "숫자문자열") — variant=대체가, addon/modifier=가산액. */
  priceVnd?: string | null;
}

export interface CatalogOptions {
  variants?: CatalogOptionDef[];
  addons?: CatalogOptionDef[];
  modifiers?: CatalogOptionDef[];
}

/** options JSON 안전 파싱 — 잘못된 형태는 빈 옵션으로. 순수. */
export function parseCatalogOptions(raw: unknown): CatalogOptions {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const arr = (v: unknown): CatalogOptionDef[] =>
    Array.isArray(v)
      ? v.filter(
          (x): x is CatalogOptionDef =>
            !!x && typeof x === "object" && typeof (x as CatalogOptionDef).key === "string"
        )
      : [];
  return {
    variants: arr(o.variants),
    addons: arr(o.addons),
    modifiers: arr(o.modifiers),
  };
}

// ── 카탈로그 항목 입력 검증 (CRUD) ──────────────────────────────────────────
export interface CatalogItemInput {
  type: string;
  nameKo: string;
  priceKrw?: number | null;
  priceVnd?: string | null;
  costVnd?: string | null;
  options?: CatalogOptions | null;
}

export type CatalogItemError =
  | "INVALID_TYPE"
  | "NAME_REQUIRED"
  | "NO_PRICE"
  | "INVALID_PRICE"
  | "INVALID_COST"
  | "INVALID_OPTION"
  | "DUP_OPTION_KEY";

function validPriceKrw(v: number | null | undefined): boolean {
  return v == null || (Number.isInteger(v) && v >= 0);
}
function validPriceVnd(v: string | null | undefined): boolean {
  return v == null || v === "" || SERVICE_VND_DIGITS.test(v);
}

/** 카탈로그 항목 검증 — 위반 코드 배열(빈 배열이면 통과). 순수. */
export function validateCatalogItem(input: CatalogItemInput): CatalogItemError[] {
  const errors: CatalogItemError[] = [];
  if (!isServiceCatalogType(input.type)) errors.push("INVALID_TYPE");
  if (!input.nameKo || input.nameKo.trim().length === 0) errors.push("NAME_REQUIRED");
  // 판매가는 KRW·VND 중 최소 1개 필요(게스트 노출용)
  const hasKrw = input.priceKrw != null;
  const hasVnd = input.priceVnd != null && input.priceVnd !== "";
  if (!hasKrw && !hasVnd) errors.push("NO_PRICE");
  if (!validPriceKrw(input.priceKrw)) errors.push("INVALID_PRICE");
  if (!validPriceVnd(input.priceVnd)) errors.push("INVALID_PRICE");
  if (!validPriceVnd(input.costVnd)) errors.push("INVALID_COST");

  if (input.options) {
    const seen = new Set<string>();
    const groups = [input.options.variants, input.options.addons, input.options.modifiers];
    for (const g of groups) {
      for (const opt of g ?? []) {
        if (!opt.key || typeof opt.key !== "string" || !opt.labelKo) {
          errors.push("INVALID_OPTION");
          continue;
        }
        if (seen.has(opt.key)) errors.push("DUP_OPTION_KEY");
        seen.add(opt.key);
        if (!validPriceKrw(opt.priceKrw) || !validPriceVnd(opt.priceVnd)) {
          errors.push("INVALID_OPTION");
        }
      }
    }
  }
  // 중복 제거
  return [...new Set(errors)];
}

// ── 주문 가격 재계산 (게스트 선택 → 서버 합계, 변조 방지) ─────────────────────
export interface OrderSelection {
  /** 선택한 variant key (옵션 그룹에 variants가 있으면 필수). */
  variantKey?: string | null;
  /** 선택한 addon key 목록(다중). */
  addonKeys?: string[];
  /** 켜진 modifier key 목록(토글). */
  modifierKeys?: string[];
  /** 수량(정수 ≥ 1). */
  quantity: number;
}

export class ServiceSelectionError extends Error {
  constructor(public readonly code: ServiceSelectionErrorCode) {
    super(code);
    this.name = "ServiceSelectionError";
  }
}
export type ServiceSelectionErrorCode =
  | "INVALID_QTY"
  | "VARIANT_REQUIRED"
  | "UNKNOWN_VARIANT"
  | "UNKNOWN_ADDON"
  | "UNKNOWN_MODIFIER"
  | "NO_PRICE";

export interface ResolvedSelectedOption {
  group: "variant" | "addon" | "modifier";
  key: string;
  labelKo: string;
  priceKrw: number | null;
  priceVnd: string | null;
}

export interface ResolvedPricing {
  unitPriceKrw: number | null;
  unitPriceVnd: bigint | null;
  totalPriceKrw: number | null;
  totalPriceVnd: bigint | null;
  quantity: number;
  /** ServiceOrder.selectedOptions에 그대로 저장할 스냅샷. */
  snapshot: ResolvedSelectedOption[];
}

const toVnd = (s: string | null | undefined): bigint | null =>
  s != null && s !== "" && SERVICE_VND_DIGITS.test(s) ? BigInt(s) : null;

/**
 * 게스트 선택을 서버가 재계산 — 합계 = (variant가 있으면 variant가 기본가 대체, 없으면 base) + Σaddons + Σmodifiers, × quantity.
 * 통화별 독립 계산(KRW/VND 둘 다 가능한 쪽만 산출). 알 수 없는 key·수량 위반은 throw(클라 변조 차단).
 */
export function resolveOrderPricing(
  base: { priceKrw: number | null; priceVnd: bigint | null },
  options: CatalogOptions,
  selection: OrderSelection
): ResolvedPricing {
  const qty = selection.quantity;
  if (!Number.isInteger(qty) || qty < 1) throw new ServiceSelectionError("INVALID_QTY");

  const variants = options.variants ?? [];
  const addons = options.addons ?? [];
  const modifiers = options.modifiers ?? [];
  const snapshot: ResolvedSelectedOption[] = [];

  // 기본 단가 — variant가 정의돼 있으면 1택 필수, variant 가격이 base를 대체
  let unitKrw: number | null = base.priceKrw;
  let unitVnd: bigint | null = base.priceVnd;

  if (variants.length > 0) {
    if (!selection.variantKey) throw new ServiceSelectionError("VARIANT_REQUIRED");
    const v = variants.find((x) => x.key === selection.variantKey);
    if (!v) throw new ServiceSelectionError("UNKNOWN_VARIANT");
    unitKrw = v.priceKrw ?? null;
    unitVnd = toVnd(v.priceVnd);
    snapshot.push({ group: "variant", key: v.key, labelKo: v.labelKo, priceKrw: v.priceKrw ?? null, priceVnd: v.priceVnd ?? null });
  }

  const addNumeric = (krw: number | null, vnd: string | null | undefined) => {
    if (krw != null) unitKrw = (unitKrw ?? 0) + krw;
    const v = toVnd(vnd);
    if (v != null) unitVnd = (unitVnd ?? 0n) + v;
  };

  for (const key of selection.addonKeys ?? []) {
    const a = addons.find((x) => x.key === key);
    if (!a) throw new ServiceSelectionError("UNKNOWN_ADDON");
    addNumeric(a.priceKrw ?? null, a.priceVnd);
    snapshot.push({ group: "addon", key: a.key, labelKo: a.labelKo, priceKrw: a.priceKrw ?? null, priceVnd: a.priceVnd ?? null });
  }
  for (const key of selection.modifierKeys ?? []) {
    const m = modifiers.find((x) => x.key === key);
    if (!m) throw new ServiceSelectionError("UNKNOWN_MODIFIER");
    addNumeric(m.priceKrw ?? null, m.priceVnd);
    snapshot.push({ group: "modifier", key: m.key, labelKo: m.labelKo, priceKrw: m.priceKrw ?? null, priceVnd: m.priceVnd ?? null });
  }

  if (unitKrw == null && unitVnd == null) throw new ServiceSelectionError("NO_PRICE");

  return {
    unitPriceKrw: unitKrw,
    unitPriceVnd: unitVnd,
    totalPriceKrw: unitKrw == null ? null : unitKrw * qty,
    totalPriceVnd: unitVnd == null ? null : unitVnd * BigInt(qty),
    quantity: qty,
    snapshot,
  };
}
