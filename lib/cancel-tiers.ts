// lib/cancel-tiers.ts — 빌라 공급 계약 별표 2「취소 수수료 단계표」도메인 (T-supplier-cancel-tiers S1)
//
// ★ 순수 모듈 — node:fs·prisma·next-intl 의존 없음. 서버(lib/business-contract.ts)와
//   클라 폼(app/(admin)/contracts/contract-create-form.tsx)이 **같은 규칙**을 공유해
//   검증 로직이 어긋나는 것을 구조적으로 막는다.
//
// 설계:
//  · 행은 구간 하한(fromDays)만 갖는다 → 구간 겹침·구멍이 발생할 수 없다.
//    fromDays = 체크인 D-n(양수) / 0 = 체크인 당일 / -1 = 노쇼·체크인 후.
//  · 회사 손실 방지 상한: supplierPayPct ≤ 100 − guestRefundPct.
//    (고객에게서 받은 위약금률보다 공급자에게 더 줄 수 없다 — 어떤 시점에 취소돼도 회사 몫 ≥ 0)
//  · ★ 금액·마진·판매가는 다루지 않는다(비율만). 마진 비공개 원칙 유지.

export interface CancelTier {
  /** 구간 하한 — 체크인 D-n. 0=체크인 당일, -1=노쇼·체크인 후 */
  fromDays: number;
  /** 고객 환불률(총 예약금액 기준) 0~100 */
  guestRefundPct: number;
  /** 공급자 지급률(원가 기준) 0~100 — 계약상 구속력 있는 값 */
  supplierPayPct: number;
}

/** 테오 확정 제안 프리셋(2026-07-22) — 각 단계에서 위약금률 = 공급자 지급률(비례 분담). */
export const DEFAULT_CANCEL_TIERS: CancelTier[] = [
  { fromDays: 14, guestRefundPct: 100, supplierPayPct: 0 },
  { fromDays: 8, guestRefundPct: 80, supplierPayPct: 20 },
  { fromDays: 1, guestRefundPct: 50, supplierPayPct: 50 },
  { fromDays: 0, guestRefundPct: 20, supplierPayPct: 80 },
  { fromDays: -1, guestRefundPct: 0, supplierPayPct: 100 },
];

export const CANCEL_TIER_MIN_ROWS = 2;
export const CANCEL_TIER_MAX_ROWS = 8;

export type CancelTierIssueCode =
  | "TIER_COUNT" // 행 수 범위 밖
  | "TIER_RANGE" // 개별 값 범위 밖(정수·일수·퍼센트)
  | "TIER_LAST_MUST_BE_NOSHOW" // 마지막 행은 반드시 -1(노쇼·체크인 후)
  | "TIER_FIRST_MUST_BE_POSITIVE" // 첫 행은 1일 전 이상
  | "TIER_DAYS_NOT_DESCENDING" // fromDays 엄격 내림차순
  | "TIER_REFUND_NOT_DESCENDING" // 고객 환불률 비증가
  | "TIER_PAY_NOT_ASCENDING" // 공급자 지급률 비감소
  | "TIER_PAY_EXCEEDS_PENALTY"; // ★ 회사 손실 — 지급률 > 위약금률

export interface CancelTierIssue {
  /** 문제 행 인덱스. 표 전체 문제면 -1 */
  index: number;
  code: CancelTierIssueCode;
}

function isIntInRange(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * 단계표 정합성 검증. 빈 배열 반환 = 유효.
 * 서버(zod superRefine)·클라 폼이 동일 함수를 사용한다.
 */
export function validateCancelTiers(tiers: readonly CancelTier[]): CancelTierIssue[] {
  const issues: CancelTierIssue[] = [];
  if (!Array.isArray(tiers) || tiers.length < CANCEL_TIER_MIN_ROWS || tiers.length > CANCEL_TIER_MAX_ROWS) {
    return [{ index: -1, code: "TIER_COUNT" }];
  }

  tiers.forEach((t, i) => {
    if (
      !t ||
      !isIntInRange(t.fromDays, -1, 365) ||
      !isIntInRange(t.guestRefundPct, 0, 100) ||
      !isIntInRange(t.supplierPayPct, 0, 100)
    ) {
      issues.push({ index: i, code: "TIER_RANGE" });
    }
  });
  if (issues.length > 0) return issues; // 값 자체가 깨진 상태에서 순서 검사는 무의미

  if (tiers[tiers.length - 1].fromDays !== -1) {
    issues.push({ index: tiers.length - 1, code: "TIER_LAST_MUST_BE_NOSHOW" });
  }
  if (tiers[0].fromDays < 1) {
    issues.push({ index: 0, code: "TIER_FIRST_MUST_BE_POSITIVE" });
  }

  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    const cur = tiers[i];
    if (cur.fromDays >= prev.fromDays) issues.push({ index: i, code: "TIER_DAYS_NOT_DESCENDING" });
    if (cur.guestRefundPct > prev.guestRefundPct) {
      issues.push({ index: i, code: "TIER_REFUND_NOT_DESCENDING" });
    }
    if (cur.supplierPayPct < prev.supplierPayPct) {
      issues.push({ index: i, code: "TIER_PAY_NOT_ASCENDING" });
    }
  }

  // ★ 핵심 상한 — 고객에게서 받은 위약금률(100 − 환불률)보다 많이 지급할 수 없다.
  tiers.forEach((t, i) => {
    if (t.supplierPayPct > 100 - t.guestRefundPct) {
      issues.push({ index: i, code: "TIER_PAY_EXCEEDS_PENALTY" });
    }
  });

  return issues;
}

// ── 렌더(정본 별표 2) ────────────────────────────────────────────────────────
export type CancelTierLocale = "ko" | "vi";

const TABLE_HEAD: Record<CancelTierLocale, [string, string, string]> = {
  ko: ["취소 접수 시점 (체크인 기준)", "고객 환불", "공급자 지급"],
  vi: [
    "Thời điểm tiếp nhận hủy (tính theo ngày nhận phòng)",
    "Hoàn tiền cho khách",
    "Thanh toán cho nhà cung cấp",
  ],
};

/** 별표 2 하단 주석 — 적용 범위·기준 금액·환율(테오 확정 2026-07-22). */
const TABLE_NOTES: Record<CancelTierLocale, string[]> = {
  ko: [
    "적용 범위: 숙박료에 한한다. 부가서비스(BBQ·입장권·차량·조식 등) 중 이미 발주된 건은 본 표를 적용하지 않고 별도 정산한다.",
    "기준 금액: 고객 환불률은 **총 예약금액**을 기준으로 산정하며, 부분 입금 여부와 무관하다(위약금이 기수령액을 초과하면 그 차액은 회사가 고객에게 청구한다).",
    "공급자 지급률은 해당 예약의 **원가(VND)**를 기준으로 하며, 환율 변동으로 인한 차액은 회사가 부담한다.",
  ],
  vi: [
    "Phạm vi áp dụng: chỉ áp dụng cho tiền phòng. Các dịch vụ cộng thêm (BBQ, vé vào cửa, xe, bữa sáng...) đã được đặt hàng thì không áp dụng bảng này mà quyết toán riêng.",
    "Căn cứ tính: tỷ lệ hoàn tiền cho khách được tính trên **tổng giá trị đặt phòng**, không phụ thuộc vào việc khách đã thanh toán một phần hay toàn bộ (nếu phí hủy vượt quá số tiền đã nhận, Công ty sẽ thu phần chênh lệch từ khách).",
    "Tỷ lệ thanh toán cho nhà cung cấp được tính trên **giá gốc (VND)** của đặt phòng đó; chênh lệch do biến động tỷ giá do Công ty chịu.",
  ],
};

/** 구간 라벨 — 첫 행 "N일 전까지", 중간 "a~b일 전", 0="당일", -1="노쇼·체크인 후". */
export function cancelTierPeriodLabel(
  tiers: readonly CancelTier[],
  index: number,
  loc: CancelTierLocale,
): string {
  const cur = tiers[index];
  if (cur.fromDays === -1) {
    return loc === "ko"
      ? "노쇼 또는 체크인 후 취소"
      : "Không đến (no-show) hoặc hủy sau khi nhận phòng";
  }
  if (cur.fromDays === 0) {
    return loc === "ko" ? "체크인 당일" : "Trong ngày nhận phòng";
  }
  if (index === 0) {
    return loc === "ko"
      ? `체크인 ${cur.fromDays}일 전까지`
      : `Trước ${cur.fromDays} ngày trở lên`;
  }
  const upper = tiers[index - 1].fromDays - 1; // 바로 위 구간 하한 직전까지가 이 구간의 상한
  if (upper <= cur.fromDays) {
    return loc === "ko" ? `체크인 ${cur.fromDays}일 전` : `Trước ${cur.fromDays} ngày`;
  }
  return loc === "ko"
    ? `체크인 ${cur.fromDays}~${upper}일 전`
    : `Trước ${cur.fromDays}~${upper} ngày`;
}

function refundCell(pct: number, loc: CancelTierLocale): string {
  if (pct <= 0) return loc === "ko" ? "환불 없음" : "Không hoàn tiền";
  return loc === "ko" ? `총 예약금액의 ${pct}%` : `${pct}% tổng giá trị đặt phòng`;
}

function payCell(pct: number, loc: CancelTierLocale): string {
  if (pct <= 0) return loc === "ko" ? "지급 없음" : "Không thanh toán";
  return loc === "ko" ? `원가의 ${pct}%` : `${pct}% giá gốc`;
}

/** 단계표 → 정본 삽입용 마크다운(3열 표 + 주석). {{cancelTiersTable}} 토큰 값. */
export function formatCancelTiersTable(tiers: readonly CancelTier[], loc: CancelTierLocale): string {
  const head = TABLE_HEAD[loc];
  const lines = [`| ${head[0]} | ${head[1]} | ${head[2]} |`, "|---|---|---|"];
  tiers.forEach((t, i) => {
    lines.push(
      `| ${cancelTierPeriodLabel(tiers, i, loc)} | ${refundCell(t.guestRefundPct, loc)} | ${payCell(
        t.supplierPayPct,
        loc,
      )} |`,
    );
  });
  lines.push("");
  TABLE_NOTES[loc].forEach((n) => lines.push(`- ${n}`));
  return lines.join("\n");
}

/**
 * ★ 레거시 폴백 — cancelTiers 이전(2필드) 계약의 별표 2.
 * 종전 정본 md에 하드코딩돼 있던 2열 3행 표를 **문자열까지 동일하게** 재현한다.
 * (이미 서명된 계약의 렌더 결과가 바뀌면 contentHash 증빙과 어긋나므로 절대 변경 금지)
 */
export function formatLegacyCancelTable(
  freeDays: string,
  partialPct: string,
  loc: CancelTierLocale,
): string {
  if (loc === "vi") {
    return [
      "| Thời điểm hủy (tính theo ngày nhận phòng) | Nghĩa vụ thanh toán của Công ty → Nhà cung cấp / Tỷ lệ hoàn |",
      "|---|---|",
      `| Trước ${freeDays} ngày | Không tính phí (trước khi thanh toán = không quyết toán, sau khi thanh toán = hoàn 100%) |`,
      `| Trong vòng ${freeDays} ngày ~ ngày trước | ${partialPct}% giá gốc |`,
      "| Trong ngày · Không đến (no show) | 100% giá gốc |",
    ].join("\n");
  }
  return [
    "| 취소 시점 (체크인 기준) | 회사→공급자 지급 의무 / 환급률 |",
    "|---|---|",
    `| ${freeDays}일 전까지 | 수수료 없음 (지급 전=무정산, 지급 후=100% 환급) |`,
    `| ${freeDays}일 이내 ~ 전일 | 원가의 ${partialPct}% |`,
    "| 당일·노쇼 | 원가의 100% |",
  ].join("\n");
}

/** termsJson.cancelTiers 후보값 → 유효한 단계표만 반환(그 외 null → 레거시 폴백). */
export function readCancelTiers(v: unknown): CancelTier[] | null {
  if (!Array.isArray(v)) return null;
  const tiers = v.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      fromDays: r.fromDays as number,
      guestRefundPct: r.guestRefundPct as number,
      supplierPayPct: r.supplierPayPct as number,
    };
  });
  return validateCancelTiers(tiers).length === 0 ? tiers : null;
}
