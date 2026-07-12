import { BookingChannel, Currency } from "@prisma/client";
import type { DbClient, StayRange } from "./availability";
import {
  quoteStayForVilla,
  getFxVndPerKrw,
  krwToVndSnapshot,
  suggestSalePriceKrw,
  type NightQuote,
} from "./pricing";

/**
 * 관리자 예약 견적 (admin-manual-booking 후속 확장 2) — 단일 소스
 *
 * 예약 생성 폼이 "선택한 빌라 + 날짜"의 판매가·원가·마진을 미리 보여주고 판매가 입력칸을
 * 자동으로 채우기 위한 견적. 계산 엔진은 **제안 생성(lib/proposal.createProposal)·관리자 예약
 * 생성(lib/admin-booking.createAdminBooking)과 동일한 quoteStayForVilla**를 그대로 재사용한다
 * (드리프트 0 — 완료 기준 ⑬):
 *   - 원가 스냅샷 totalCostVnd = quoteStayForVilla(...).totalSupplierCostVnd
 *     → createAdminBooking이 supplierCostVnd로 저장하는 값과 **동일 인자·동일 함수**.
 *   - 판매가 제안(rows·totalSale*) = quoteStayForVilla의 박별 판매가 합산
 *     → createProposal이 ProposalItem 가격으로 저장하는 값과 동일(채널→가격계층 규칙 포함).
 *
 * ⚠️ 원가·마진 노출: 이 모듈은 supplierCostVnd·marginVnd를 포함한다(사업원칙 2). 라우트는
 *    반드시 canViewFinance 게이트 뒤에서만 호출할 것 — SUPPLIER·공개 경로에 직렬화 금지.
 *
 * USD(Phase 2): 요율표에 판매단가가 없어 자동 판매가가 없다(제안 경로와 동일 관례). VND로 참조
 *    견적을 만들고 manual:true 를 세워 "참조값 + 수동 입력"임을 알린다. 환율이 있으면 KRW 참조 환산도.
 */

/** 견적 거부 사유 — 라우트가 상태코드로 매핑(VILLA_NOT_FOUND→404). RATE_NOT_SET은 MissingRateError로 전파. */
export type BookingQuoteRejectReason = "VILLA_NOT_FOUND";

export class BookingQuoteRejectedError extends Error {
  constructor(public readonly reason: BookingQuoteRejectReason) {
    super(reason);
    this.name = "BookingQuoteRejectedError";
  }
}

/** 요율 구간 브레이크다운 1행 — 연속 동일 요율(구간 라벨·판매가·원가) 밤을 한 행으로 그룹 */
export interface BookingQuoteRow {
  /** 요율 구간 라벨 = SeasonType(LOW/HIGH/PEAK) enum 문자열. FE에서 i18n. 시즌 없으면 null */
  label: string | null;
  nights: number;
  /** saleCurrency=KRW일 때만 */
  saleKrwPerNight?: number;
  /** saleCurrency=VND, 또는 USD 참조 견적일 때만 */
  saleVndPerNight?: bigint;
  /** 통화 무관 항상 VND(공급자 원가) */
  costVndPerNight: bigint;
}

export interface BookingQuoteResult {
  nights: number;
  saleCurrency: Currency;
  /** USD — 자동 판매가 없음(수동 입력). rows·total*은 VND 참조값 */
  manual?: true;
  rows: BookingQuoteRow[];
  /** 통화별 총 판매가(native). USD는 VND 참조 총액(+가능하면 KRW 환산) */
  totalSaleKrw?: number;
  totalSaleVnd?: bigint;
  totalCostVnd: bigint;
  /** 총판매가 VND 환산 - 총원가. KRW 채널은 fx로 환산(fx null이면 null). USD는 VND 참조 마진 */
  marginVnd: bigint | null;
  /** 생성 시점 환율 스냅샷(1 KRW = x VND). 미설정이면 null */
  fxVndPerKrw: string | null;
}

/**
 * 박별 견적(NightQuote[])을 요율 구간 행으로 그룹 (순수 함수 — 단위 테스트 대상).
 * 연속한 밤들의 (구간 라벨=season, 표시 판매가, 원가)가 모두 같으면 한 행으로 묶어 nights 합산.
 * @param displayCurrency 판매가 표시 통화 — KRW면 saleKrw, VND(USD 참조 포함)면 saleVnd를 읽는다.
 */
export function groupQuoteRows(
  nightly: NightQuote[],
  displayCurrency: "KRW" | "VND"
): BookingQuoteRow[] {
  const rows: BookingQuoteRow[] = [];
  for (const n of nightly) {
    const label = n.season as string;
    const saleKrw = displayCurrency === "KRW" ? n.saleKrw : undefined;
    const saleVnd = displayCurrency === "VND" ? n.saleVnd : undefined;
    const last = rows[rows.length - 1];
    if (
      last &&
      last.label === label &&
      last.saleKrwPerNight === saleKrw &&
      last.saleVndPerNight === saleVnd &&
      last.costVndPerNight === n.costVnd
    ) {
      last.nights += 1;
      continue;
    }
    rows.push({
      label,
      nights: 1,
      ...(saleKrw !== undefined ? { saleKrwPerNight: saleKrw } : {}),
      ...(saleVnd !== undefined ? { saleVndPerNight: saleVnd } : {}),
      costVndPerNight: n.costVnd,
    });
  }
  return rows;
}

/**
 * 단일 빌라 예약 견적 생성 (DB 층).
 * quoteStayForVilla(admin-booking·proposal과 동일 엔진)로 박별 판매가·원가를 산출하고,
 * 요율 구간 그룹핑 + 총액 + 마진(VND 환산) + 환율을 얹는다.
 *
 * - 빌라 없음 → BookingQuoteRejectedError("VILLA_NOT_FOUND") (라우트 404).
 * - 요율 미설정 → quoteStayForVilla가 MissingBaseRateError(=MissingRateError) throw → 라우트 409.
 * - 검수 게이트(isSellable) 미검사: 견적은 조회일 뿐(제안 candidates 관례). 판매 가능 여부는 생성 시 강제.
 */
export async function buildBookingQuote(
  db: DbClient,
  villaId: string,
  range: StayRange,
  saleCurrency: Currency,
  channel?: BookingChannel
): Promise<BookingQuoteResult> {
  // 빌라 존재 확인 — 없으면 404(요율 미설정 409와 구분). select 최소화.
  const villa = await db.villa.findUnique({ where: { id: villaId }, select: { id: true } });
  if (!villa) throw new BookingQuoteRejectedError("VILLA_NOT_FOUND");

  const isUsd = saleCurrency === Currency.USD;
  // USD는 자동 판매가가 없어 VND로 참조 견적을 낸다(제안 경로와 동일). 그 외는 판매 통화 그대로.
  const quoteCurrency = isUsd ? Currency.VND : saleCurrency;
  const quote = await quoteStayForVilla(db, villaId, range, quoteCurrency, channel);
  const fxVndPerKrw = await getFxVndPerKrw(db);

  const displayCurrency: "KRW" | "VND" = saleCurrency === Currency.KRW ? "KRW" : "VND";
  const rows = groupQuoteRows(quote.nightly, displayCurrency);
  const totalCostVnd = quote.totalSupplierCostVnd;

  let totalSaleKrw: number | undefined;
  let totalSaleVnd: bigint | undefined;
  // 마진 계산용 판매가 VND 환산 — KRW 채널은 fx 필요(없으면 null), VND/USD 참조는 그대로 VND.
  let saleVndForMargin: bigint | null;

  if (saleCurrency === Currency.KRW) {
    totalSaleKrw = quote.totalSaleKrw!;
    saleVndForMargin = fxVndPerKrw ? krwToVndSnapshot(totalSaleKrw, fxVndPerKrw) : null;
  } else {
    // VND 채널(실판매가) 또는 USD 참조 견적 — 판매가는 VND.
    totalSaleVnd = quote.totalSaleVnd!;
    saleVndForMargin = totalSaleVnd;
    // USD 참조: 환율이 있으면 KRW 환산 총액도 제공(참고용).
    if (isUsd && fxVndPerKrw) {
      totalSaleKrw = suggestSalePriceKrw(totalSaleVnd, fxVndPerKrw);
    }
  }

  const marginVnd = saleVndForMargin === null ? null : saleVndForMargin - totalCostVnd;

  return {
    nights: quote.nights,
    saleCurrency,
    ...(isUsd ? { manual: true as const } : {}),
    rows,
    ...(totalSaleKrw !== undefined ? { totalSaleKrw } : {}),
    ...(totalSaleVnd !== undefined ? { totalSaleVnd } : {}),
    totalCostVnd,
    marginVnd,
    fxVndPerKrw,
  };
}
