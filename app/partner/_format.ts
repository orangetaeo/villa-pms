// app/partner/_format.ts — 파트너 포털 표기 헬퍼 (날짜·금액).
// VND 점구분 표기는 lib/format.ts 단일 소스를 재export(공급자·파트너 공통).
export { formatVndDot } from "@/lib/format";

/**
 * VND 콤마 구분 표기 — 여행사/랜드사(한국 B2B) 미수 현황용. 천 단위 "," (테오 요청).
 * formatVndDot과 동일 입력(bigint|string|null), 구분자만 ",".
 */
export function formatVndComma(value: bigint | string | null): string {
  if (value === null) return "—";
  const raw = typeof value === "string" ? value : value.toString();
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}₫`;
}

/** @db.Date(UTC 자정) → "dd/MM/yyyy" */
export function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** @db.Date(UTC 자정) → "dd/MM" (기간 표기용) */
export function formatDayMonth(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}
