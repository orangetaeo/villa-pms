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
import { formatVnd, formatKrw, formatThousands } from "@/lib/format";
import { formatVillaName } from "@/lib/villa-name";
import { renderLinkMessage } from "@/lib/webchat-link-templates";

const SEASON_LABEL: Record<SeasonType, string> = {
  LOW: "비수기",
  SHOULDER: "준성수기",
  HIGH: "성수기",
  PEAK: "극성수기",
};

// ── 빌라 공유 (S3) — 상대 타입별 입력 타입 분리 ─────────────────────

/** 요율 기간 메타 — 받는 쪽이 "언제 가격인지" 알 수 있게 기간·라벨 병기(금액 무관). */
export interface RatePeriodMeta {
  season: SeasonType;
  /** true=기본요금(날짜 없음 — 특수 기간 외 전 기간 적용) */
  isBase: boolean;
  /** isBase=false일 때 존재. 포함 */
  startDate: Date | null;
  /** isBase=false일 때 존재. 제외(half-open) — 표시할 땐 -1일해 포함일로 변환 */
  endDate: Date | null;
  /** "2026 설", "여름 성수기 1차" 등 */
  label?: string | null;
}

/** 공급자에게 노출 가능한 요율(원가만) — 판매가/마진 필드는 타입에 아예 없음. */
export interface SupplierRateView extends RatePeriodMeta {
  supplierCostVnd: bigint;
}

/** 고객에게 노출 가능한 요율(판매가만) — 원가/마진 필드는 타입에 아예 없음. */
export interface CustomerRateView extends RatePeriodMeta {
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
  // 원가 0(≤0 — base 초기화 미책정)인 행은 생략. 유효 행이 없으면 섹션 헤더도 생략(계약 C).
  const priced = sortRatePeriods(rates).filter((r) => r.supplierCostVnd > 0n);
  if (priced.length) {
    lines.push("— 원가(1박)");
    for (const r of priced) {
      lines.push(`  ${ratePeriodLabel(r)}: ${formatVnd(r.supplierCostVnd)}`);
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
  // 판매가 0(≤0 — base 초기화로 salePriceKrw=0 등)인 행은 생략. 유효 행이 없으면 섹션 헤더도 생략(계약 C).
  const useKrw = saleCurrency === Currency.KRW;
  const priced = sortRatePeriods(rates).filter((r) =>
    useKrw ? r.salePriceKrw > 0 : r.salePriceVnd > 0n
  );
  if (priced.length) {
    lines.push("— 가격(1박)");
    for (const r of priced) {
      const price = useKrw ? formatKrw(r.salePriceKrw) : formatVnd(r.salePriceVnd);
      lines.push(`  ${ratePeriodLabel(r)}: ${price}`);
    }
  }
  return lines.join("\n");
}

/**
 * 간단정보 + 대표 "부터" 가격 + 블로그 링크 본문 (계약 E, Q2).
 * 발행된 빌라 소개글이 있을 때 고객 경로에서 상세 요율 나열 대신 이 요약을 보낸다.
 * from은 CustomerRateView 최저값(pickLowestSalePrice 산출) — saleCurrency에 해당하는 값만 표기.
 * ⚠️ 누수 불변식: from에는 판매가만, 원가·마진 없음. 블로그 링크는 이미 익명 공개(실명·정확위치 없음).
 */
export function buildVillaShareBriefWithBlog(
  villa: VillaShareBase,
  from: { krw: number | null; vnd: bigint | null } | null,
  saleCurrency: Currency,
  blog: { url: string; title: string }
): string {
  const lines = shareHeader(villa);
  if (from) {
    const price =
      saleCurrency === Currency.KRW
        ? from.krw != null
          ? formatKrw(from.krw)
          : null
        : from.vnd != null
          ? formatVnd(from.vnd)
          : null;
    if (price) lines.push(`${price} ~ / 박`);
  }
  lines.push("");
  lines.push(`📖 상세 소개: ${blog.title}`);
  lines.push(blog.url);
  return lines.join("\n");
}

/** 기본요금 먼저, 특수 기간은 시작일 순 — 받는 쪽이 달력 순서로 읽게. */
function sortRatePeriods<T extends RatePeriodMeta>(rates: T[]): T[] {
  return [...rates].sort((a, b) => {
    if (a.isBase !== b.isBase) return a.isBase ? -1 : 1;
    const at = a.startDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.startDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
}

/** @db.Date(UTC 자정) → "M.D" */
function formatMonthDayUtc(d: Date): string {
  return `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}

/**
 * 요율 행 이름 — 기본요금은 "기본", 특수 기간은 "성수기 · 라벨 (7.15 ~ 8.31)".
 * endDate는 half-open(제외)이라 -1일해 마지막 적용일로 표시한다.
 */
function ratePeriodLabel(r: RatePeriodMeta): string {
  if (r.isBase || !r.startDate || !r.endDate) return "기본";
  const lastDay = new Date(r.endDate.getTime() - 86_400_000);
  const range = `${formatMonthDayUtc(r.startDate)} ~ ${formatMonthDayUtc(lastDay)}`;
  const name = r.label?.trim()
    ? `${SEASON_LABEL[r.season]} · ${r.label.trim()}`
    : SEASON_LABEL[r.season];
  return `${name} (${range})`;
}

// ── 제안 공유 (S2) — 고객 전용. 판매가만(원가·마진 타입에 없음). ─────────

/** 제안 포함 빌라 1건 — 판매가 필드만(원가/마진은 타입에 아예 없음, D2 불변식 유지). */
export interface ProposalShareItemView {
  villaName: string;
  villaNameVi?: string | null;
  bedrooms: number;
  hasPool: boolean;
  checkIn: Date;
  checkOut: Date;
  /** proposal.saleCurrency에 해당하는 쪽만 채워짐 (ADR-0003, USD는 Phase 2 정수 달러) */
  totalKrw: number | null;
  totalVnd: bigint | null;
  totalUsd?: number | null;
}

export interface ProposalShareView {
  token: string;
  clientName: string;
  expiresAt: Date;
  saleCurrency: Currency;
  items: ProposalShareItemView[];
}

/** @db.Date 쌍 → 박수 (UTC ms 차 — day-diff 함정 회피, 날짜 전용 컬럼 전제) */
function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
}

/**
 * 제안 공유 본문 — 받는 여행사가 링크를 열기 전에 내용(빌라·기간·금액)을 파악하도록 요약 동봉.
 * 금액은 판매가(고객 정당 정보)만 — 링크 페이지(/p)와 동일 경계. 원가·마진은 타입 차단.
 */
export function buildProposalShareText(proposal: ProposalShareView, baseUrl: string): string {
  const url = `${baseUrl.replace(/\/$/, "")}/p/${proposal.token}`;
  const expires = formatDateVn(proposal.expiresAt);
  const items = proposal.items;

  const lines = [`📋 Villa Go 제안서 — ${proposal.clientName}님`];

  // 기간 요약 — 전 빌라 동일 일정이면 헤더 한 줄, 다르면 빌라별 표기
  const sameRange =
    items.length > 0 &&
    items.every(
      (it) =>
        it.checkIn.getTime() === items[0].checkIn.getTime() &&
        it.checkOut.getTime() === items[0].checkOut.getTime()
    );
  if (items.length > 0) {
    const head = [`빌라 ${items.length}개`];
    if (sameRange) {
      const first = items[0];
      head.push(
        `${formatMonthDayUtc(first.checkIn)} ~ ${formatMonthDayUtc(first.checkOut)}`,
        `${nightsBetween(first.checkIn, first.checkOut)}박`
      );
    }
    lines.push(head.join(" · "));
    lines.push("");
    items.forEach((it, i) => {
      const displayName = formatVillaName({ name: it.villaName, nameVi: it.villaNameVi });
      const specs: string[] = [];
      if (!sameRange) {
        specs.push(
          `${formatMonthDayUtc(it.checkIn)}~${formatMonthDayUtc(it.checkOut)} · ${nightsBetween(it.checkIn, it.checkOut)}박`
        );
      }
      specs.push(`침실 ${it.bedrooms}`);
      if (it.hasPool) specs.push("수영장");
      const total =
        proposal.saleCurrency === Currency.KRW
          ? it.totalKrw !== null
            ? formatKrw(it.totalKrw)
            : null
          : proposal.saleCurrency === Currency.USD
            ? it.totalUsd != null
              ? `$${formatThousands(it.totalUsd)}`
              : null
            : it.totalVnd !== null
              ? formatVnd(it.totalVnd)
              : null;
      if (total) specs.push(`총 ${total}`);
      lines.push(`  ${i + 1}. ${displayName} — ${specs.join(" · ")}`);
    });
    lines.push("");
  }

  lines.push(`👉 사진·상세 보기: ${url}`);
  lines.push(`⏰ 유효기간: ${expires}까지 (이후 링크가 만료됩니다)`);
  return lines.join("\n");
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

// ── 게스트 링크 공유 (C) — CUSTOMER(투숙객) 전용. 금액 없음. ─────────
//
// /g 체크인·부가서비스·영수증 안내문. 대화 상대 언어(locale)로 사전 번역(webchat-link-templates 재사용).
//   ★Gemini 미경유 — 5언어(ko/vi/en/zh/ru) 사전 번역이라 번역 비용 0·URL 훼손 0.
//   ★금액 필드가 애초에 없음(링크·안내문뿐) — 마진/판매가/원가 누수 불가.

/** 게스트 링크 종류 — /g(체크인) · /g/options(부가서비스) · /g/receipt(영수증). */
export type GuestLinkKind = "checkin" | "options" | "receipt";

/**
 * 게스트 링크 공유 본문 — 안내문(대화 상대 언어) + 줄바꿈 + URL.
 * @param locale 대화 상대 언어(CUSTOMER 대화 translateMode 파생: OFF→ko, VI→vi, EN→en). 5언어 밖은 en 폴백.
 * @param url 완성된 /g 링크(체크인/옵션/영수증 경로 포함).
 */
export function buildGuestLinkShareText(
  kind: GuestLinkKind,
  locale: string | null | undefined,
  url: string
): string {
  // webchat-link-templates의 방문자 언어 완성문(본문 + URL)을 그대로 사용 — 채널 독립 사전 번역.
  return renderLinkMessage(kind, locale, url).visitor;
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
