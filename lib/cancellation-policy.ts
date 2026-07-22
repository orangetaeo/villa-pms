// 취소·환불 정책 — 전 빌라 공용 단일 정책 (#6b → T-guest-policy-tiers S3).
// AppSetting JSON 1키로 저장(스키마 무변경). **N단계(2~8) 가변** — 공급자 계약 별표2(lib/cancel-tiers)와
// back-to-back으로 맞출 수 있어야 하기 때문. 구 3단계(v1) JSON은 파싱 시 자동 승격되어 동작이 보존된다.
// 순수 모듈 — prisma/next-intl 의존 없음(validators·테스트·클라 폼 공유). DB 읽기는 호출측에서 수행.
//
// 행 규칙은 공급자 단계표와 동일한 모양: fromDays = 체크인 D-n(구간 하한), 0 = 체크인 당일,
// -1 = 노쇼·체크인 후. 하한만 두므로 구간 겹침·구멍이 구조적으로 불가능하다.

import { DEFAULT_CANCEL_TIERS, type CancelTier } from "./cancel-tiers";

export const CANCELLATION_POLICY_KEY = "CANCELLATION_POLICY";

/** 고객 환불 단계 1행 */
export interface GuestRefundTier {
  /** 구간 하한 — 체크인 D-n. 0=체크인 당일, -1=노쇼·체크인 후 */
  fromDays: number;
  /** 환불률 0~100 (총 예약금액 기준) */
  refundPct: number;
}

export interface CancellationPolicy {
  tiers: GuestRefundTier[];
  /** 공개 페이지 표시 여부 — false면 미노출·동의 미요구 */
  enabled: boolean;
}

/**
 * 기본값 — **현행 운영값 그대로**(30일 100% / 14일 50% / 이후 0%).
 * ★ S3는 살아 있는 정책을 바꾸지 않는다. 5단계 전환은 테오가 /settings에서 프리셋 버튼으로 결정.
 */
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  tiers: [
    { fromDays: 30, refundPct: 100 },
    { fromDays: 14, refundPct: 50 },
    { fromDays: -1, refundPct: 0 },
  ],
  enabled: true,
};

/**
 * 공급자 계약 별표2(S1 프리셋)와 back-to-back인 고객 환불표.
 * 각 단계에서 `고객 위약금률(100−환불률) = 공급자 지급률` → 회사 몫 = 마진 × 위약금률(손실 0).
 */
export const SUPPLIER_ALIGNED_TIERS: GuestRefundTier[] = DEFAULT_CANCEL_TIERS.map((t) => ({
  fromDays: t.fromDays,
  refundPct: t.guestRefundPct,
}));

export const POLICY_MIN_ROWS = 2;
export const POLICY_MAX_ROWS = 8;

// ── 검증 ────────────────────────────────────────────────────────────────────
function isInt(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** 정합성: 2~8행, fromDays 엄격 내림차순, 마지막 -1, 첫 행 ≥1, 환불률 비증가 */
export function isValidCancellationPolicy(p: unknown): p is CancellationPolicy {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return false;
  const tiers = o.tiers;
  if (!Array.isArray(tiers) || tiers.length < POLICY_MIN_ROWS || tiers.length > POLICY_MAX_ROWS) {
    return false;
  }
  for (const row of tiers) {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (!isInt(r.fromDays, -1, 365) || !isInt(r.refundPct, 0, 100)) return false;
  }
  const rows = tiers as GuestRefundTier[];
  if (rows[rows.length - 1].fromDays !== -1) return false;
  if (rows[0].fromDays < 1) return false;
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].fromDays >= rows[i - 1].fromDays) return false;
    if (rows[i].refundPct > rows[i - 1].refundPct) return false;
  }
  return true;
}

// ── v1(구 3단계) 하위호환 ────────────────────────────────────────────────────
/** 구 저장 형태 — `{ fullDays, partialDays, partialPct, enabled }` */
interface LegacyPolicyV1 {
  fullDays: number;
  partialDays: number;
  partialPct: number;
  enabled: boolean;
}

function isLegacyV1(p: unknown): p is LegacyPolicyV1 {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return false;
  if (!isInt(o.fullDays, 0, 365) || !isInt(o.partialDays, 0, 365) || !isInt(o.partialPct, 0, 100)) {
    return false;
  }
  return (o.fullDays as number) > (o.partialDays as number);
}

/**
 * v1 → v2 승격. 의미 보존:
 *   "fullDays일 전까지 100%" → {fromDays: fullDays, refundPct: 100}
 *   "partialDays일 전까지 partialPct%" → {fromDays: partialDays, refundPct: partialPct}
 *   "그 이후 환불 불가" → {fromDays: -1, refundPct: 0}
 * ★ 라이브 AppSetting을 건드리지 않고도 동작·표시가 종전과 동일하게 유지된다.
 */
export function promoteLegacyPolicy(p: {
  fullDays: number;
  partialDays: number;
  partialPct: number;
  enabled: boolean;
}): CancellationPolicy {
  return {
    tiers: [
      { fromDays: p.fullDays, refundPct: 100 },
      { fromDays: p.partialDays, refundPct: p.partialPct },
      { fromDays: -1, refundPct: 0 },
    ],
    enabled: p.enabled,
  };
}

/** AppSetting 문자열 → 정책. v2·v1 모두 수용, 미설정·손상 시 기본값 폴백(공개 표시가 깨지지 않게). */
export function parseCancellationPolicy(value: string | null | undefined): CancellationPolicy {
  if (!value) return DEFAULT_CANCELLATION_POLICY;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isValidCancellationPolicy(parsed)) {
      return { tiers: parsed.tiers.map((t) => ({ ...t })), enabled: parsed.enabled };
    }
    if (isLegacyV1(parsed)) return promoteLegacyPolicy(parsed);
  } catch {
    // 손상 JSON — 기본값
  }
  return DEFAULT_CANCELLATION_POLICY;
}

/** 폼/입력 → 검증된 정책 JSON 문자열(v2로만 저장). 부적합하면 null(저장 거부). */
export function serializeCancellationPolicy(p: unknown): string | null {
  if (!isValidCancellationPolicy(p)) return null;
  return JSON.stringify({
    tiers: p.tiers.map((t) => ({ fromDays: t.fromDays, refundPct: t.refundPct })),
    enabled: p.enabled,
  });
}

// ── 표시 ────────────────────────────────────────────────────────────────────
export type CancellationTierKind =
  | "range" // 체크인 N일 전까지 취소 시 P% 환불
  | "sameDay" // 체크인 당일 취소 시 P% 환불
  | "noShow" // 노쇼·체크인 후 (직전 단계가 당일인 경우)
  | "withinNone"; // 체크인 N일 이내 취소 시 환불 불가 (당일 단계가 없는 경우)

export interface CancellationTierRow {
  kind: CancellationTierKind;
  /** 표시용 일수 — withinNone은 직전 단계의 하한(= "N일 이내") */
  days: number;
  pct: number;
}

/** 표시용 행 목록. 문구 조립은 cancellationTierLabel(호출측 i18n 조각 주입). */
export function cancellationTiers(p: CancellationPolicy): CancellationTierRow[] {
  return p.tiers.map((t, i) => {
    if (t.fromDays === 0) return { kind: "sameDay" as const, days: 0, pct: t.refundPct };
    if (t.fromDays === -1) {
      const prev = p.tiers[i - 1];
      // 직전이 당일 단계면 "노쇼·체크인 후", 아니면 "직전 하한 일수 이내"
      if (prev && prev.fromDays === 0) return { kind: "noShow" as const, days: 0, pct: t.refundPct };
      return { kind: "withinNone" as const, days: prev?.fromDays ?? 0, pct: t.refundPct };
    }
    return { kind: "range" as const, days: t.fromDays, pct: t.refundPct };
  });
}

/** 문구 조각 — public-i18n(공개 5개국어)에서 주입. 표시 위치가 여러 곳이라 조립을 한 곳에 모은다. */
export interface CancellationLabelFragments {
  cancelNoneBefore: string; // "체크인 "
  cancelNoneMid: string; // "일 이내 취소 시 "
  cancelNoneAfter: string; // "환불 불가"
  cancelTierBefore: string; // "체크인 "
  cancelTierMid: string; // "일 전까지 취소 시 "
  cancelTierAfter: string; // "% 환불"
  cancelSameDay: string; // "체크인 당일 취소 시 "
  cancelNoShow: string; // "노쇼 또는 체크인 후 취소 시 "
}

/**
 * 행 1개 → 조각 배열. **표시 강조를 살리기 위해** 문장을 통짜 문자열로 주지 않는다
 * (일수·환불률은 굵게, "환불 불가"는 강조 — 취소 규정은 고객이 숫자를 읽어야 하는 고지문).
 * 강조 클래스는 화면마다 달라 kind만 넘기고 스타일은 호출측이 정한다.
 */
export type CancellationPartKind = "text" | "days" | "pct" | "noRefund";
export interface CancellationLabelPart {
  text: string;
  kind: CancellationPartKind;
}

export function cancellationTierParts(
  row: CancellationTierRow,
  f: CancellationLabelFragments,
): CancellationLabelPart[] {
  // 금액 부분 — 환불률 0이면 "환불 불가"(noRefund), 그 외에는 "N"(pct) + "% 환불"(text)
  const amount: CancellationLabelPart[] =
    row.pct <= 0
      ? [{ text: f.cancelNoneAfter, kind: "noRefund" }]
      : [
          { text: String(row.pct), kind: "pct" },
          { text: f.cancelTierAfter, kind: "text" },
        ];
  switch (row.kind) {
    case "range":
      return [
        { text: f.cancelTierBefore, kind: "text" },
        { text: String(row.days), kind: "days" },
        { text: f.cancelTierMid, kind: "text" },
        ...amount,
      ];
    case "sameDay":
      return [{ text: f.cancelSameDay, kind: "text" }, ...amount];
    case "noShow":
      return [{ text: f.cancelNoShow, kind: "text" }, ...amount];
    case "withinNone":
      return [
        { text: f.cancelNoneBefore, kind: "text" },
        { text: String(row.days), kind: "days" },
        { text: f.cancelNoneMid, kind: "text" },
        ...amount,
      ];
  }
}

/** 조각을 이어붙인 평문 — 강조가 불필요한 곳(관리자 요약·Zalo·테스트)용. */
export function cancellationTierLabel(
  row: CancellationTierRow,
  f: CancellationLabelFragments,
): string {
  return cancellationTierParts(row, f)
    .map((p) => p.text)
    .join("");
}

// ── 판정 ────────────────────────────────────────────────────────────────────
/**
 * 체크인까지 남은 일수 → 적용 환불률.
 * @param daysBefore 체크인까지 남은 달력일(당일=0, 지났거나 노쇼=-1)
 */
export function refundPctFor(tiers: readonly GuestRefundTier[], daysBefore: number): number {
  for (const t of tiers) {
    if (daysBefore >= t.fromDays) return t.refundPct;
  }
  return tiers[tiers.length - 1]?.refundPct ?? 0;
}

/** 공급자 단계표에서 같은 시점의 지급률. 계약에 단계표가 없으면 null. */
export function supplierPayPctFor(
  tiers: readonly CancelTier[] | null,
  daysBefore: number,
): number | null {
  if (!tiers || tiers.length === 0) return null;
  for (const t of tiers) {
    if (daysBefore >= t.fromDays) return t.supplierPayPct;
  }
  return tiers[tiers.length - 1].supplierPayPct;
}
