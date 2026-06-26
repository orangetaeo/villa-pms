// lib/partner-invoice-statement.ts — PARTNER-3b-UI: 마감 청구서(PartnerInvoice) 데이터 모델 (순수).
//
// ★ 파트너(여행사·랜드사) 대면 — 객실료 잔금 청구. 청구 라인·총액·기한만.
//   **신용한도·마진·판매가(KRW) 절대 미포함**(원칙2 + ADR-0022 누수 가드).
//   렌더(react-pdf)는 lib/partner-invoice-pdf.tsx 로 분리.
// 계약: docs/contracts/PARTNER-3b-UI.md

import { fmtVnd } from "@/lib/settlement-statement";

export interface InvoiceLineInput {
  villaName: string;
  /** 투숙 기간 표시 문자열 (체크인~체크아웃) */
  stay: string;
  nights: number;
  /** 청구 잔금 VND (BigInt) — 객실료 − 선금/기지급 */
  amountVnd: bigint;
}

export interface InvoiceStatementInput {
  /** 파트너 표시명 (호출부가 nameVi 우선·name 폴백으로 결정) */
  partnerName: string;
  /** 청구서 번호 표시 문자열 */
  invoiceNo: string;
  periodStart: string; // 표시 문자열
  periodEnd: string;
  dueDate: string;
  issuedAt: string;
  lines: InvoiceLineInput[];
  /** 기수납액 VND (부분수납 청구서 재발행 시 표기). 기본 0 */
  paidVnd?: bigint;
}

/** PDF 렌더 모델 — 전부 표시 문자열. 한도·마진·KRW 필드 없음(누수 차단). */
export interface InvoiceStatementModel {
  partnerName: string;
  invoiceNo: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  issuedAt: string;
  rows: { villaName: string; stay: string; nights: string; amount: string }[];
  total: string;
  /** 기수납·미수 잔액 (부분수납 시만, 아니면 null) */
  paid: string | null;
  outstanding: string | null;
}

/**
 * 청구서 데이터 → vi 청구서 모델 (순수). 총액 = 라인 잔금 합계(재계산).
 * 라인이 비면 throw(빈 청구서 = 호출부 버그).
 */
export function buildInvoiceStatementModel(
  input: InvoiceStatementInput
): InvoiceStatementModel {
  if (input.lines.length === 0) {
    throw new RangeError("청구서 라인이 비었습니다 — 묶인 채권 없음");
  }
  const total = input.lines.reduce((s, l) => s + l.amountVnd, 0n);
  const paid = input.paidVnd ?? 0n;
  const outstanding = total - paid;
  const showPaid = paid > 0n;
  return {
    partnerName: input.partnerName,
    invoiceNo: input.invoiceNo,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    issuedAt: input.issuedAt,
    rows: input.lines.map((l) => ({
      villaName: l.villaName,
      stay: l.stay,
      nights: `${l.nights}`,
      amount: fmtVnd(l.amountVnd),
    })),
    total: fmtVnd(total),
    paid: showPaid ? fmtVnd(paid) : null,
    outstanding: showPaid ? fmtVnd(outstanding > 0n ? outstanding : 0n) : null,
  };
}
