// 금액·날짜 표기 유틸 (T1.2 — DESIGN.md 표기 규칙)
// ADMIN 화면: VND = 쉼표 + ₫ 접미 (1,200,000₫), KRW = ₩ 접두 + 쉼표 (₩450,000)
// BigInt → Number() 캐스팅 금지 — 문자열 정규식 천단위 처리 (정밀도 손실 방지)

/** 숫자 문자열/BigInt에 천단위 쉼표 삽입 (부동소수점 미사용) */
export function formatThousands(value: bigint | string | number): string {
  const raw = typeof value === "string" ? value : value.toString();
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

/** ADMIN VND 표기 — 쉼표 + ₫ (예: 1,200,000₫) */
export function formatVnd(value: bigint | string): string {
  return `${formatThousands(value)}₫`;
}

/** 공급자·파트너 화면 VND 표기 — 점 구분 + ₫ (예: 15.000.000₫, DESIGN.md — ADMIN 쉼표와 다름).
 *  BigInt 또는 직렬화 string 입력, null은 "—". 숫자 아닌 string은 원문 반환.
 *  BigInt → Number() 캐스팅 금지 — 문자열 정규식 천단위 처리(정밀도 손실 방지). */
export function formatVndDot(value: bigint | string | null): string {
  if (value === null) return "—";
  const raw = typeof value === "string" ? value : value.toString();
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}₫`;
}

/** ADMIN KRW 표기 — ₩ + 쉼표 (예: ₩450,000, b10 요율 테이블 기준) */
export function formatKrw(value: number): string {
  return `₩${formatThousands(Math.trunc(value))}`;
}

/** 타임스탬프 → YYYY.MM.DD HH:mm (Asia/Ho_Chi_Minh 표시 규칙)
 *  hourCycle "h23" 명시: hour12:false만 두면 자정(00시)을 Node ICU는 "24", 브라우저 ICU는
 *  "00"로 렌더해 SSR↔클라 텍스트 불일치(React #418 하이드레이션 오류)가 발생 → "h23"로 양쪽 "00" 고정 */
export function formatDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
