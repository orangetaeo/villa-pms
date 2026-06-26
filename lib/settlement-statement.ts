// lib/settlement-statement.ts — 정산 2차 P2-4: 월 정산서 데이터 모델 (순수, react-pdf 비의존).
//
// ★ 공급자 대면 — 공급자 원가 VND·박수·합계만. **마진·판매가·KRW 절대 미포함**(원칙2 마진 비공개).
//   렌더(react-pdf)는 lib/settlement-statement-pdf.tsx 로 분리(테스트·번들 경량화).
// 계약: docs/contracts/T-settlement-statement-pdf-p2-4.md

export interface StatementLineInput {
  villaName: string;
  /** 체크아웃 표시 문자열 (호출부가 VN 표시 규칙으로 변환) */
  checkOut: string;
  nights: number;
  /** 공급자 원가 VND (BigInt) */
  amountVnd: bigint;
}

export interface StatementInput {
  supplierName: string;
  yearMonth: string; // "2026-07"
  lines: StatementLineInput[];
  totalVnd: bigint;
  /** 환차 조정(VND, +이익/−손실) — 합의 시만 표기. 기본 미표기. */
  fxAdjustmentVnd?: bigint | null;
  issuedAt: string; // 발행일 표시 문자열
}

/** PDF 렌더 모델 — 전부 표시 문자열. 마진/판매가/KRW 필드 없음(누수 차단). */
export interface StatementModel {
  supplierName: string;
  yearMonth: string;
  issuedAt: string;
  rows: { villaName: string; checkOut: string; nights: string; amount: string }[];
  total: string;
  fxNote: string | null;
}

/** VND 천단위 콤마 + ₫ (BigInt 전용, Number 캐스팅 금지). 음수 부호 보존. */
export function fmtVnd(v: bigint): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${digits}₫`;
}

/**
 * 정산 데이터 → vi 정산서 모델 (순수). 입력은 원가 VND만 — 마진·판매가·KRW를 애초에 받지 않는다.
 * 라인 합 ≠ totalVnd면 throw(집계 불일치 = 호출부 버그, 조용한 표시 금지).
 */
export function buildStatementModel(input: StatementInput): StatementModel {
  const sum = input.lines.reduce((s, l) => s + l.amountVnd, 0n);
  if (sum !== input.totalVnd) {
    throw new RangeError(
      `정산서 라인 합(${sum}) ≠ 총액(${input.totalVnd}) — 집계 불일치`
    );
  }
  return {
    supplierName: input.supplierName,
    yearMonth: input.yearMonth,
    issuedAt: input.issuedAt,
    rows: input.lines.map((l) => ({
      villaName: l.villaName,
      checkOut: l.checkOut,
      nights: `${l.nights}`,
      amount: fmtVnd(l.amountVnd),
    })),
    total: fmtVnd(input.totalVnd),
    fxNote:
      input.fxAdjustmentVnd != null && input.fxAdjustmentVnd !== 0n
        ? fmtVnd(input.fxAdjustmentVnd)
        : null,
  };
}
