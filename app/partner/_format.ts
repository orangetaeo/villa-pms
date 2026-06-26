// app/partner/_format.ts — 파트너 포털 표기 헬퍼 (날짜).
// VND 점구분 표기는 lib/format.ts 단일 소스를 재export(공급자·파트너 공통).
export { formatVndDot } from "@/lib/format";

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
