// lib/fx-effective — 유효 환율 단일 해석 (admin-manual-booking 후속확장 3)
//
// 판매가 스냅샷(예약·제안·견적)이 참조하는 "유효 환율"을 한 곳에서 해석한다.
//   FX_MODE=MANUAL(기본) → 운영자 수동 입력 키(FX_VND_PER_KRW / FX_VND_PER_USD) 그대로.
//   FX_MODE=AUTO         → getDailyRates(open.er-api 일일 캐시, 기존 인프라) 시세 →
//                          외부 API 실패 시 getDailyRates 내장 마지막 캐시 폴백 →
//                          그마저 없으면 수동 키 폴백(fail-safe).
//
// ★ 절대 throw 금지 — 환율 해석이 견적/예약을 죽이면 안 된다. 미설정=null 반환(호출측 안전 처리).
// ★ 반환 형식은 lib/pricing 환율 문자열 관례(Decimal 문자열 /^\d+(\.\d{1,4})?$/)와 동일 →
//   suggestSalePriceKrw·suggestSalePriceUsd·krwToVndSnapshot·usdToVndSnapshot에 그대로 투입 가능.
// ★ 범위: 이 해석은 "판매가 스냅샷"(예약·제안·견적)만 대상. 대시보드·정산·서비스주문의 표시/정산용
//   fx는 성격이 달라(스냅샷 아님) 기존 수동 키(getFxVndPerKrw)를 그대로 읽는다 — 치환하지 않음.
import type { DbClient } from "./availability";
import { getFxVndPerKrw, getFxVndPerUsd } from "./pricing";
import { getDailyRates } from "./fx-rates";
import { formatVndPerUnit } from "./fx-format";

/** AppSetting 키 — 유효 환율 모드 ("MANUAL"|"AUTO", 미설정=MANUAL). */
export const FX_MODE_KEY = "FX_MODE";

export type FxMode = "MANUAL" | "AUTO";

/** FX_MODE 값 해석 — 정확히 "AUTO"일 때만 AUTO. 미설정·기타 = MANUAL(보수적 기본). */
export function parseFxMode(value: string | null | undefined): FxMode {
  return value === "AUTO" ? "AUTO" : "MANUAL";
}

/** 현재 유효 환율 모드 조회 (미설정=MANUAL). */
async function readFxMode(db: DbClient): Promise<FxMode> {
  const row = await db.appSetting.findUnique({ where: { key: FX_MODE_KEY } });
  return parseFxMode(row?.value ?? null);
}

/**
 * 유효 KRW 환율 (1 KRW = x VND) — MANUAL=수동 키, AUTO=일일 시세(실패 시 캐시→수동 폴백).
 * 미설정이면 null. Decimal 문자열(기존 fx 관례).
 */
export async function getEffectiveFxVndPerKrw(
  db: DbClient,
  now: Date = new Date()
): Promise<string | null> {
  const mode = await readFxMode(db);
  const manual = await getFxVndPerKrw(db);
  if (mode === "MANUAL") return manual;
  // AUTO — getDailyRates가 일일 캐시·외부장애 폴백을 내장. 시세 정상이면 Decimal 문자열, 아니면 수동 폴백.
  const rates = await getDailyRates(db, now);
  const auto = rates ? formatVndPerUnit(rates.vndPerUnit.KRW) : null;
  return auto ?? manual;
}

/**
 * 유효 USD 환율 (1 USD = x VND) — MANUAL=수동 키, AUTO=일일 시세(실패 시 캐시→수동 폴백).
 * 미설정이면 null. Decimal 문자열(기존 fx 관례).
 */
export async function getEffectiveFxVndPerUsd(
  db: DbClient,
  now: Date = new Date()
): Promise<string | null> {
  const mode = await readFxMode(db);
  const manual = await getFxVndPerUsd(db);
  if (mode === "MANUAL") return manual;
  const rates = await getDailyRates(db, now);
  const auto = rates ? formatVndPerUnit(rates.vndPerUnit.USD) : null;
  return auto ?? manual;
}
