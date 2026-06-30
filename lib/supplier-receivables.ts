// 공급자 미수/입금 현황 집계 (테오 요청) — 공급자가 "받았는지·못 받은 미수 없는지" 한눈에.
// 월 기준 = checkOut의 UTC 연-월(monthRangeUtc와 동일 basis). 지급완료 = Settlement.status PAID.
// 누수 0: supplierCostVnd(원가)만 다룬다 — 판매가·마진·KRW 일절 없음.
import type { SettlementStatus } from "@prisma/client";

export interface VillaReceivable {
  villaId: string;
  villaName: string;
  paidVnd: bigint;
  outstandingVnd: bigint;
}

export interface SupplierReceivables {
  /** 총 정산액(= 받음 + 미수), 전 기간 누적 */
  totalVnd: bigint;
  /** 지급 완료(이미 받은) 합계 */
  paidVnd: bigint;
  /** 미수(아직 못 받은 = 미PAID 월) 합계 */
  outstandingVnd: bigint;
  /** 미납 달 목록 (yearMonth desc) — 탭하면 그 달 상세로 */
  unpaidMonths: { yearMonth: string; amountVnd: bigint }[];
  /** 빌라별 받음/미수 (미수 큰 순 → 받음 큰 순). 테오 요청: 빌라별로 미수/지급 확인 */
  byVilla: VillaReceivable[];
}

/** 집계 입력 — 예약 1건(월 분류는 checkOut, 빌라 귀속은 villaId) */
export interface ReceivableBooking {
  checkOut: Date;
  supplierCostVnd: bigint;
  villaId: string;
  villaName: string;
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
  bookings: readonly ReceivableBooking[],
  settlements: readonly { yearMonth: string; status: SettlementStatus }[]
): SupplierReceivables {
  // 지급 완료(PAID)된 월 집합
  const paidMonths = new Set(
    settlements.filter((s) => s.status === "PAID").map((s) => s.yearMonth)
  );

  // 월별 합(미납 달 목록용) + 빌라별 받음/미수 — 예약 단위로 한 번에 분류
  const byMonth = new Map<string, bigint>();
  const villaMap = new Map<string, VillaReceivable>();
  let totalVnd = 0n;
  let paidVnd = 0n;
  let outstandingVnd = 0n;

  for (const b of bookings) {
    const ym = checkOutYearMonth(b.checkOut);
    const isPaid = paidMonths.has(ym);
    byMonth.set(ym, (byMonth.get(ym) ?? 0n) + b.supplierCostVnd);

    const villa =
      villaMap.get(b.villaId) ??
      { villaId: b.villaId, villaName: b.villaName, paidVnd: 0n, outstandingVnd: 0n };

    totalVnd += b.supplierCostVnd;
    if (isPaid) {
      paidVnd += b.supplierCostVnd;
      villa.paidVnd += b.supplierCostVnd;
    } else {
      outstandingVnd += b.supplierCostVnd;
      villa.outstandingVnd += b.supplierCostVnd;
    }
    villaMap.set(b.villaId, villa);
  }

  // 미납 달 목록 (미PAID 월) — 최신 달 먼저
  const unpaidMonths = [...byMonth.entries()]
    .filter(([ym]) => !paidMonths.has(ym))
    .map(([yearMonth, amountVnd]) => ({ yearMonth, amountVnd }))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  // 빌라별 — 미수 큰 순, 동률이면 받음 큰 순
  const byVilla = [...villaMap.values()].sort((a, b) => {
    if (a.outstandingVnd !== b.outstandingVnd)
      return a.outstandingVnd > b.outstandingVnd ? -1 : 1;
    if (a.paidVnd !== b.paidVnd) return a.paidVnd > b.paidVnd ? -1 : 1;
    return 0;
  });

  return { totalVnd, paidVnd, outstandingVnd, unpaidMonths, byVilla };
}
