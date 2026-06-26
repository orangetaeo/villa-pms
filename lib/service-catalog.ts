// lib/service-catalog.ts — 부가서비스 카탈로그 순수 로직 (ADR-0019 v2)
//
// 카탈로그 항목의 옵션은 3종: variants(상호배타 1택, 기본가 대체) · addons(다중선택, 가산) · modifiers(토글, 가산).
//   게스트가 고른 옵션의 합계는 반드시 서버가 이 모듈로 재계산한다(클라가 보낸 금액 신뢰 금지 — 변조 방지, §9.5).
//   ★ 가격은 VND 단일통화로만 보관·계산한다(BigInt, JSON 직렬화 위해 "숫자문자열"). 게스트 KRW는
//     표시 시점 환율로 priceKrwCeil(VND→KRW 올림)해 파생(lib/service-display.ts) — 저장하지 않는다.
//   라벨(labelKo)은 저장 시 Gemini로 {en,vi,zh,ru} 자동번역해 labelI18n에 보관(ADR-0019 v2).
//
// ★ 원가(costVnd)는 이 모듈이 다루지 않는다(판매가만). 원가·마진은 운영자(canViewFinance) 전용 — 호출측 게이트.

import type { ServiceType } from "@prisma/client";

/** 자동번역 라벨 맵 {en,vi,zh,ru} — lib/service-i18n의 I18nMap과 동형(서버 전용 gemini import 회피용 로컬 정의). */
export interface LabelI18n {
  en: string;
  vi: string;
  zh: string;
  ru: string;
}

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
  "FRUIT",
] as const;

export function isServiceCatalogType(v: string): v is ServiceType {
  return (SERVICE_TYPE_VALUES as readonly string[]).includes(v);
}

// ── 요청 주체 자격(audience) — 어느 채널에서 이 항목을 요청할 수 있는가 (ADR-0023 §4.2) ─────
//   ADMIN=운영자 항상 가능(보장), PARTNER=여행사/랜드사, GUEST=게스트 /g/[token].
//   카탈로그 audiences 배열로 채널별 서버 필터. 항상 ADMIN을 포함한다(운영자는 모든 항목 요청 가능).
export type ServiceAudience = "ADMIN" | "PARTNER" | "GUEST";

export const SERVICE_AUDIENCE_VALUES: readonly ServiceAudience[] = ["ADMIN", "PARTNER", "GUEST"] as const;

function isServiceAudience(v: unknown): v is ServiceAudience {
  return typeof v === "string" && (SERVICE_AUDIENCE_VALUES as readonly string[]).includes(v);
}

/**
 * audiences 정규화 — 배열에서 유효 값만 추출, 항상 ADMIN 포함 보장, 중복 제거. 순수.
 *   빈/잘못된 입력 → ["ADMIN"]. 저장 직전·읽기 시 신뢰 가능한 형태로 만든다.
 */
export function parseAudiences(raw: unknown): ServiceAudience[] {
  const set = new Set<ServiceAudience>(["ADMIN"]); // ADMIN은 항상 포함
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (isServiceAudience(v)) set.add(v);
    }
  }
  // 정의 순서(ADMIN→PARTNER→GUEST)로 안정적 반환
  return SERVICE_AUDIENCE_VALUES.filter((a) => set.has(a));
}

/** audiences 입력 검증 — 배열이고 모든 원소가 유효 enum이면 true. 순수. */
export function validateAudiences(raw: unknown): boolean {
  return Array.isArray(raw) && raw.every(isServiceAudience);
}

/** 옵션 1개 정의 — variant/addon은 절대가격, modifier는 가산delta(같은 필드 재사용). 가격은 VND 전용. */
export interface CatalogOptionDef {
  key: string;
  /** 관리자 입력 한국어 라벨(원문·진실원천). */
  labelKo: string;
  /** 저장 시 Gemini 자동번역된 {en,vi,zh,ru}(패스스루) — 게스트 화면 언어전환용. */
  labelI18n?: LabelI18n | null;
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
  /** 판매가 VND(필수) — "숫자문자열". KRW는 표시 시점 환율로 파생(저장 안 함). */
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

function validPriceVnd(v: string | null | undefined): boolean {
  return v == null || v === "" || SERVICE_VND_DIGITS.test(v);
}

/** 카탈로그 항목 검증 — 위반 코드 배열(빈 배열이면 통과). 순수. 판매가는 priceVnd 필수. */
export function validateCatalogItem(input: CatalogItemInput): CatalogItemError[] {
  const errors: CatalogItemError[] = [];
  if (!isServiceCatalogType(input.type)) errors.push("INVALID_TYPE");
  if (!input.nameKo || input.nameKo.trim().length === 0) errors.push("NAME_REQUIRED");
  // 판매가는 VND 필수(게스트 KRW는 환율 파생)
  const hasVnd = input.priceVnd != null && input.priceVnd !== "";
  if (!hasVnd) errors.push("NO_PRICE");
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
        if (!validPriceVnd(opt.priceVnd)) {
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
  labelI18n: LabelI18n | null;
  priceVnd: string | null;
}

export interface ResolvedPricing {
  unitPriceVnd: bigint;
  totalPriceVnd: bigint;
  quantity: number;
  /** ServiceOrder.selectedOptions에 그대로 저장할 스냅샷(라벨·번역·VND 포함). */
  snapshot: ResolvedSelectedOption[];
}

const toVnd = (s: string | null | undefined): bigint | null =>
  s != null && s !== "" && SERVICE_VND_DIGITS.test(s) ? BigInt(s) : null;

/**
 * 게스트 선택을 서버가 재계산 — VND 단일통화. 합계 = (variant가 있으면 variant가 기본가 대체, 없으면 base)
 *   + Σaddons + Σmodifiers, × quantity. 알 수 없는 key·수량 위반·가격 부재는 throw(클라 변조 차단).
 * KRW는 호출측이 priceKrwCeil(totalPriceVnd, fx)로 파생한다(이 함수는 KRW를 다루지 않음).
 */
export function resolveOrderPricing(
  base: { priceVnd: bigint | null },
  options: CatalogOptions,
  selection: OrderSelection
): ResolvedPricing {
  const qty = selection.quantity;
  if (!Number.isInteger(qty) || qty < 1) throw new ServiceSelectionError("INVALID_QTY");

  const variants = options.variants ?? [];
  const addons = options.addons ?? [];
  const modifiers = options.modifiers ?? [];
  const snapshot: ResolvedSelectedOption[] = [];

  // 기본 단가(VND) — variant가 정의돼 있으면 1택 필수, variant 가격이 base를 대체
  let unitVnd: bigint | null = base.priceVnd;

  if (variants.length > 0) {
    if (!selection.variantKey) throw new ServiceSelectionError("VARIANT_REQUIRED");
    const v = variants.find((x) => x.key === selection.variantKey);
    if (!v) throw new ServiceSelectionError("UNKNOWN_VARIANT");
    unitVnd = toVnd(v.priceVnd);
    snapshot.push({ group: "variant", key: v.key, labelKo: v.labelKo, labelI18n: v.labelI18n ?? null, priceVnd: v.priceVnd ?? null });
  }

  const addVnd = (vnd: string | null | undefined) => {
    const v = toVnd(vnd);
    if (v != null) unitVnd = (unitVnd ?? 0n) + v;
  };

  for (const key of selection.addonKeys ?? []) {
    const a = addons.find((x) => x.key === key);
    if (!a) throw new ServiceSelectionError("UNKNOWN_ADDON");
    addVnd(a.priceVnd);
    snapshot.push({ group: "addon", key: a.key, labelKo: a.labelKo, labelI18n: a.labelI18n ?? null, priceVnd: a.priceVnd ?? null });
  }
  for (const key of selection.modifierKeys ?? []) {
    const m = modifiers.find((x) => x.key === key);
    if (!m) throw new ServiceSelectionError("UNKNOWN_MODIFIER");
    addVnd(m.priceVnd);
    snapshot.push({ group: "modifier", key: m.key, labelKo: m.labelKo, labelI18n: m.labelI18n ?? null, priceVnd: m.priceVnd ?? null });
  }

  if (unitVnd == null) throw new ServiceSelectionError("NO_PRICE");

  return {
    unitPriceVnd: unitVnd,
    totalPriceVnd: unitVnd * BigInt(qty),
    quantity: qty,
    snapshot,
  };
}
