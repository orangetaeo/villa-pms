// ADR-0009 S2~S4 — 채팅 공유 본문 빌더 (누수 분기 단일 소스, D2 매트릭스/D4)
//
// ★ 절대 규칙 (D2 불변식):
//   - 마진(marginType/marginValue)은 4종 어디에도 절대 미포함.
//   - 공급자(SUPPLIER) 본문엔 supplierCostVnd(원가)만 — 판매가/KRW 미포함.
//   - 고객(CUSTOMER) 본문엔 salePriceVnd|salePriceKrw(판매가)만 — 원가 미포함.
//   - 이 빌더들은 **이미 select 화이트리스트로 한쪽 필드만 조회된 입력**을 받는다.
//     quoteStay/StayQuote(원가+판매가 동시 포함 객체)를 직접 받지 않는다 — 타입으로 강제.
//
// 발송 본문(여기서 만든 문자열)을 그대로 ZaloMessage.text에 저장한다("보낸 그대로" — D3.5).
// 카드 JSON을 저장하지 않으므로 원가+판매가가 한 레코드에 공존할 수 없다.
import { Currency, SeasonType } from "@prisma/client";
import { formatVnd, formatKrw } from "@/lib/format";
import { formatVillaName } from "@/lib/villa-name";

const SEASON_LABEL: Record<SeasonType, string> = {
  LOW: "비수기",
  HIGH: "성수기",
  PEAK: "극성수기",
};

// ── 빌라 공유 (S3) — 상대 타입별 입력 타입 분리 ─────────────────────

/** 공급자에게 노출 가능한 요율(원가만) — 판매가/마진 필드는 타입에 아예 없음. */
export interface SupplierRateView {
  season: SeasonType;
  supplierCostVnd: bigint;
}

/** 고객에게 노출 가능한 요율(판매가만) — 원가/마진 필드는 타입에 아예 없음. */
export interface CustomerRateView {
  season: SeasonType;
  salePriceVnd: bigint;
  salePriceKrw: number;
}

export interface VillaShareBase {
  name: string;
  nameVi?: string | null;
  complex: string | null;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  /** 시설명(이미 라벨로 변환된 문자열 목록) — 금액 무관 */
  amenityLabels: string[];
}

function shareHeader(v: VillaShareBase): string[] {
  const lines: string[] = [];
  const displayName = formatVillaName(v);
  lines.push(v.complex ? `🏠 ${displayName} (${v.complex})` : `🏠 ${displayName}`);
  lines.push(`침실 ${v.bedrooms} · 욕실 ${v.bathrooms} · 최대 ${v.maxGuests}인`);
  const features: string[] = [];
  if (v.hasPool) features.push("수영장");
  if (v.breakfastAvailable) features.push("조식 가능");
  if (features.length) lines.push(features.join(" · "));
  if (v.amenityLabels.length) lines.push(`시설: ${v.amenityLabels.join(", ")}`);
  return lines;
}

/**
 * 공급자용 빌라 공유 본문 — **원가(supplierCostVnd)만**. 판매가·KRW·마진 없음.
 * 입력 타입(SupplierRateView)에 판매가/마진 필드가 없어 컴파일 단계에서 누수 차단.
 */
export function buildVillaShareTextForSupplier(
  villa: VillaShareBase,
  rates: SupplierRateView[]
): string {
  const lines = shareHeader(villa);
  if (rates.length) {
    lines.push("— 원가(1박)");
    for (const r of sortRates(rates)) {
      lines.push(`  ${SEASON_LABEL[r.season]}: ${formatVnd(r.supplierCostVnd)}`);
    }
  }
  return lines.join("\n");
}

/**
 * 고객용 빌라 공유 본문 — **판매가만**(saleCurrency에 따라 VND 또는 KRW). 원가·마진 없음.
 * 입력 타입(CustomerRateView)에 원가/마진 필드가 없어 컴파일 단계에서 누수 차단.
 * @param saleCurrency 이 고객 맥락 통화(여행사·랜드사=VND, 직접=KRW). 한쪽만 본문에 기재.
 */
export function buildVillaShareTextForCustomer(
  villa: VillaShareBase,
  rates: CustomerRateView[],
  saleCurrency: Currency
): string {
  const lines = shareHeader(villa);
  if (rates.length) {
    lines.push("— 가격(1박)");
    for (const r of sortRates(rates)) {
      const price =
        saleCurrency === Currency.KRW
          ? formatKrw(r.salePriceKrw)
          : formatVnd(r.salePriceVnd);
      lines.push(`  ${SEASON_LABEL[r.season]}: ${price}`);
    }
  }
  return lines.join("\n");
}

const SEASON_ORDER: Record<SeasonType, number> = { LOW: 0, HIGH: 1, PEAK: 2 };
function sortRates<T extends { season: SeasonType }>(rates: T[]): T[] {
  return [...rates].sort((a, b) => SEASON_ORDER[a.season] - SEASON_ORDER[b.season]);
}

// ── 제안 공유 (S2) — 고객 전용. 공개 URL만(판매가 페이지). ─────────

export interface ProposalShareView {
  token: string;
  clientName: string;
  expiresAt: Date;
}

/**
 * 제안 공유 본문 — /p/[token] 공개 링크 + 유효기간 안내.
 * 링크 대상 페이지가 이미 판매가 전용·공개이므로 본문에 금액을 직접 넣지 않는다(URL만).
 */
export function buildProposalShareText(proposal: ProposalShareView, baseUrl: string): string {
  const url = `${baseUrl.replace(/\/$/, "")}/p/${proposal.token}`;
  const expires = formatDateVn(proposal.expiresAt);
  return [
    `📋 제안서: ${proposal.clientName}`,
    url,
    `유효기간: ${expires}까지`,
  ].join("\n");
}

// ── 정산 공유 (S4) — 공급자 전용. 본인 정산만. VND 원가 기반. ──────

export interface SettlementShareView {
  yearMonth: string;
  totalVnd: bigint;
  itemCount: number;
  status: string;
}

const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  CONFIRMED: "확정",
  PAID: "지급완료",
};

/**
 * 정산 공유 본문 — 월·총지급액(VND)·건수·상태. 판매가·마진·타 공급자 정보 없음.
 * 호출부에서 settlement.supplierId === conversation.userId 검증 후에만 전달.
 */
export function buildSettlementShareText(s: SettlementShareView): string {
  const statusLabel = SETTLEMENT_STATUS_LABEL[s.status] ?? s.status;
  return [
    `💰 정산 — ${s.yearMonth}`,
    `총 지급액: ${formatVnd(s.totalVnd)}`,
    `예약 ${s.itemCount}건 · ${statusLabel}`,
  ].join("\n");
}

/** YYYY.MM.DD HH:mm (Asia/Ho_Chi_Minh) — 제안 유효기간 표시용 */
function formatDateVn(date: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
