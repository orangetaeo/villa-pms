// 공급자 원가 캘린더 — 순수 로직 층 (rate-calendar-ux · A10)
//
// ★ 마진 비공개(사업원칙 2): 공급자는 원가(supplierCostVnd)·프리미엄 원가·자기 판매가(ownSale)만 다룬다.
//   운영자 Net/소비자가/마진은 서버 select에서 아예 제외되어 이 파일·번들·DOM 어디에도 없다.
//   승자 판정(밤별 요금)은 서버(lib/pricing.resolveRatePeriod)와 동일한 공용 엔진을 재사용하려고
//   WorkLayer로 변환하는데, WorkLayer 타입이 요구하는 net/consumer/margin 필드는 **더미(null·0)** 로 채운다
//   (실제 판매가·마진 데이터가 아니라 타입 스캐폴딩일 뿐 — DUMMY_* 주석 참조).
import type { MarginType } from "@prisma/client";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";
import { toUtc } from "@/components/rate-calendar/calendar-lib";
import type { Season, WorkLayer } from "@/components/rate-calendar/types";

/* ───────── 시즌 라이트 색 (A10 — low #059669 / shoulder #D97706 / high #EA580C / peak #DC2626) ───────── */
export const SEASON_COLOR: Record<Season, string> = {
  LOW: "#059669",
  SHOULDER: "#D97706",
  HIGH: "#EA580C",
  PEAK: "#DC2626",
};

export const SEASON_LIST: Season[] = ["LOW", "SHOULDER", "HIGH", "PEAK"];

/* ───────── 공급자 작업 모델 (클라 상태 — 폼 편집용 문자열) ───────── */
export interface SupplierLayer {
  localKey: string;
  id: string; // 서버 기존 행 id (신규는 "")
  isBase: boolean;
  season: Season;
  start: string; // YYYY-MM-DD (base는 "")
  end: string; // YYYY-MM-DD half-open (base는 "")
  label: string;
  supplierCostVnd: string; // 원가(필수)
  ownSaleVnd: string; // 공급자 자기 판매가(선택 — 운영자 마진과 무관)
  premiumOpen: boolean; // 주말·공휴일 요금 토글
  premiumCostVnd: string; // 프리미엄 박 원가(선택)
  premiumOwnSaleVnd: string; // 프리미엄 박 자기 판매가(선택)
}

/** 서버(RSC)가 주입하는 초기 DTO — 공급자 소유 금액만(원가·프리미엄 원가·자기 판매가). Net/마진 필드 부재. */
export interface SupplierLayerDTO {
  id: string;
  isBase: boolean;
  season: Season;
  startDate: string | null;
  endDate: string | null;
  label: string | null;
  supplierCostVnd: string;
  ownSaleVnd: string | null;
  premiumCostVnd: string | null;
  premiumOwnSaleVnd: string | null;
}

let counter = 0;
export const localKey = (): string => `sl${Date.now()}_${counter++}`;

export const digits = (v: string): string => v.replace(/\D/g, "");

export function fromDTO(d: SupplierLayerDTO): SupplierLayer {
  const premiumCostVnd = d.premiumCostVnd ?? "";
  const premiumOwnSaleVnd = d.premiumOwnSaleVnd ?? "";
  return {
    localKey: localKey(),
    id: d.id,
    isBase: d.isBase,
    season: d.season,
    start: d.startDate ?? "",
    end: d.endDate ?? "",
    label: d.label ?? "",
    supplierCostVnd: d.supplierCostVnd,
    ownSaleVnd: d.ownSaleVnd ?? "",
    premiumOpen: Boolean(premiumCostVnd || premiumOwnSaleVnd),
    premiumCostVnd,
    premiumOwnSaleVnd,
  };
}

export function emptyLayer(season: Season): SupplierLayer {
  return {
    localKey: localKey(),
    id: "",
    isBase: false,
    season,
    start: "",
    end: "",
    label: "",
    supplierCostVnd: "",
    ownSaleVnd: "",
    premiumOpen: false,
    premiumCostVnd: "",
    premiumOwnSaleVnd: "",
  };
}

/* ───────── 승자 판정 엔진용 WorkLayer 변환 (더미 마진·Net) ───────── */
// ★ DUMMY_* — 공급자는 마진을 다루지 않는다. 아래 값은 승자 엔진(WorkLayer)의 타입을 채우기 위한
//   0/PERCENT 스캐폴딩일 뿐 실제 마진·판매가가 아니다(원천은 서버 select에서 배제됨).
const DUMMY_MARGIN_TYPE = "PERCENT" as MarginType;

function toWork(l: SupplierLayer): WorkLayer {
  const big = (v: string): bigint | null => (v ? BigInt(v) : null);
  return {
    id: l.id || l.localKey,
    isBase: l.isBase,
    season: l.season,
    start: l.start ? toUtc(l.start) : null,
    end: l.end ? toUtc(l.end) : null,
    label: l.label || null,
    batchId: null,
    cost: BigInt(l.supplierCostVnd || "0"),
    net: null, // ← 운영자 Net 미보유(누수 차단)
    netKrw: null,
    consumer: null,
    consumerKrw: null,
    pCost: l.premiumOpen ? big(l.premiumCostVnd) : null,
    pNet: null,
    pNetKrw: null,
    pConsumer: null,
    pConsumerKrw: null,
    marginType: DUMMY_MARGIN_TYPE, // DUMMY — 미사용
    marginValue: "0", // DUMMY — 미사용
    consumerMarginType: DUMMY_MARGIN_TYPE, // DUMMY
    consumerMarginValue: "0", // DUMMY
  };
}

/** 캘린더 표시용 WorkLayer[] — 원가 있는 행만(빈 원가 신규행은 승자에서 제외). */
export function toWorkLayers(base: SupplierLayer, periods: SupplierLayer[]): { works: WorkLayer[]; baseWork: WorkLayer | null } {
  const baseWork = base.supplierCostVnd ? toWork(base) : null;
  const works = periods
    .filter((p) => p.start && p.end && p.supplierCostVnd)
    .map(toWork);
  return { works: baseWork ? [...works, baseWork] : works, baseWork };
}

/* ───────── 셀 축약 표기 (A10 — "5,5tr" / "8tr", 베트남식 콤마 소수) ───────── */
export function abbrevTr(v: bigint | null): string {
  if (v == null) return "";
  const m = Number(v) / 1_000_000;
  const s = m.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return `${s}tr`;
}

/** 정확 금액 — 점 구분 전체 표기 + ₫ (예: 7.000.000₫). */
export function fmtFull(v: string | bigint | null): string {
  if (v == null) return "—";
  const s = typeof v === "bigint" ? v.toString() : v;
  return `${formatVnd(s)}₫`;
}

/* ───────── 선택 바구니 → 연속 run 그룹 (비연속 날짜 지원) ───────── */
export interface Run {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD half-open (마지막 밤 + 1일)
  nights: number;
}
export function selectRuns(days: Set<string>): Run[] {
  const nextDay = (ds: string) => new Date(toUtc(ds).getTime() + 86_400_000).toISOString().slice(0, 10);
  const runs: Run[] = [];
  for (const ds of [...days].sort()) {
    const last = runs[runs.length - 1];
    if (last && last.end === ds) {
      last.end = nextDay(ds);
      last.nights++;
    } else {
      runs.push({ start: ds, end: nextDay(ds), nights: 1 });
    }
  }
  return runs;
}

/* ───────── 저장 페이로드 (cost 라우트 base+periods 전체교체 스키마) ───────── */
export interface SaveBody {
  base: {
    season: Season;
    supplierCostVnd: string;
    supplierSalePriceVnd: string | null;
    premiumSupplierCostVnd: string | null;
    premiumSupplierSalePriceVnd: string | null;
    label: string | null;
  };
  periods: {
    id?: string;
    season: Season;
    startDate: string;
    endDate: string;
    supplierCostVnd: string;
    supplierSalePriceVnd: string | null;
    premiumSupplierCostVnd: string | null;
    premiumSupplierSalePriceVnd: string | null;
    label: string | null;
  }[];
}

const premiumOut = (l: SupplierLayer) => ({
  premiumSupplierCostVnd: l.premiumOpen ? l.premiumCostVnd || null : null,
  premiumSupplierSalePriceVnd: l.premiumOpen ? l.premiumOwnSaleVnd || null : null,
});

export function buildSaveBody(base: SupplierLayer, periods: SupplierLayer[]): SaveBody {
  return {
    base: {
      season: base.season,
      supplierCostVnd: base.supplierCostVnd,
      supplierSalePriceVnd: base.ownSaleVnd || null,
      ...premiumOut(base),
      label: base.label.trim() || null,
    },
    periods: periods.map((p) => ({
      ...(p.id ? { id: p.id } : {}),
      season: p.season,
      startDate: p.start,
      endDate: p.end,
      supplierCostVnd: p.supplierCostVnd,
      supplierSalePriceVnd: p.ownSaleVnd || null,
      ...premiumOut(p),
      label: p.label.trim() || null,
    })),
  };
}
