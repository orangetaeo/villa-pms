import { CreditTier, PartnerStatus, ReceivableStatus } from "@prisma/client";
import { parseUtcDateOnly, todayVnDateString } from "@/lib/date-vn";

/**
 * 여행사·랜드사(B2B) 결제조건·미수(여신) 정책 단일 소스 (ADR-0022, PARTNER-1)
 *
 * 핵심 원칙 — 돈의 흐름 2분리:
 *  ① 숙박료(B2B): 여행사/랜드사가 우리에게 지급하는 객실료. 본 모듈이 다루는 채권(AR).
 *  ② 현장청구(B2C): 보증금·미니바·부가서비스 — 게스트가 체크아웃 시 직접 지급(ADR-0019).
 *     이 모듈에 들어오지 않는다. 두 흐름의 금액을 절대 섞지 않는다.
 *
 * 회사 표준 결제정책(등급제):
 *  - A 선불: 신규·미검증 기본. 예약 시 선금 30% → 체크인 전 잔금 100%. 여신 0.
 *  - B 단기여신: 검증된 파트너. 주/15/30일 마감 + 신용한도 내 + 선금 30% 필수.
 *  - C 특별계약: 개별.
 *
 * 모든 금액은 VND(BigInt). 부동소수점 금지(원칙: 동 단위 정수).
 * LEDGER는 현금주의 유지(ADR-0018) — 미수 잔액의 진실원천은 PartnerReceivable(운영 테이블).
 *
 * ⚠️ 누수 주의(원칙 2 — 마진 비공개): 미수·신용한도·청구서는 전부 ADMIN(canViewFinance) 전용.
 *    공급자·게스트·공개 라우트에 이 모듈 산출값을 직렬화하지 말 것.
 */

/** 정책 기본 선금율(%) — 테오 확정 2026-06-26 */
export const DEFAULT_DEPOSIT_RATE_PCT = 30;

/** 미수 잔액 집계 대상 — 완납·대손은 제외 */
const OPEN_RECEIVABLE_STATUSES: ReceivableStatus[] = [
  ReceivableStatus.PENDING,
  ReceivableStatus.PARTIAL,
  ReceivableStatus.OVERDUE,
];

const MS_PER_DAY = 86_400_000;

/** 채권 1건의 미수 집계에 필요한 최소 필드 */
export interface ReceivableLike {
  totalVnd: bigint;
  depositPaidVnd: bigint;
  balancePaidVnd: bigint;
  dueDate: Date;
  status: ReceivableStatus;
}

/**
 * 선금액 산출 = ceil(객실료 × 선금율%). 동 단위 올림(부족수금 방지).
 * pct는 0~100으로 클램프. 음수 총액은 0.
 */
export function computeDepositDue(totalVnd: bigint, depositRatePct: number): bigint {
  if (totalVnd <= 0n) return 0n;
  const pct = BigInt(Math.max(0, Math.min(100, Math.trunc(depositRatePct))));
  // ceil division: (a + 99) / 100
  return (totalVnd * pct + 99n) / 100n;
}

/** UTC 자정 기준 날짜에 일수 가산 (@db.Date 규약 — 시간 없음) */
function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * 잔금/청구 기한 산출.
 *  - 등급 A(선불): 체크인일이 잔금 기한(체크인 전 100% 입금 원칙).
 *  - 등급 B/C(여신): (마감일 ?? 체크인일) + paymentTermDays.
 *    예약 시점엔 마감일 미확정 → 체크인일 기준 잠정. PartnerInvoice 마감 시 재계산.
 */
export function computeDueDate(params: {
  tier: CreditTier;
  checkInDate: Date;
  periodEnd?: Date | null;
  paymentTermDays?: number;
}): Date {
  const { tier, checkInDate, periodEnd, paymentTermDays = 0 } = params;
  if (tier === CreditTier.A) {
    return addDaysUtc(checkInDate, 0);
  }
  const base = periodEnd ?? checkInDate;
  return addDaysUtc(base, Math.max(0, Math.trunc(paymentTermDays)));
}

/** 채권 1건의 미입금 잔액 = 총액 − 선금입금 − 잔금입금 (음수면 0) */
export function receivableOutstanding(r: ReceivableLike): bigint {
  const paid = r.depositPaidVnd + r.balancePaidVnd;
  const remaining = r.totalVnd - paid;
  return remaining > 0n ? remaining : 0n;
}

/** 파트너 미수 잔액 합계(완납·대손 제외) — 신용한도 판정·대시보드 기준 */
export function outstandingForPartner(receivables: ReceivableLike[]): bigint {
  return receivables
    .filter((r) => OPEN_RECEIVABLE_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + receivableOutstanding(r), 0n);
}

/** 연체 채권 1건 판정(기한 경과 + 미입금) — hasOverdue·overdueOutstanding 공용 */
function isOverdueReceivable(r: ReceivableLike, today: Date): boolean {
  if (!OPEN_RECEIVABLE_STATUSES.includes(r.status)) return false;
  if (receivableOutstanding(r) <= 0n) return false;
  return r.status === ReceivableStatus.OVERDUE || startOfUtcDay(r.dueDate) < today;
}

/** 연체(기한 경과 + 미입금) 채권이 하나라도 있는지 — 자동 제재 트리거 */
export function hasOverdue(receivables: ReceivableLike[], asOf: Date): boolean {
  // "오늘"은 VN 캘린더 일을 UTC 자정으로 — dueDate(@db.Date)도 UTC 자정 저장이라 일수 차 계산이
  // 정수로 맞는다. UTC 일로 잡으면 17:00~23:59 UTC(다음 VN일)에 하루 어긋남. markOverdueReceivables와 동일 규약.
  // (vnDayStartUtc는 −7h라 @db.Date 일수차가 틀어지므로 parseUtcDateOnly 사용)
  const today = parseUtcDateOnly(todayVnDateString(asOf))!;
  return receivables.some((r) => isOverdueReceivable(r, today));
}

/**
 * 실제 연체액 합계 — 기한 경과(또는 OVERDUE 상태) 미입금 채권의 잔액만.
 * outstandingForPartner(전체 미수)와 달리 미도래 채권은 제외 → "연체 미수" KPI 정확화.
 */
export function overdueOutstanding(receivables: ReceivableLike[], asOf: Date): bigint {
  // "오늘"은 VN 캘린더 일을 UTC 자정으로 — hasOverdue와 동일 규약(@db.Date 일수차 정합).
  const today = parseUtcDateOnly(todayVnDateString(asOf))!;
  return receivables
    .filter((r) => isOverdueReceivable(r, today))
    .reduce((sum, r) => sum + receivableOutstanding(r), 0n);
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export interface CreditGateInput {
  tier: CreditTier;
  status: PartnerStatus;
  creditLimitVnd: bigint;
  /** 현재 미수 잔액 (outstandingForPartner 결과) */
  currentOutstandingVnd: bigint;
  /** 연체 채권 존재 여부 (hasOverdue 결과) */
  overdue: boolean;
  /** 신규 예약의 여신 노출액 = 객실료 − 선금액(선금은 즉시 수납 전제) */
  newCreditVnd: bigint;
}

export type CreditGateReason =
  | "BLOCKED"
  | "SUSPENDED"
  | "OVERDUE"
  | "LIMIT_EXCEEDED";

export interface CreditGateResult {
  allowed: boolean;
  reason?: CreditGateReason;
  /** 한도 대비 예상 노출액 (등급 B/C에서만 의미) */
  projectedExposureVnd: bigint;
}

/**
 * 신규 가예약/확정 신용 게이트 (lib/hold.ts·확정 API에서 호출).
 *  - status BLOCKED/SUSPENDED → 차단
 *  - 연체 존재 → 차단(자동 제재)
 *  - 등급 A(선불) → 여신 없음, 한도 무관 통과(선금·잔금 수납은 별도 흐름에서 강제)
 *  - 등급 B/C → (현재 미수 + 신규 여신노출) ≤ 신용한도 일 때만 통과
 */
export function canCreateBookingFor(input: CreditGateInput): CreditGateResult {
  const projectedExposureVnd = input.currentOutstandingVnd + max0(input.newCreditVnd);

  if (input.status === PartnerStatus.BLOCKED) {
    return { allowed: false, reason: "BLOCKED", projectedExposureVnd };
  }
  if (input.status === PartnerStatus.SUSPENDED) {
    return { allowed: false, reason: "SUSPENDED", projectedExposureVnd };
  }
  if (input.overdue) {
    return { allowed: false, reason: "OVERDUE", projectedExposureVnd };
  }
  if (input.tier === CreditTier.A) {
    // 선불 — 여신 노출 없음. 한도 검사 불필요.
    return { allowed: true, projectedExposureVnd: 0n };
  }
  if (projectedExposureVnd > input.creditLimitVnd) {
    return { allowed: false, reason: "LIMIT_EXCEEDED", projectedExposureVnd };
  }
  return { allowed: true, projectedExposureVnd };
}

function max0(v: bigint): bigint {
  return v > 0n ? v : 0n;
}

export type AgingBucketKey = "0-7" | "8-15" | "16-30" | "30+";

export interface AgingBuckets {
  "0-7": bigint;
  "8-15": bigint;
  "16-30": bigint;
  "30+": bigint;
  total: bigint;
}

/**
 * 미수 연령 분석(Aging) — 기한(dueDate) 경과 일수로 분류.
 * 미경과(dueDate ≥ 오늘) 채권은 0-7 버킷(현행, 정상)으로 집계.
 * 완납·대손은 제외. 대시보드(/receivables)·연체 경보 기준.
 */
export function agingBuckets(receivables: ReceivableLike[], asOf: Date): AgingBuckets {
  // "오늘"은 VN 캘린더 일을 UTC 자정으로 — hasOverdue와 동일 규약(@db.Date 일수차 정합).
  const today = parseUtcDateOnly(todayVnDateString(asOf))!;
  const out: AgingBuckets = {
    "0-7": 0n,
    "8-15": 0n,
    "16-30": 0n,
    "30+": 0n,
    total: 0n,
  };
  for (const r of receivables) {
    if (!OPEN_RECEIVABLE_STATUSES.includes(r.status)) continue;
    const amount = receivableOutstanding(r);
    if (amount <= 0n) continue;
    const daysPast = Math.floor(
      (today.getTime() - startOfUtcDay(r.dueDate).getTime()) / MS_PER_DAY
    );
    const key = bucketForDaysPast(daysPast);
    out[key] += amount;
    out.total += amount;
  }
  return out;
}

function bucketForDaysPast(daysPast: number): AgingBucketKey {
  if (daysPast <= 7) return "0-7";
  if (daysPast <= 15) return "8-15";
  if (daysPast <= 30) return "16-30";
  return "30+";
}
