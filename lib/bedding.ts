// 침대 종류 메타 (ADR-0011) — schema enum BedType과 1:1 (테오 확정 6종)
// 라벨 i18n 키: bedding.<KING|QUEEN|DOUBLE|SINGLE|TWIN|BUNK> (ko/vi)
// 아이콘은 Material Symbols Outlined 글리프명
import { z } from "zod";

export const BED_TYPES = ["KING", "QUEEN", "DOUBLE", "SINGLE", "TWIN", "BUNK"] as const;
export type BedTypeKey = (typeof BED_TYPES)[number];

export const BED_TYPE_META: Record<BedTypeKey, { icon: string }> = {
  KING: { icon: "king_bed" },
  QUEEN: { icon: "bed" },
  DOUBLE: { icon: "bed" },
  SINGLE: { icon: "single_bed" },
  TWIN: { icon: "single_bed" },
  BUNK: { icon: "bed" }, // Material Symbols에 bunk_bed 글리프 없음 — 리가처 실패로 "bunk_" 원시 텍스트 노출됨
};

/** 사전 검증 — API에서 임의 bedType 주입 차단 (enum 외 값 거부) */
export function isValidBedType(value: string): value is BedTypeKey {
  return (BED_TYPES as readonly string[]).includes(value);
}

// ===================== 잠자리 구성 — 공유 zod·파생 (T-bedroom-composition-sync) =====================
// 3경로(POST /api/villas · PUT /api/villas/[id] · PATCH /api/villas/[id]/sales)가 이 단일 구현을 공유한다.
// 원칙: 방별 구성(VillaBedroom)이 진실의 원천, Villa.bedrooms/bathrooms/maxGuests는 서버 파생 스칼라.

/** roomIndex·방 수 상한 — 3스키마 통일 (기존 sales max 50 → 20) */
export const MAX_ROOM_INDEX = 20;
/** maxGuests 클램프 상한 */
export const MAX_GUESTS_CLAMP = 50;

/** 잠자리 행 zod — 한 침실에 침대 종류가 여러 개면 같은 roomIndex 행이 여러 개(bedType만 다름) */
export const bedroomRowSchema = z.object({
  roomIndex: z.number().int().min(1).max(MAX_ROOM_INDEX),
  roomLabel: z.string().trim().min(1).max(60).nullable().optional(), // 라벨 미입력 시 클라이언트가 null 전송
  bedType: z.enum(BED_TYPES), // enum 화이트리스트 — 임의 bedType 차단
  bedCount: z.number().int().min(1).max(20),
  capacity: z.number().int().min(1).max(MAX_GUESTS_CLAMP).nullable().optional(), // 수용인원 미입력 시 null
  bathroomCount: z.number().int().min(0).max(20).optional(), // 이 침실 전용욕실 개수 (0=없음)
});
export type BedroomRowInput = z.infer<typeof bedroomRowSchema>;

/** 침실 단위 동일값 검증 — 같은 roomIndex 행들의 capacity·bathroomCount는 동일해야 함(방 단위 1값).
 *  각 스키마 superRefine 안에서 호출. pathKey는 issue 경로 필드명(sales="bedrooms", create="bedroomDetails"). */
export function refineBedroomRooms(
  rows: { roomIndex: number; capacity?: number | null; bathroomCount?: number }[],
  ctx: z.RefinementCtx,
  pathKey = "bedrooms"
): void {
  const capByRoom = new Map<number, number | null>();
  rows.forEach((b, index) => {
    const cap = b.capacity ?? null; // null·undefined 동일 취급
    if (capByRoom.has(b.roomIndex)) {
      if (capByRoom.get(b.roomIndex) !== cap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [pathKey, index, "capacity"],
          message: `roomIndex ${b.roomIndex} capacity mismatch`,
        });
      }
    } else {
      capByRoom.set(b.roomIndex, cap);
    }
  });
  const bathByRoom = new Map<number, number>();
  rows.forEach((b, index) => {
    const bath = b.bathroomCount ?? 0;
    if (bathByRoom.has(b.roomIndex)) {
      if (bathByRoom.get(b.roomIndex) !== bath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [pathKey, index, "bathroomCount"],
          message: `roomIndex ${b.roomIndex} bathroomCount mismatch`,
        });
      }
    } else {
      bathByRoom.set(b.roomIndex, bath);
    }
  });
}

/** 파생 규칙 반영 후 저장할 잠자리 행 (roomIndex 1..N 재정규화됨) */
export interface NormalizedBedroomRow {
  roomIndex: number;
  roomLabel: string | null;
  bedType: BedTypeKey;
  bedCount: number;
  capacity: number | null;
  bathroomCount: number;
}

export interface DerivedBedroomScalars {
  /** distinct roomIndex 개수 */
  bedrooms: number;
  /** 방별 전용욕실 합(roomIndex별 1회) + commonBathrooms. 0일 수 있음 — 호출부가 min 1 불변식 가드 */
  bathrooms: number;
  /** 모든 방 capacity 존재 시에만 합·MAX_GUESTS_CLAMP 클램프. 부분입력이면 undefined(호출부가 기존값 보존) */
  maxGuests?: number;
  /** roomIndex를 오름차순 distinct 순서로 1..N 재정규화한 저장용 행 */
  rows: NormalizedBedroomRow[];
}

/**
 * 방별 구성(bedroomRows) + 공용욕실(commonBathrooms) → 파생 스칼라.
 * 설계 §파생규칙 표 그대로. rows가 비어 있으면 호출하지 말 것(호출부가 빈 배열=스칼라 보존으로 분기).
 */
export function deriveBedroomScalars(
  rows: BedroomRowInput[],
  commonBathrooms = 0
): DerivedBedroomScalars {
  // distinct roomIndex 오름차순 → 1..N 재정규화 매핑
  const distinct = [...new Set(rows.map((r) => r.roomIndex))].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  distinct.forEach((ri, i) => remap.set(ri, i + 1));

  const normalizedRows: NormalizedBedroomRow[] = rows.map((r) => ({
    roomIndex: remap.get(r.roomIndex)!,
    roomLabel: r.roomLabel ?? null,
    bedType: r.bedType,
    bedCount: r.bedCount,
    capacity: r.capacity ?? null,
    bathroomCount: r.bathroomCount ?? 0,
  }));

  const bedrooms = distinct.length;

  // bathrooms = 전용욕실 합(roomIndex별 1회 — 동일값 검증됨) + commonBathrooms
  const bathByRoom = new Map<number, number>();
  for (const r of rows) {
    if (!bathByRoom.has(r.roomIndex)) bathByRoom.set(r.roomIndex, r.bathroomCount ?? 0);
  }
  let ensuiteSum = 0;
  for (const v of bathByRoom.values()) ensuiteSum += v;
  const bathrooms = ensuiteSum + Math.max(0, commonBathrooms);

  // maxGuests = 방별 capacity 합, MAX_GUESTS_CLAMP 클램프. 모든 방 capacity 존재 시에만.
  const capByRoom = new Map<number, number | null>();
  for (const r of rows) {
    if (!capByRoom.has(r.roomIndex)) capByRoom.set(r.roomIndex, r.capacity ?? null);
  }
  const caps = [...capByRoom.values()];
  let maxGuests: number | undefined;
  if (caps.length > 0 && caps.every((c) => c != null)) {
    const sum = caps.reduce((s, c) => s + (c as number), 0);
    maxGuests = Math.min(MAX_GUESTS_CLAMP, sum);
  }

  return { bedrooms, bathrooms, maxGuests, rows: normalizedRows };
}
