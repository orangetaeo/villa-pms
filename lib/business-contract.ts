// lib/business-contract.ts — 사업 계약서 전자서명 정본 로드·렌더·해시·검증 (T-business-contract-esign)
//
// 책임:
//  1) 서명용 정본 md 로드 — slug 화이트리스트 × locale로만 경로를 조립(사용자 입력 경로 결합 금지).
//  2) {{token}} 치환 렌더 — 미치환 토큰 잔존 시 throw(미정 토큰 렌더 금지).
//  3) contentHash — 서명 시점 렌더 전문 SHA-256(증빙 봉인).
//  4) termsJson zod(타입별) — ★ 원가·마진·판매가(KRW) 필드 절대 포함 금지. .strict()로 미지정 키 거부.
//
// 서명용 정본 파일은 LOC가 병렬 작성 중이라 부재할 수 있음 — 로드 함수는 부재 시 명확한 에러.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";

// ── 타입·slug·locale 화이트리스트 ───────────────────────────────────────────
export const CONTRACT_SLUG = {
  VILLA_SUPPLY: "villa-supply",
  SERVICE_VENDOR: "service-vendor",
  PARTNER_AGENCY: "partner-agency",
} as const;
export type BusinessContractType = keyof typeof CONTRACT_SLUG;

/** 현재 서명용 정본 표준 버전(테오 확정 v0.3). */
export const CURRENT_STANDARD_VERSION = "v0.3";

export type ContractLocale = "ko" | "vi";

/** 타입별 허용 locale — 파트너(여행사)는 한국어 정본만. */
const ALLOWED_LOCALES: Record<BusinessContractType, ContractLocale[]> = {
  VILLA_SUPPLY: ["ko", "vi"],
  SERVICE_VENDOR: ["ko", "vi"],
  PARTNER_AGENCY: ["ko"],
};

export function isContractType(v: unknown): v is BusinessContractType {
  return typeof v === "string" && v in CONTRACT_SLUG;
}

export function isLocaleAllowed(type: BusinessContractType, locale: string): locale is ContractLocale {
  return (ALLOWED_LOCALES[type] as string[]).includes(locale);
}

// ── 로그인 계정 role → 계약 타입 매핑 ────────────────────────────────────────
/** 계약 대상 role(SUPPLIER/VENDOR/PARTNER)만 매핑. 그 외 role은 null(계약 불가). */
export function contractTypeForRole(role: string | undefined | null): BusinessContractType | null {
  switch (role) {
    case "SUPPLIER":
      return "VILLA_SUPPLY";
    case "VENDOR":
      return "SERVICE_VENDOR";
    case "PARTNER":
      return "PARTNER_AGENCY";
    default:
      return null;
  }
}

/** 계약서를 서명하는 상대방 role 집합(운영자 아님). */
export const COUNTERPART_ROLES = ["SUPPLIER", "VENDOR", "PARTNER"] as const;
export function isCounterpartRole(role: string | undefined | null): boolean {
  return typeof role === "string" && (COUNTERPART_ROLES as readonly string[]).includes(role);
}

// ── termsJson zod(타입별) — ★ 원가·마진·판매가 금지, .strict()로 미지정 키 거부 ──
// 치환 주입 방지: 모든 자유 텍스트에 "{{" 포함 금지(무한 치환·토큰 위조 차단).
const NO_BRACES = { message: "TEMPLATE_INJECTION" } as const;
const noBraces = (s: string): boolean => !s.includes("{{");
export const containsTemplateInjection = (s: string): boolean => s.includes("{{");

const requiredText = (max: number) =>
  z.string().trim().min(1).max(max).refine(noBraces, NO_BRACES);
const optionalText = (max: number) =>
  z.string().max(max).refine(noBraces, NO_BRACES).optional();

const commonTermsShape = {
  companyName: requiredText(200), // 갑(운영사) 상호
  companyPassport: requiredText(60), // 갑 대표 신분/여권 번호
  bankInfo: optionalText(500), // 계좌 정보(신원 정보 — 원가·마진 아님). 비면 "해당 없음" 렌더
  specialTerms: optionalText(4000), // 특약사항(자유 텍스트). 비면 "해당 없음" 렌더
};

const payMethodEnum = z.enum(["CASH", "BANK"]);

export const villaSupplyTermsSchema = z
  .object({
    ...commonTermsShape,
    cancelFreeDays: z.number().int().min(0).max(365).default(14),
    cancelPartialPct: z.number().int().min(0).max(100).default(50),
    payMethod: payMethodEnum,
  })
  .strict();

export const serviceVendorTermsSchema = z
  .object({
    ...commonTermsShape,
    settleCycle: z.enum(["MONTHLY", "WEEKLY", "PER_ORDER"]),
    settleDetail: optionalText(200), // 예: "매월 5일". 비면 "해당 없음" 렌더
    payMethod: payMethodEnum,
  })
  .strict();

export const partnerAgencyTermsSchema = z
  .object({
    ...commonTermsShape,
    partnerCompany: requiredText(200),
    partnerBizNo: optionalText(60), // 개인 파트너는 사업자번호 없을 수 있음 → 비면 "해당 없음"
    partnerRep: requiredText(120),
    partnerContact: requiredText(120),
  })
  .strict();

export const termsSchemaByType: Record<BusinessContractType, z.ZodTypeAny> = {
  VILLA_SUPPLY: villaSupplyTermsSchema,
  SERVICE_VENDOR: serviceVendorTermsSchema,
  PARTNER_AGENCY: partnerAgencyTermsSchema,
};

export type VillaSupplyTerms = z.infer<typeof villaSupplyTermsSchema>;
export type ServiceVendorTerms = z.infer<typeof serviceVendorTermsSchema>;
export type PartnerAgencyTerms = z.infer<typeof partnerAgencyTermsSchema>;

/** 타입별 termsJson 검증. 성공 시 default 채워진 정규화 값 반환. */
export function parseTerms(type: BusinessContractType, input: unknown): z.SafeParseReturnType<unknown, unknown> {
  return termsSchemaByType[type].safeParse(input);
}

// ── 정본 md 로드 ─────────────────────────────────────────────────────────────
/** 정본 파일 경로 — slug·locale 화이트리스트에서만 조립(사용자 입력 결합 금지). */
export function contractTemplatePath(type: BusinessContractType, locale: ContractLocale): string {
  return path.join(
    process.cwd(),
    "docs",
    "business",
    "contracts",
    "signing",
    `${CONTRACT_SLUG[type]}.${locale}.md`,
  );
}

/**
 * 서명용 정본 md 로드. locale이 타입에 허용되지 않으면 throw.
 * 파일 부재(LOC 병렬 작성 중일 수 있음) 시 명확한 에러 — 절대 빈 문자열로 렌더하지 않는다.
 */
export async function loadBusinessContractTemplate(
  type: BusinessContractType,
  locale: string,
): Promise<string> {
  if (!isLocaleAllowed(type, locale)) {
    throw new Error(`CONTRACT_LOCALE_NOT_ALLOWED: ${type}/${locale}`);
  }
  const filePath = contractTemplatePath(type, locale);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(
      `CONTRACT_TEMPLATE_MISSING: docs/business/contracts/signing/${CONTRACT_SLUG[type]}.${locale}.md`,
    );
  }
}

// ── 렌더 ─────────────────────────────────────────────────────────────────────
const BLANK = "____"; // 미서명 시 서명란 공백 표시

const PAY_METHOD_LABEL: Record<"CASH" | "BANK", Record<ContractLocale, string>> = {
  CASH: { ko: "현금", vi: "Tiền mặt" },
  BANK: { ko: "계좌이체", vi: "Chuyển khoản" },
};

const SETTLE_CYCLE_LABEL: Record<"MONTHLY" | "WEEKLY" | "PER_ORDER", Record<ContractLocale, string>> = {
  MONTHLY: { ko: "매월 정산", vi: "Thanh toán hàng tháng" },
  WEEKLY: { ko: "매주 정산", vi: "Thanh toán hàng tuần" },
  PER_ORDER: { ko: "건별 정산", vi: "Thanh toán theo từng đơn" },
};

/** 값이 비어 있는 선택 항목의 표시 — 빈 렌더 방지(미치환 throw 규칙과 별개). */
const NA_LABEL: Record<ContractLocale, string> = { ko: "해당 없음", vi: "Không áp dụng" };

export interface RenderContractData {
  type: BusinessContractType;
  locale: ContractLocale;
  /** counterpart User.name → {{counterpartName}} */
  counterpartName: string;
  /** counterpart 연락처(User.phone) → {{counterpartZalo}} */
  counterpartZalo: string;
  /** 검증된 termsJson */
  terms: Record<string, unknown>;
  /** 서명 시 본인 입력 신분번호 → {{counterpartIdNumber}} (미서명 시 공백) */
  idNumber?: string | null;
  /** 서명 시 본인 입력 주소 → {{counterpartAddress}} (미서명 시 공백) */
  address?: string | null;
  /** 서명 시각 → {{signDate}} (미서명 시 공백) */
  signedAt?: Date | null;
}

function fmtSignDate(d?: Date | null): string {
  if (!d) return BLANK;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 렌더 토큰 맵 — 타입별 전 토큰을 항상 포함(정의된 값 없으면 NA 라벨 또는 서명란 BLANK). */
function buildTokenMap(data: RenderContractData): Record<string, string> {
  const t = data.terms ?? {};
  const loc = data.locale;
  const na = NA_LABEL[loc];
  const str = (v: unknown, fallback = ""): string => (v == null || v === "" ? fallback : String(v));

  // 공통 토큰(모든 정본 공유)
  const map: Record<string, string> = {
    counterpartName: str(data.counterpartName, BLANK),
    counterpartZalo: str(data.counterpartZalo, BLANK),
    counterpartIdNumber: str(data.idNumber, BLANK),
    counterpartAddress: str(data.address, BLANK),
    companyName: str(t.companyName),
    companyPassport: str(t.companyPassport),
    bankInfo: str(t.bankInfo, na), // 비면 "해당 없음"
    specialTerms: str(t.specialTerms, na), // 비면 "해당 없음"
    signDate: fmtSignDate(data.signedAt),
  };

  if (data.type === "VILLA_SUPPLY") {
    map.cancelFreeDays = str(t.cancelFreeDays);
    map.cancelPartialPct = str(t.cancelPartialPct);
    map.payMethod = t.payMethod ? PAY_METHOD_LABEL[t.payMethod as "CASH" | "BANK"][loc] : "";
  } else if (data.type === "SERVICE_VENDOR") {
    map.settleCycle = t.settleCycle
      ? SETTLE_CYCLE_LABEL[t.settleCycle as "MONTHLY" | "WEEKLY" | "PER_ORDER"][loc]
      : "";
    map.settleDetail = str(t.settleDetail, na); // 비면 "해당 없음"
    map.payMethod = t.payMethod ? PAY_METHOD_LABEL[t.payMethod as "CASH" | "BANK"][loc] : "";
  } else if (data.type === "PARTNER_AGENCY") {
    map.partnerCompany = str(t.partnerCompany);
    map.partnerBizNo = str(t.partnerBizNo, na); // 비면 "해당 없음"
    map.partnerRep = str(t.partnerRep);
    map.partnerContact = str(t.partnerContact);
  }

  return map;
}

/**
 * {{token}} 전부 치환. 미정 토큰(맵에 없음) 또는 치환 후 `{{` 잔존 시 throw — 미정 토큰 렌더 금지.
 */
export function renderBusinessContract(template: string, data: RenderContractData): string {
  const map = buildTokenMap(data);
  const unresolved = new Set<string>();
  const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    unresolved.add(key);
    return `{{${key}}}`;
  });
  if (unresolved.size > 0 || rendered.includes("{{")) {
    throw new Error(`UNRESOLVED_CONTRACT_TOKEN: ${[...unresolved].join(", ") || "(malformed placeholder)"}`);
  }
  return rendered;
}

/** 서명 시점 렌더 전문 SHA-256 hex(증빙 봉인). */
export function contentHash(rendered: string): string {
  return createHash("sha256").update(rendered, "utf8").digest("hex");
}

// ── 계약 레코드 + 상대방 User → 렌더 (라우트 공유 헬퍼) ──────────────────────
export interface ContractRecordForRender {
  type: BusinessContractType;
  locale: string;
  termsJson: unknown;
  counterpartIdNumber?: string | null;
  counterpartAddress?: string | null;
  signedAt?: Date | null;
}

export interface CounterpartUserForRender {
  name: string;
  phone?: string | null;
  zaloContact?: string | null;
}

/**
 * 계약 레코드를 상대방에게 보여줄 본문으로 렌더.
 * @param opts.includeSignature true면 서명 정보(성명·신분번호·서명일) 포함, false면 서명란 공백.
 */
export async function renderContractForCounterpart(
  contract: ContractRecordForRender,
  user: CounterpartUserForRender,
  opts?: { includeSignature?: boolean },
): Promise<string> {
  const locale = contract.locale as ContractLocale;
  const template = await loadBusinessContractTemplate(contract.type, locale);
  const includeSig = opts?.includeSignature ?? false;
  return renderBusinessContract(template, {
    type: contract.type,
    locale,
    counterpartName: user.name,
    counterpartZalo: user.phone ?? user.zaloContact ?? "",
    terms: (contract.termsJson ?? {}) as Record<string, unknown>,
    idNumber: includeSig ? contract.counterpartIdNumber ?? null : null,
    address: includeSig ? contract.counterpartAddress ?? null : null,
    signedAt: includeSig ? contract.signedAt ?? null : null,
  });
}
