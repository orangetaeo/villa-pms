// app/partner/_format.ts — 파트너 포털 표기 헬퍼 (VND 점구분·날짜).
// 금액은 string(BigInt 직렬화값)을 받아 정규식 천단위 점 삽입 — Number() 금지(정밀도 손실).

/** VND 점 구분 표기 (15.000.000₫). string 입력(BigInt 직렬화값). */
export function formatVndDot(value: string | null): string {
  if (value === null) return "—";
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!/^\d+$/.test(digits)) return value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
