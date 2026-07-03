import { describe, expect, it } from "vitest";
import {
  baselineSlotId,
  buildInspectionRows,
  parseSlotId,
  type BaselineInput,
} from "./cleaning-photo-pairs";

// 수영장 빌라 침실2·욕실1 기준 사진 풀세트 (space asc·sortOrder asc 순서)
const FULL_BASELINES: BaselineInput[] = [
  { id: "b-ext", space: "EXTERIOR", spaceLabel: null, url: "base/ext" },
  { id: "b-liv", space: "LIVING", spaceLabel: null, url: "base/liv" },
  { id: "b-kit", space: "KITCHEN", spaceLabel: null, url: "base/kit" },
  { id: "b-bd1", space: "BEDROOM", spaceLabel: "1", url: "base/bd1" },
  { id: "b-bd2", space: "BEDROOM", spaceLabel: "2", url: "base/bd2" },
  { id: "b-ba1", space: "BATHROOM", spaceLabel: "1", url: "base/ba1" },
  { id: "b-bal", space: "BALCONY", spaceLabel: null, url: "base/bal" },
  { id: "b-pool", space: "POOL", spaceLabel: null, url: "base/pool" },
];

describe("parseSlotId / baselineSlotId", () => {
  it("단순 슬롯·번호 슬롯을 왕복 매핑한다", () => {
    expect(parseSlotId("exterior")).toEqual({ space: "EXTERIOR" });
    expect(parseSlotId("pool")).toEqual({ space: "POOL" });
    expect(parseSlotId("bedroom-2")).toEqual({ space: "BEDROOM", index: 2 });
    expect(parseSlotId("bathroom-10")).toEqual({ space: "BATHROOM", index: 10 });
    expect(parseSlotId("unknown")).toBeNull();
    expect(baselineSlotId("EXTERIOR", null)).toBe("exterior");
    expect(baselineSlotId("BEDROOM", "2")).toBe("bedroom-2");
    expect(baselineSlotId("BEDROOM", null)).toBeNull();
    expect(baselineSlotId("ETC", "x")).toBeNull();
  });
});

describe("buildInspectionRows — 슬롯 매칭 모드", () => {
  it("★핵심: 수영장 빌라에서 발코니 스킵 제출 → 수영장 사진이 수영장 기준과 페어된다", () => {
    // 발코니만 스킵 (7장 제출: ext liv kit bd1 bd2 ba1 pool)
    const photoSlots = [
      "exterior",
      "living",
      "kitchen",
      "bedroom-1",
      "bedroom-2",
      "bathroom-1",
      "pool",
    ];
    const photoUrls = photoSlots.map((s) => `sub/${s}`);
    const { rows, slotMode } = buildInspectionRows({
      photoUrls,
      photoSlots,
      baselines: FULL_BASELINES,
    });
    expect(slotMode).toBe(true);
    const pool = rows.find((r) => r.key === "b-pool");
    expect(pool?.submittedUrl).toBe("sub/pool"); // 인덱스 페어링이었으면 발코니 기준에 붙었음
    const balcony = rows.find((r) => r.key === "b-bal");
    expect(balcony?.submittedUrl).toBeNull(); // 스킵 슬롯 = 제출 없음 표시
    expect(rows).toHaveLength(FULL_BASELINES.length); // 초과 행 없음
    // 침실 라벨 근원 — 번호 포함
    const bd2 = rows.find((r) => r.key === "b-bd2");
    expect(bd2?.slot).toEqual({ space: "BEDROOM", index: 2 });
    expect(bd2?.submittedUrl).toBe("sub/bedroom-2");
  });

  it("기준 사진이 없는 슬롯의 제출은 뒤에 단독 행으로 붙는다", () => {
    const baselines = FULL_BASELINES.slice(0, 3); // 외관·거실·주방만 기준 있음
    const photoSlots = ["exterior", "bedroom-1"];
    const photoUrls = ["sub/ext", "sub/bd1"];
    const { rows } = buildInspectionRows({ photoUrls, photoSlots, baselines });
    expect(rows).toHaveLength(4); // 기준 3 + 기준 없는 제출 1
    expect(rows[0].submittedUrl).toBe("sub/ext");
    expect(rows[1].submittedUrl).toBeNull();
    const extra = rows[3];
    expect(extra.baselineUrl).toBeNull();
    expect(extra.submittedUrl).toBe("sub/bd1");
    expect(extra.slot).toEqual({ space: "BEDROOM", index: 1 });
  });

  it("같은 슬롯 기준 사진이 여러 장이어도 제출 사진은 첫 행에만 페어된다", () => {
    const baselines: BaselineInput[] = [
      { id: "b-e1", space: "EXTERIOR", spaceLabel: null, url: "base/e1" },
      { id: "b-e2", space: "EXTERIOR", spaceLabel: null, url: "base/e2" },
    ];
    const { rows } = buildInspectionRows({
      photoUrls: ["sub/ext"],
      photoSlots: ["exterior"],
      baselines,
    });
    expect(rows[0].submittedUrl).toBe("sub/ext");
    expect(rows[1].submittedUrl).toBeNull(); // 중복 표시 금지
  });

  it("규칙 밖 슬롯 id 제출도 유실 없이 라벨 미상 행으로 남는다", () => {
    const { rows } = buildInspectionRows({
      photoUrls: ["sub/x"],
      photoSlots: ["mystery"],
      baselines: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].slot).toBeNull();
    expect(rows[0].submittedUrl).toBe("sub/x");
  });
});

describe("buildInspectionRows — 레거시(인덱스) 모드", () => {
  it("photoSlots가 없으면 종전 인덱스 페어링을 유지한다", () => {
    const photoUrls = FULL_BASELINES.map((b) => `sub/${b.id}`);
    const { rows, slotMode } = buildInspectionRows({
      photoUrls,
      photoSlots: [],
      baselines: FULL_BASELINES,
    });
    expect(slotMode).toBe(false);
    rows.forEach((row, i) => {
      expect(row.baselineUrl).toBe(FULL_BASELINES[i].url);
      expect(row.submittedUrl).toBe(photoUrls[i]);
    });
  });

  it("레거시: 제출이 기준보다 많으면 초과분은 라벨 미상 행", () => {
    const { rows } = buildInspectionRows({
      photoUrls: ["a", "b", "c"],
      photoSlots: [],
      baselines: FULL_BASELINES.slice(0, 2),
    });
    expect(rows).toHaveLength(3);
    expect(rows[2].slot).toBeNull();
    expect(rows[2].baselineUrl).toBeNull();
    expect(rows[2].submittedUrl).toBe("c");
  });

  it("레거시: 길이 불일치 photoSlots(방어)도 인덱스 모드로 처리한다", () => {
    const { slotMode } = buildInspectionRows({
      photoUrls: ["a", "b"],
      photoSlots: ["exterior"],
      baselines: [],
    });
    expect(slotMode).toBe(false);
  });
});
