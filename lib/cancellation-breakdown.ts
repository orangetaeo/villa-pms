// lib/cancellation-breakdown.ts — 취소 시 환불·지급 자동 산출 (T-guest-policy-tiers S3)
//
// 운영자가 표를 보고 손으로 계산하던 것을 시스템이 대신한다.
//   ① 취소 시점 → 고객 환불률(정책) + 공급자 지급률(계약 별표2) 판정
//   ② 금액 산출 — 고객 환불/위약금은 KRW, 공급자 지급은 VND
//   ③ 회사 손실 위험 경고 — 지급률이 위약금률(100−환불률)을 넘으면 그 차이만큼 우리가 부담한다
//
// ★ 통화 환산(KRW↔VND) 하지 않는다. 계약이 "공급자 지급액은 원가(VND) 고정, 환율 변동은 회사 부담"으로
//   정해져 있어, 하나의 "회사 몫" 숫자로 합치려면 환율 가정이 필요해진다 — 그건 정산의 몫.
// ★ 기준 금액은 **총 예약금액**(부분 입금 무관) — 계약 별표2 주석과 동일 원칙.
// 순수 모듈 — prisma 의존 없음.

import { nightsBetween, todayVnDateString, toDateOnlyString } from "./date-vn";
import { refundPctFor, supplierPayPctFor, type GuestRefundTier } from "./cancellation-policy";
import type { CancelTier } from "./cancel-tiers";

export interface BreakdownInput {
  /** 숙박 시작일 — @db.Date(UTC 자정 저장) */
  checkIn: Date;
  /** 취소 접수 시각(기본: 지금). VN 달력일로 환산해 남은 일수를 센다 */
  cancelAt?: Date;
  /** 고객 환불 정책 단계 — 동의 스냅샷이 있으면 **스냅샷을 넣는다**(동의 당시 조건이 정본) */
  guestTiers: readonly GuestRefundTier[];
  /** 공급자 계약 별표2. 계약에 단계표가 없으면(레거시 2필드) null */
  supplierTiers: readonly CancelTier[] | null;
  /** 총 예약금액(KRW). 없으면 금액 산출 생략(비율만) */
  totalKrw?: number | null;
  /** 원가(VND, 동 단위). 없으면 지급액 산출 생략 */
  costVnd?: bigint | null;
  /** 노쇼·체크인 후 취소 — true면 남은 일수 판정을 건너뛰고 최종 단계 적용 */
  noShow?: boolean;
}

export interface CancellationBreakdown {
  /** 체크인까지 남은 달력일(VN 기준). 당일=0, 지났거나 노쇼=-1 */
  daysBefore: number;
  /** 고객 환불률 % */
  guestRefundPct: number;
  /** 고객 위약금률 % (= 100 − 환불률). 우리가 고객에게서 실제로 남기는 비율 */
  guestPenaltyPct: number;
  /** 공급자 지급률 % — 계약에 단계표가 없으면 null(수동 판단 필요) */
  supplierPayPct: number | null;
  /** 고객에게 돌려줄 금액(KRW) */
  refundKrw: number | null;
  /** 고객에게서 수취하는 위약금(KRW) */
  penaltyKrw: number | null;
  /** 공급자에게 지급할 금액(VND) */
  supplierPayVnd: bigint | null;
  /**
   * ★ 회사 손실 위험 %p — 지급률 − 위약금률이 양수면 그만큼 우리가 자기 돈으로 메운다.
   * 0이면 정합(손실 없음). 계약 단계표가 없으면 null.
   */
  companyLossPct: number | null;
}

/** 체크인까지 남은 달력일(VN). 당일=0, 이미 지났으면 -1. */
export function daysUntilCheckIn(checkIn: Date, cancelAt?: Date): number {
  const today = todayVnDateString(cancelAt);
  const target = toDateOnlyString(checkIn);
  if (target <= today) {
    // 체크인 당일이면 0, 이미 지났으면 -1(노쇼 구간)
    return target === today ? 0 : -1;
  }
  return nightsBetween(today, target);
}

/** 반올림 — 금액은 원 단위 정수(부동소수 금지 규약). */
function pctOfKrw(total: number, pct: number): number {
  return Math.round((total * pct) / 100);
}

/** BigInt 비율 — VND 동 단위 정수. 반올림은 나눗셈 전에 +50으로 처리. */
function pctOfVnd(total: bigint, pct: number): bigint {
  return (total * BigInt(pct) + 50n) / 100n;
}

/** 취소 산출 — 시점 판정 + 금액 + 손실 경고. */
export function computeCancellationBreakdown(input: BreakdownInput): CancellationBreakdown {
  const daysBefore = input.noShow ? -1 : daysUntilCheckIn(input.checkIn, input.cancelAt);

  const guestRefundPct = refundPctFor(input.guestTiers, daysBefore);
  const guestPenaltyPct = 100 - guestRefundPct;
  const supplierPayPct = supplierPayPctFor(input.supplierTiers ?? null, daysBefore);

  const totalKrw = input.totalKrw ?? null;
  const refundKrw = totalKrw === null ? null : pctOfKrw(totalKrw, guestRefundPct);
  const penaltyKrw = totalKrw === null || refundKrw === null ? null : totalKrw - refundKrw;

  const costVnd = input.costVnd ?? null;
  const supplierPayVnd =
    costVnd === null || supplierPayPct === null ? null : pctOfVnd(costVnd, supplierPayPct);

  const companyLossPct =
    supplierPayPct === null ? null : Math.max(0, supplierPayPct - guestPenaltyPct);

  return {
    daysBefore,
    guestRefundPct,
    guestPenaltyPct,
    supplierPayPct,
    refundKrw,
    penaltyKrw,
    supplierPayVnd,
    companyLossPct,
  };
}

/**
 * 정책 ↔ 계약 정합성 점검(설정 화면 경고용).
 * 두 표의 **모든 경계 시점**에서 지급률이 위약금률을 넘는지 확인한다.
 * 경계만 봐도 충분한 이유: 두 표 모두 구간 내 상수라, 손실은 반드시 어떤 구간의 시작점에서 드러난다.
 */
export function findLossWindows(
  guestTiers: readonly GuestRefundTier[],
  supplierTiers: readonly CancelTier[] | null,
): { daysBefore: number; guestRefundPct: number; supplierPayPct: number; lossPct: number }[] {
  if (!supplierTiers || supplierTiers.length === 0) return [];
  const boundaries = new Set<number>();
  for (const t of guestTiers) boundaries.add(t.fromDays);
  for (const t of supplierTiers) boundaries.add(t.fromDays);

  const out: { daysBefore: number; guestRefundPct: number; supplierPayPct: number; lossPct: number }[] = [];
  for (const daysBefore of [...boundaries].sort((a, b) => b - a)) {
    const guestRefundPct = refundPctFor(guestTiers, daysBefore);
    const pay = supplierPayPctFor(supplierTiers, daysBefore);
    if (pay === null) continue;
    const lossPct = pay - (100 - guestRefundPct);
    if (lossPct > 0) out.push({ daysBefore, guestRefundPct, supplierPayPct: pay, lossPct });
  }
  return out;
}
