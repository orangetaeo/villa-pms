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
export function todayVnDateString(now?: Date): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 반환. now 주입은 테스트·일관성용 (T2.6 QA I-1)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    now ?? new Date()
  );
}

/** UTC 자정 기준 다음 날 — 단일 날짜 차단 [d, d+1) 의 endDate */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** "YYYY-MM-DD"에 days를 더한 "YYYY-MM-DD" (UTC 자정 기준, 음수 허용).
 *  클라이언트·서버 공용 순수 함수. 잘못된 형식은 입력을 그대로 반환. */
export function addDateOnlyDays(dateStr: string, days: number): string {
  const base = parseUtcDateOnly(dateStr);
  if (!base) return dateStr;
  return toDateOnlyString(addUtcDays(base, days));
}

/** 직접예약 다박: 체크인 "YYYY-MM-DD" + 박수(nights ≥ 1) → 체크아웃 "YYYY-MM-DD" (half-open, exclusive).
 *  nights는 1 미만이면 1로, 정수가 아니면 내림. checkOut = checkIn + nights. */
export function checkOutFromNights(checkIn: string, nights: number): string {
  const n = Math.max(1, Math.floor(nights));
  return addDateOnlyDays(checkIn, n);
}

/** 두 "YYYY-MM-DD" 사이 박수(checkOut exclusive). checkOut ≤ checkIn이면 0. 잘못된 형식은 0. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseUtcDateOnly(checkIn);
  const b = parseUtcDateOnly(checkOut);
  if (!a || !b) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / DAY_MS);
  return diff > 0 ? diff : 0;
}

// ── 빠른 날짜 필터 (QuickDateFilter, T-admin-quick-date-filter) ──
// VN(Asia/Ho_Chi_Minh)은 UTC+7 고정(DST 없음). 주(week)는 월요일 시작.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 빠른 범위 키 — '전체' + 오늘/어제/주/달 프리셋 */
export const QUICK_RANGE_KEYS = [
  "all",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "nextMonth",
] as const;

export type QuickRangeKey = (typeof QUICK_RANGE_KEYS)[number];

export function isQuickRangeKey(key: string | undefined): key is QuickRangeKey {
  return !!key && (QUICK_RANGE_KEYS as readonly string[]).includes(key);
}

/**
 * VN 기준 빠른 범위 → [from, to) 반개구간 (YYYY-MM-DD, 달력일).
 * "all"/무효/미지정 → null (날짜 제한 없음)
 */
export function resolveQuickRange(
  key: string | undefined,
  now?: Date
): { from: string; to: string } | null {
  if (!isQuickRangeKey(key) || key === "all") return null;
  const today = parseUtcDateOnly(todayVnDateString(now))!; // VN 오늘을 UTC 자정으로(달력 산술용)
  const ymd = (d: Date) => toDateOnlyString(d);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const monthStart = (mm: number) => new Date(Date.UTC(y, mm, 1));
  const dow = (today.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const monday = addUtcDays(today, -dow);

  switch (key) {
    case "today":
      return { from: ymd(today), to: ymd(addUtcDays(today, 1)) };
    case "yesterday":
      return { from: ymd(addUtcDays(today, -1)), to: ymd(today) };
    case "thisWeek":
      return { from: ymd(monday), to: ymd(addUtcDays(monday, 7)) };
    case "lastWeek":
      return { from: ymd(addUtcDays(monday, -7)), to: ymd(monday) };
    case "thisMonth":
      return { from: ymd(monthStart(m)), to: ymd(monthStart(m + 1)) };
    case "lastMonth":
      return { from: ymd(monthStart(m - 1)), to: ymd(monthStart(m)) };
    case "nextMonth":
      return { from: ymd(monthStart(m + 1)), to: ymd(monthStart(m + 2)) };
  }
}

/** VN 로컬 자정(YYYY-MM-DD)의 실제 UTC 순간 — timestamp(createdAt 등) 필터용 */
export function vnDayStartUtc(dateStr: string): Date {
  const mid = parseUtcDateOnly(dateStr);
  if (!mid) throw new Error(`vnDayStartUtc: 잘못된 날짜 ${dateStr}`);
  return new Date(mid.getTime() - VN_OFFSET_MS);
}

/**
 * 빠른 범위 → Prisma where 절({ gte, lt }) 변환.
 * kind="date": @db.Date(UTC 자정 저장) 필드용 / kind="timestamp": createdAt 등 UTC 순간 필드용.
 * "all"/무효 → undefined (조건 미적용)
 */
export function quickRangeWhere(
  key: string | undefined,
  kind: "date" | "timestamp",
  now?: Date
): { gte: Date; lt: Date } | undefined {
  const r = resolveQuickRange(key, now);
  if (!r) return undefined;
  const conv = kind === "date" ? (s: string) => parseUtcDateOnly(s)! : vnDayStartUtc;
  return { gte: conv(r.from), lt: conv(r.to) };
}
