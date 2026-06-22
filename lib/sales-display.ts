// 판매정보 표시 변환 헬퍼 (ADR-0011, b10-sales / c1-villa-details)
// 저장은 정수(분 단위 시각·미터 거리), 표시·입력은 문자열 — 순수 함수로 분리해 테스트 가능.
// 부동소수점 금지 원칙: 거리 km 환산도 정수 나눗셈 기반 문자열 조립.
import type { BedTypeKey } from "@/lib/bedding";

/** 분 단위(0~1439) → "HH:MM" (예: 840 → "14:00"). 범위 밖은 클램프 */
export function minutesToHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "HH:MM" → 분 단위 Int. 형식 불일치 시 null */
export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** 30분 단위 체크인/아웃 드롭다운 옵션 (start~end 분 단위, 포함). 기본 종일 */
export function buildTimeOptions(startMin = 0, endMin = 1439): string[] {
  const out: string[] = [];
  for (let m = startMin; m <= endMin; m += 30) out.push(minutesToHHMM(m));
  return out;
}

/**
 * 해변 거리(m) 표시 변환.
 * - < 1000m → "350m"
 * - ≥ 1000m → "1.2km" (소수 1자리, 정수 나눗셈으로 부동소수점 회피)
 * null/음수면 null.
 */
export function formatDistanceM(meters: number | null | undefined): string | null {
  if (meters == null || meters < 0) return null;
  const m = Math.trunc(meters);
  if (m < 1000) return `${m}m`;
  const whole = Math.floor(m / 1000);
  const tenth = Math.floor((m % 1000) / 100); // 0~9, 정수 연산
  return tenth === 0 ? `${whole}km` : `${whole}.${tenth}km`;
}

/** 침대 종류별 합계 압축 — { KING: 2, SINGLE: 2 } 형태 (요약 칩용). 입력 순서 보존 */
export function aggregateBeds(
  beds: { bedType: BedTypeKey; bedCount: number }[]
): { bedType: BedTypeKey; count: number }[] {
  const order: BedTypeKey[] = [];
  const totals = new Map<BedTypeKey, number>();
  for (const b of beds) {
    if (!totals.has(b.bedType)) order.push(b.bedType);
    totals.set(b.bedType, (totals.get(b.bedType) ?? 0) + b.bedCount);
  }
  return order.map((bedType) => ({ bedType, count: totals.get(bedType) ?? 0 }));
}

/**
 * 침대 요약 문자열 — 라벨 사전을 주입해 i18n 분리 ("킹 2 / 싱글 2").
 * labelOf(bedType) → 표시명. 빈 입력이면 빈 문자열.
 */
export function buildBedSummary(
  beds: { bedType: BedTypeKey; bedCount: number }[],
  labelOf: (bedType: BedTypeKey) => string,
  separator = " / "
): string {
  return aggregateBeds(beds)
    .map(({ bedType, count }) => `${labelOf(bedType)} ${count}`)
    .join(separator);
}

/** 침실 개수 = 고유 roomIndex 수 */
export function countBedrooms(beds: { roomIndex: number }[]): number {
  return new Set(beds.map((b) => b.roomIndex)).size;
}

/**
 * 침실 수용인원 합계 — roomIndex별 capacity 1값(설계 §1.2: 같은 roomIndex 동일값).
 * capacity 미입력(null) 침실은 0으로 간주. maxGuests 대조 안내용.
 */
export function sumRoomCapacity(
  beds: { roomIndex: number; capacity?: number | null }[]
): number {
  const capByRoom = new Map<number, number>();
  for (const b of beds) {
    if (!capByRoom.has(b.roomIndex)) capByRoom.set(b.roomIndex, b.capacity ?? 0);
  }
  let sum = 0;
  for (const c of capByRoom.values()) sum += c;
  return sum;
}
