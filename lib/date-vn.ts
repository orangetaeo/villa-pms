// 날짜 유틸 — @db.Date(UTC 자정 저장) ↔ Asia/Ho_Chi_Minh 표시 규칙 (T1.4)
// 교훈(availability-pattern): API 입력 문자열은 반드시 UTC 자정으로 정규화 후 판정에 투입

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" → UTC 자정 Date. 형식·실존하지 않는 날짜(2026-02-31 등)는 null */
export function parseUtcDateOnly(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // JS Date 롤오버 방지 — 입력과 역직렬화 결과가 일치해야 실존 날짜
  if (d.toISOString().slice(0, 10) !== dateStr) return null;
  return d;
}

/** UTC 자정 Date → "YYYY-MM-DD" */
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 베트남(Asia/Ho_Chi_Minh) 기준 오늘 날짜 "YYYY-MM-DD" */
export function todayVnDateString(): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 반환
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date()
  );
}

/** UTC 자정 기준 다음 날 — 단일 날짜 차단 [d, d+1) 의 endDate */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
