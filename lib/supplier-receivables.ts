// 공급자 미수/입금 현황 집계 (테오 요청) — 공급자가 "받았는지·못 받은 미수 없는지" 한눈에.
// 월 기준 = checkOut의 UTC 연-월(monthRangeUtc와 동일 basis). 지급완료 = Settlement.status PAID.
// 누수 0: supplierCostVnd(원가)만 다룬다 — 판매가·마진·KRW 일절 없음.
//
// ★ 판매 채널 구분(ADR-0021): seller=OPERATOR(우리회사 판매)만 정산 대상 → 받음/미수.
//   seller=SUPPLIER(공급자 직접 판매)는 공급자가 100% 자체 수금 → 미수 아님(directVnd로 별도 집계).
import type { SettlementStatus } from "@prisma/client";

export type BookingSeller = "OPERATOR" | "SUPPLIER";

export interface VillaReceivable {
  villaId: string;
  villaName: string;
  paidVnd: bigint; // 우리회사 판매 — 받음
  outstandingVnd: bigint; // 우리회사 판매 — 미수
  directVnd: bigint; // 직접 판매(자체 수금)
}

export interface SupplierReceivables {
  /** 우리회사 판매 총액(= 받음 + 미수), 전 기간 누적 */
  totalVnd: bigint;
  /** 지급 완료(이미 받은) 합계 — 우리회사 판매 */
  paidVnd: bigint;
  /** 미수(아직 못 받은 = 미PAID 월) 합계 — 우리회사 판매 */
  outstandingVnd: bigint;
  /** 직접 판매(자체 수금) 합계 — 우리에게 받을 게 아님 */
  directVnd: bigint;
  /** 미납 달 목록 (yearMonth desc) — 우리회사 판매만. 탭하면 그 달 상세로 */
  unpaidMonths: { yearMonth: string; amountVnd: bigint }[];
  /** 빌라별 받음/미수/직접 (미수 큰 순). 테오 요청: 빌라별로 미수/지급 확인 */
  byVilla: VillaReceivable[];
}

/** 집계 입력 — 예약 1건(월 분류는 checkOut, 빌라 귀속은 villaId, 채널은 seller) */
export interface ReceivableBooking {
  checkOut: Date;
  supplierCostVnd: bigint;
  villaId: string;
  villaName: string;
  seller: BookingSeller;
}

/** checkOut UTC 연-월 ("YYYY-MM") — monthRangeUtc가 UTC 월 경계라 동일 basis */
function checkOutYearMonth(checkOut: Date): string {
  return checkOut.toISOString().slice(0, 7);
}

/**
 * 공급자 정산 대상 예약(체크아웃/노쇼) + 정산 레코드 → 미수/입금 집계.
 * 우리회사 판매(OPERATOR)는 월 PAID 여부로 받음/미수 분류, 직접 판매(SUPPLIER)는 directVnd로 분리.
 * Number 변환 금지(BigInt 합산).
 */
export function summarizeSupplierReceivables(
  bookings: readonly ReceivableBooking[],
  settlements: readonly { yearMonth: string; status: SettlementStatus }[]
): SupplierReceivables {
  // 지급 완료(PAID)된 월 집합
  const paidMonths = new Set(
    settlements.filter((s) => s.status === "PAID").map((s) => s.yearMonth)
  );

  const byMonth = new Map<string, bigint>(); // 우리회사 판매만 (미납 달용)
  const villaMap = new Map<string, VillaReceivable>();
  let totalVnd = 0n;
  let paidVnd = 0n;
  let outstandingVnd = 0n;
  let directVnd = 0n;

  const villaOf = (b: ReceivableBooking): VillaReceivable => {
    let v = villaMap.get(b.villaId);
    if (!v) {
      v = { villaId: b.villaId, villaName: b.villaName, paidVnd: 0n, outstandingVnd: 0n, directVnd: 0n };
      villaMap.set(b.villaId, v);
    }
    return v;
  };

  for (const b of bookings) {
    const villa = villaOf(b);
    // 직접 판매 — 자체 수금. 정산/미수 대상 아님(directVnd로만)
    if (b.seller === "SUPPLIER") {
      directVnd += b.supplierCostVnd;
      villa.directVnd += b.supplierCostVnd;
      continue;
    }
    // 우리회사 판매 — 월 PAID 여부로 받음/미수
    const ym = checkOutYearMonth(b.checkOut);
    byMonth.set(ym, (byMonth.get(ym) ?? 0n) + b.supplierCostVnd);
    totalVnd += b.supplierCostVnd;
    if (paidMonths.has(ym)) {
      paidVnd += b.supplierCostVnd;
      villa.paidVnd += b.supplierCostVnd;
    } else {
      outstandingVnd += b.supplierCostVnd;
      villa.outstandingVnd += b.supplierCostVnd;
    }
  }

  // 미납 달 목록 (미PAID 월) — 우리회사 판매만, 최신 달 먼저
  const unpaidMonths = [...byMonth.entries()]
    .filter(([ym]) => !paidMonths.has(ym))
    .map(([yearMonth, amountVnd]) => ({ yearMonth, amountVnd }))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  // 빌라별 — 미수 큰 순 → 받음 큰 순 → 직접 큰 순
  const byVilla = [...villaMap.values()].sort((a, b) => {
    if (a.outstandingVnd !== b.outstandingVnd) return a.outstandingVnd > b.outstandingVnd ? -1 : 1;
    if (a.paidVnd !== b.paidVnd) return a.paidVnd > b.paidVnd ? -1 : 1;
    if (a.directVnd !== b.directVnd) return a.directVnd > b.directVnd ? -1 : 1;
    return 0;
  });

  return { totalVnd, paidVnd, outstandingVnd, directVnd, unpaidMonths, byVilla };
}
