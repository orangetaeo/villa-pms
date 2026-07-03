import type { PhotoSpace } from "@prisma/client";

/**
 * 청소 검수 사진 페어링 (제출 사진 ↔ 기준 사진) — 순수 함수 층.
 *
 * 배경: 청소 제출은 선택 슬롯(발코니·수영장) 스킵을 허용한다(PR #178). 제출 시
 * photoUrls와 병렬로 슬롯 id 배열(photoSlots)을 저장하고, 검수 화면은 인덱스가 아니라
 * **슬롯 id 매칭**으로 기준 사진과 페어링한다 — 스킵된 슬롯이 있어도 정렬이 어긋나지 않는다.
 * photoSlots가 없는 레거시 제출(기존 데이터)은 종전 인덱스 페어링을 유지한다.
 *
 * 슬롯 id 규칙은 buildPhotoSlots(wizard-types.ts)와 동일: exterior·living·kitchen·
 * bedroom-N·bathroom-N·balcony·pool. 기준 사진의 (space, spaceLabel) → 슬롯 id 역매핑은
 * photoSlotId와 동일 규칙(존재 검사만 없음).
 */

/** 슬롯 라벨 근원 — 공간 enum + 침실/욕실 번호. 화면이 i18n 키(spaces.*)로 렌더한다 */
export interface SlotRef {
  space: PhotoSpace;
  index?: number;
}

export interface BaselineInput {
  id: string;
  space: PhotoSpace;
  spaceLabel: string | null;
  url: string;
}

export interface InspectionRow {
  key: string;
  /** null = 라벨 미상(레거시 초과 제출 사진) — 화면은 "추가 사진 n"으로 표기 */
  slot: SlotRef | null;
  baselineUrl: string | null;
  submittedUrl: string | null;
}

const SIMPLE_SLOT_IDS: Partial<Record<PhotoSpace, string>> = {
  EXTERIOR: "exterior",
  LIVING: "living",
  KITCHEN: "kitchen",
  BALCONY: "balcony",
  POOL: "pool",
};

/** 슬롯 id("bedroom-2") → 공간·번호. 규칙 밖 id는 null */
export function parseSlotId(slotId: string): SlotRef | null {
  for (const [space, id] of Object.entries(SIMPLE_SLOT_IDS)) {
    if (slotId === id) return { space: space as PhotoSpace };
  }
  const m = /^(bedroom|bathroom)-(\d+)$/.exec(slotId);
  if (m) {
    return { space: m[1] === "bedroom" ? "BEDROOM" : "BATHROOM", index: Number(m[2]) };
  }
  return null;
}

/** 기준 사진 (space, spaceLabel) → 슬롯 id. ETC·번호 없는 침실/욕실은 null(슬롯 없음) */
export function baselineSlotId(space: PhotoSpace, spaceLabel: string | null): string | null {
  const simple = SIMPLE_SLOT_IDS[space];
  if (simple) return simple;
  if (space === "BEDROOM") return spaceLabel ? `bedroom-${spaceLabel}` : null;
  if (space === "BATHROOM") return spaceLabel ? `bathroom-${spaceLabel}` : null;
  return null;
}

/** 기준 사진 → 라벨 근원. spaceLabel이 숫자면 침실/욕실 번호로 사용 */
function baselineSlotRef(b: BaselineInput): SlotRef {
  const index =
    b.spaceLabel && /^\d+$/.test(b.spaceLabel) ? Number(b.spaceLabel) : undefined;
  return { space: b.space, index };
}

/**
 * 검수 비교 행 구성. slotMode(photoSlots가 photoUrls와 길이 일치)면 슬롯 매칭,
 * 아니면 레거시 인덱스 페어링. 행 순서 = 기준 사진 순서(space·sortOrder) 뒤에
 * 기준 없는 제출 사진(제출 순서).
 */
export function buildInspectionRows(input: {
  photoUrls: string[];
  photoSlots: string[];
  baselines: BaselineInput[];
}): { rows: InspectionRow[]; slotMode: boolean } {
  const { photoUrls, photoSlots, baselines } = input;
  const slotMode = photoUrls.length > 0 && photoSlots.length === photoUrls.length;

  if (!slotMode) {
    // 레거시 제출 — 종전과 동일한 인덱스 페어링 (회귀 방지)
    const count = Math.max(photoUrls.length, baselines.length);
    const rows: InspectionRow[] = [];
    for (let i = 0; i < count; i += 1) {
      const baseline = baselines[i];
      rows.push({
        key: baseline?.id ?? `extra-${i}`,
        slot: baseline ? baselineSlotRef(baseline) : null,
        baselineUrl: baseline?.url ?? null,
        submittedUrl: photoUrls[i] ?? null,
      });
    }
    return { rows, slotMode };
  }

  // 슬롯 매칭 — 같은 슬롯 id의 기준·제출을 나란히
  const firstIdxBySlot = new Map<string, number>();
  photoSlots.forEach((slotId, i) => {
    if (!firstIdxBySlot.has(slotId)) firstIdxBySlot.set(slotId, i);
  });
  const consumedIdx = new Set<number>();
  const pairedSlots = new Set<string>();

  const rows: InspectionRow[] = baselines.map((b) => {
    const slotId = baselineSlotId(b.space, b.spaceLabel);
    let submittedUrl: string | null = null;
    // 같은 슬롯의 기준 사진이 여럿이면 첫 행에만 페어(제출 사진 중복 표시 방지)
    if (slotId && !pairedSlots.has(slotId)) {
      pairedSlots.add(slotId);
      const idx = firstIdxBySlot.get(slotId);
      if (idx !== undefined) {
        submittedUrl = photoUrls[idx];
        consumedIdx.add(idx);
      }
    }
    return { key: b.id, slot: baselineSlotRef(b), baselineUrl: b.url, submittedUrl };
  });

  // 기준 사진이 없는 제출(기준 미등록 공간 등) — 제출 순서대로 단독 행
  photoSlots.forEach((slotId, i) => {
    if (consumedIdx.has(i)) return;
    rows.push({
      key: `submitted-${i}`,
      slot: parseSlotId(slotId),
      baselineUrl: null,
      submittedUrl: photoUrls[i],
    });
  });

  return { rows, slotMode };
}
