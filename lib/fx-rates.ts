// lib/fx-rates.ts — 게스트 부가옵션 페이지 다통화 "오늘 환율" 표시 (open.er-api.com, 무료·키 불필요)
//
// 가격은 VND 단일통화로 저장(원칙). 게스트 화면은 항상 VND를 기본 표기하고,
//   하단에 사용자 언어의 모국통화로 "오늘 환율 기준" 환산액을 보조 표기한다.
//   환율은 하루 1회만 외부 API에서 받아 AppSetting에 캐시(요청마다 호출 금지). API 장애 시 마지막 캐시 폴백.
//   ★ 환산값은 표시용 근사치("≈")일 뿐 청구·저장 금액이 아니다(저장·정산은 항상 VND/스냅샷).
import { formatThousands } from "./format";
import type { PublicLang } from "./public-i18n";

export type DisplayCurrency = "KRW" | "USD" | "RUB" | "CNY";

/** 언어 → 하단 환산 통화(모국통화 1개). 베트남어는 VND만 → null(환산줄 없음). */
export const CURRENCY_BY_LANG: Record<PublicLang, DisplayCurrency | null> = {
  vi: null,
  ko: "KRW",
  en: "USD",
  ru: "RUB",
  zh: "CNY",
};

/** 통화 기호 — 외화 4종은 숫자 앞, VND(₫)는 뒤(표기는 호출측). */
export const CURRENCY_SYMBOL: Record<DisplayCurrency | "VND", string> = {
  VND: "₫",
  KRW: "₩",
  USD: "$",
  RUB: "₽",
  CNY: "¥",
};

const SUPPORTED: DisplayCurrency[] = ["KRW", "USD", "RUB", "CNY"];
const APP_SETTING_KEY = "FX_DAILY_RATES_VND";
const API_URL = "https://open.er-api.com/v6/latest/USD";

/** 통화별 "1 단위 = X VND"(vndPerUnit). 표시 환산에만 사용. */
export interface DailyRates {
  date: string; // 갱신 기준일 (Asia/Ho_Chi_Minh, YYYY-MM-DD)
  vndPerUnit: Record<DisplayCurrency, number>;
}

/** getDailyRates가 의존하는 최소 DB 형태(AppSetting key/value). PrismaClient 호환. */
interface FxDbClient {
  appSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }): Promise<unknown>;
  };
}

/** Asia/Ho_Chi_Minh 기준 오늘 YYYY-MM-DD (en-CA = ISO 형식). */
function hcmToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** open.er-api.com(USD 기준)에서 환율을 받아 통화별 vndPerUnit 계산. 실패는 null(throw 안 함). */
async function fetchVndPerUnit(): Promise<Record<DisplayCurrency, number> | null> {
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) return null;
    const r = data.rates;
    const vndPerUsd = r.VND;
    if (!vndPerUsd || vndPerUsd <= 0) return null;
    const out = {} as Record<DisplayCurrency, number>;
    for (const c of SUPPORTED) {
      const perUsd = c === "USD" ? 1 : r[c];
      if (!perUsd || perUsd <= 0) return null;
      // 1 c = (VND per USD) / (c per USD) VND
      out[c] = vndPerUsd / perUsd;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 일일 환율 — 오늘(HCM) 캐시가 있으면 그대로, 없으면 API 1회 갱신 후 캐시.
 *   API 장애 시 마지막 캐시(stale 허용) 폴백, 그마저 없으면 null(→ 화면은 VND만 표기).
 */
export async function getDailyRates(db: FxDbClient, now: Date = new Date()): Promise<DailyRates | null> {
  const today = hcmToday(now);
  let cached: DailyRates | null = null;
  const row = await db.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as DailyRates;
      if (parsed && parsed.vndPerUnit) cached = parsed;
    } catch {
      cached = null;
    }
  }
  if (cached && cached.date === today) return cached;

  const fresh = await fetchVndPerUnit();
  if (!fresh) return cached; // 장애 → 마지막 캐시 또는 null
  const next: DailyRates = { date: today, vndPerUnit: fresh };
  try {
    await db.appSetting.upsert({
      where: { key: APP_SETTING_KEY },
      create: { key: APP_SETTING_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
  } catch {
    /* 캐시 저장 실패는 무시 — 이번 응답엔 fresh 사용 */
  }
  return next;
}

/** VND(BigInt) → 표시통화 근사치(Number). 표시용("≈")이므로 부동소수 허용(청구·저장 금액 아님). */
export function convertFromVnd(amountVnd: bigint, vndPerUnit: number): number {
  if (vndPerUnit <= 0) return 0;
  return Number(amountVnd) / vndPerUnit;
}

/** 통화별 표시 반올림 — KRW는 100단위, 그 외 정수. */
function roundForCurrency(value: number, currency: DisplayCurrency): number {
  if (currency === "KRW") return Math.round(value / 100) * 100;
  return Math.round(value);
}

/** "≈ ₩30,000" 형태 환산 표기(외화 기호는 숫자 앞). */
export function formatConverted(
  amountVnd: bigint,
  currency: DisplayCurrency,
  vndPerUnit: number
): string {
  const v = roundForCurrency(convertFromVnd(amountVnd, vndPerUnit), currency);
  return `≈ ${CURRENCY_SYMBOL[currency]}${formatThousands(v)}`;
}
