// lib/contract-negotiation.ts — 계약 조항 협의(네고) 도메인 (T-contract-negotiation S2)
//
// 책임:
//  1) 조항(clauseKey)·사유(reason) 화이트리스트 — 계약 타입별로 협의 가능한 조항만 노출/수락.
//  2) 요청 body zod — 취소 단계표 역제안은 **S1과 동일한 cancelTiers 규칙**으로 검증(회사 손실 상한 포함).
//  3) 서명 게이트 판정(미해결 협의 존재) — BusinessContractStatus enum을 늘리지 않기 위한 파생 상태.
//
// ★ 누수 0: 금액·원가·마진은 어떤 필드로도 오가지 않는다(역제안은 비율만).
// ★ 베트남 사용자 UX: 자유 서술 강요 금지 — 조항 선택 + 프리셋 사유 + 숫자 역제안, 메모는 선택.
import { z } from "zod";
import { validateCancelTiers, type CancelTier } from "./cancel-tiers";
import type { BusinessContractType } from "./business-contract";

// ── 조항 화이트리스트 ────────────────────────────────────────────────────────
export const NEGOTIABLE_CLAUSES = {
  VILLA_SUPPLY: ["cancelTiers", "payMethod", "bankInfo", "specialTerms", "other"],
  SERVICE_VENDOR: ["settleCycle", "payMethod", "bankInfo", "specialTerms", "other"],
  PARTNER_AGENCY: ["specialTerms", "other"],
} as const satisfies Record<BusinessContractType, readonly string[]>;

export type ClauseKey = (typeof NEGOTIABLE_CLAUSES)[BusinessContractType][number];

export function isNegotiableClause(type: BusinessContractType, clauseKey: string): boolean {
  return (NEGOTIABLE_CLAUSES[type] as readonly string[]).includes(clauseKey);
}

// ── 사유 프리셋 ──────────────────────────────────────────────────────────────
// 조항별로 화면에 띄울 칩. "OTHER"는 상한 위반 요구 등 프리셋으로 표현 못 하는 요청의 탈출구
// (역제안 숫자는 회사 손실 상한을 넘을 수 없으므로, 그런 요구는 OTHER + 메모로 온다).
export const REASON_PRESETS: Record<string, readonly string[]> = {
  cancelTiers: ["CANCEL_FREE_PERIOD", "CANCEL_PAY_RATE", "CANCEL_NOSHOW", "OTHER"],
  payMethod: ["PAY_METHOD_CHANGE", "OTHER"],
  bankInfo: ["BANK_INFO_CHANGE", "OTHER"],
  settleCycle: ["SETTLE_CYCLE_CHANGE", "OTHER"],
  specialTerms: ["SPECIAL_TERMS_ADD", "OTHER"],
  other: ["OTHER"],
};

export const REASON_CODES = [
  "CANCEL_FREE_PERIOD", // 무료 취소 기간 조정 요청
  "CANCEL_PAY_RATE", // 단계별 지급률 조정 요청
  "CANCEL_NOSHOW", // 노쇼·당일 취소 조건 이견
  "PAY_METHOD_CHANGE", // 지급 방법 변경 요청
  "BANK_INFO_CHANGE", // 계좌 정보 수정
  "SETTLE_CYCLE_CHANGE", // 정산 주기 변경 요청
  "SPECIAL_TERMS_ADD", // 특약 추가 요청
  "OTHER", // 기타(메모로 설명)
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export function isReasonAllowed(clauseKey: string, reason: string): boolean {
  const presets = REASON_PRESETS[clauseKey];
  return presets ? (presets as readonly string[]).includes(reason) : false;
}

// ── 요청 body ────────────────────────────────────────────────────────────────
// 치환 주입 방지 — 메모는 정본 렌더에 직접 들어가지 않지만, 운영자가 특약으로 옮겨 붙일 수 있어
// termsJson 자유 텍스트와 같은 기준("{{" 금지)을 적용한다.
const noteSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((s) => !s.includes("{{"), { message: "TEMPLATE_INJECTION" })
  .optional();

const proposedTiersSchema = z
  .array(
    z
      .object({
        fromDays: z.number().int().min(-1).max(365),
        guestRefundPct: z.number().int().min(0).max(100),
        supplierPayPct: z.number().int().min(0).max(100),
      })
      .strict(),
  )
  .superRefine((rows, ctx) => {
    for (const issue of validateCancelTiers(rows as CancelTier[])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.code,
        ...(issue.index >= 0 ? { path: [issue.index] } : {}),
      });
    }
  });

export const negotiationRequestSchema = z
  .object({
    clauseKey: z.string().min(1).max(40),
    reason: z.enum(REASON_CODES),
    /** 취소 단계표 역제안 — clauseKey=cancelTiers일 때만 허용 */
    proposedTiers: proposedTiersSchema.optional(),
    note: noteSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.proposedTiers && v.clauseKey !== "cancelTiers") {
      ctx.addIssue({
        path: ["proposedTiers"],
        code: z.ZodIssueCode.custom,
        message: "PROPOSAL_NOT_ALLOWED_FOR_CLAUSE",
      });
    }
    // OTHER는 프리셋으로 설명이 안 되는 경우이므로 메모를 요구한다(빈 요청 방지).
    if (v.reason === "OTHER" && !v.note) {
      ctx.addIssue({ path: ["note"], code: z.ZodIssueCode.custom, message: "NOTE_REQUIRED" });
    }
  });

export type NegotiationRequestInput = z.infer<typeof negotiationRequestSchema>;

// ── 해소(운영자) body ────────────────────────────────────────────────────────
export const negotiationResolveSchema = z
  .object({
    action: z.enum(["ACCEPT", "REJECT"]),
    /** 수용 시 함께 적용할 계약 조건 전체(termsJson). 생략하면 조건 변경 없이 협의만 종결. */
    terms: z.record(z.string(), z.unknown()).optional(),
    resolvedNote: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // 거절은 상대방에게 그대로 노출되는 회신이라 사유를 반드시 남긴다.
    if (v.action === "REJECT" && !v.resolvedNote) {
      ctx.addIssue({ path: ["resolvedNote"], code: z.ZodIssueCode.custom, message: "NOTE_REQUIRED" });
    }
    if (v.action === "REJECT" && v.terms) {
      ctx.addIssue({ path: ["terms"], code: z.ZodIssueCode.custom, message: "TERMS_ON_REJECT" });
    }
  });

// ── 상태 ────────────────────────────────────────────────────────────────────
export const NEGOTIATION_STATUS = ["OPEN", "ACCEPTED", "REJECTED"] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUS)[number];

/**
 * 서명 가능 여부 — 미해결(OPEN) 협의가 하나라도 있으면 서명을 막는다.
 * ★ BusinessContractStatus에 NEGOTIATING을 추가하는 대신 쓰는 파생 판정(enum 변경·롤백 비용 0).
 */
export function hasOpenNegotiation(negotiations: readonly { status: string }[]): boolean {
  return negotiations.some((n) => n.status === "OPEN");
}
