// 공급자 미수/입금 현황 집계 (테오 요청) — 공급자가 "받았는지·못 받은 미수 없는지" 한눈에.
// 월 기준 = checkOut의 UTC 연-월(monthRangeUtc와 동일 basis). 지급완료 = Settlement.status PAID.
// 누수 0: supplierCostVnd(원가)만 다룬다 — 판매가·마진·KRW 일절 없음.
import type { SettlementStatus } from "@prisma/client";

export interface SupplierReceivables {
  /** 총 정산액(= 받음 + 미수), 전 기간 누적 */
  totalVnd: bigint;
  /** 지급 완료(이미 받은) 합계 */
  paidVnd: bigint;
  /** 미수(아직 못 받은 = 미PAID 월) 합계 */
  outstandingVnd: bigint;
  /** 미납 달 목록 (yearMonth desc) — 탭하면 그 달 상세로 */
  unpaidMonths: { yearMonth: string; amountVnd: bigint }[];
}

/** checkOut UTC 연-월 ("YYYY-MM") — monthRangeUtc가 UTC 월 경계라 동일 basis */
function checkOutYearMonth(checkOut: Date): string {
  return checkOut.toISOString().slice(0, 7);
}

/**
 * 공급자 정산 대상 예약(체크아웃/노쇼) + 정산 레코드 → 미수/입금 집계.
 * 월별 원가 합을 정산 PAID 여부로 분류한다. Number 변환 금지(BigInt 합산).
 */
export function summarizeSupplierReceivables(
  bookings: readonly { checkOut: Date; supplierCostVnd: bigint }[],
  settlements: readonly { yearMonth: string; status: SettlementStatus }[]
): SupplierReceivables {
  // 월별 원가 합
  const byMonth = new Map<string, bigint>();
  for (const b of bookings) {
    const ym = checkOutYearMonth(b.checkOut);
    byMonth.set(ym, (byMonth.get(ym) ?? 0n) + b.supplierCostVnd);
  }
  // 지급 완료(PAID)된 월 집합
  const paidMonths = new Set(
    settlements.filter((s) => s.status === "PAID").map((s) => s.yearMonth)
  );

  let totalVnd = 0n;
  let paidVnd = 0n;
  let outstandingVnd = 0n;
  const unpaidMonths: { yearMonth: string; amountVnd: bigint }[] = [];

  for (const [ym, amount] of byMonth) {
    totalVnd += amount;
    if (paidMonths.has(ym)) {
      paidVnd += amount;
    } else {
      outstandingVnd += amount;
      unpaidMonths.push({ yearMonth: ym, amountVnd: amount });
    }
  }
  // 최신 달 먼저
  unpaidMonths.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  return { totalVnd, paidVnd, outstandingVnd, unpaidMonths };
}
