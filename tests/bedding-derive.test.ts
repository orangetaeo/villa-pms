import { describe, expect, it } from "vitest";
import { deriveBedroomScalars, type BedroomRowInput } from "@/lib/bedding";

// T-bedroom-composition-sync — 파생 순수함수 단위 테스트 (계약 §파생규칙 표).
// bedrooms = distinct roomIndex, bathrooms = 전용합+공용, maxGuests = 전원 capacity 존재 시만 합·50 클램프.

const row = (p: Partial<BedroomRowInput> & { roomIndex: number }): BedroomRowInput => ({
  bedType: "KING",
  bedCount: 1,
  ...p,
});

describe("deriveBedroomScalars — bedrooms(distinct roomIndex)", () => {
  it("한 방에 침대 여러 종류(같은 roomIndex 2행)면 bedrooms=1", () => {
    const d = deriveBedroomScalars([
      row({ roomIndex: 1, bedType: "KING" }),
      row({ roomIndex: 1, bedType: "SINGLE" }),
    ]);
    expect(d.bedrooms).toBe(1);
  });

  it("방 3개 → bedrooms=3", () => {
    const d = deriveBedroomScalars([row({ roomIndex: 1 }), row({ roomIndex: 2 }), row({ roomIndex: 3 })]);
    expect(d.bedrooms).toBe(3);
  });
});

describe("deriveBedroomScalars — bathrooms(전용합+공용)", () => {
  it("방별 전용욕실 합 + commonBathrooms", () => {
    // 계약 완료기준 1: 방 3개(각 전용 1) + 공용 1 → bathrooms=4
    const d = deriveBedroomScalars(
      [
        row({ roomIndex: 1, bathroomCount: 1 }),
        row({ roomIndex: 2, bathroomCount: 1 }),
        row({ roomIndex: 3, bathroomCount: 1 }),
      ],
      1
    );
    expect(d.bathrooms).toBe(4);
  });

  it("같은 roomIndex 행은 bathroomCount 1회만 합산(중복 미가산)", () => {
    const d = deriveBedroomScalars(
      [
        row({ roomIndex: 1, bedType: "KING", bathroomCount: 2 }),
        row({ roomIndex: 1, bedType: "SINGLE", bathroomCount: 2 }),
        row({ roomIndex: 2, bathroomCount: 1 }),
      ],
      0
    );
    expect(d.bathrooms).toBe(3); // 2 + 1 + 공용0
  });

  it("전용욕실·공용 모두 0이면 bathrooms=0 (호출부가 보존 분기)", () => {
    const d = deriveBedroomScalars([row({ roomIndex: 1 }), row({ roomIndex: 2 })], 0);
    expect(d.bathrooms).toBe(0);
  });
});

describe("deriveBedroomScalars — maxGuests(조건부·클램프)", () => {
  it("모든 방 capacity 존재 → 합", () => {
    const d = deriveBedroomScalars([
      row({ roomIndex: 1, capacity: 2 }),
      row({ roomIndex: 2, capacity: 4 }),
    ]);
    expect(d.maxGuests).toBe(6);
  });

  it("한 방이라도 capacity 미입력(null) → undefined(보존 신호)", () => {
    const d = deriveBedroomScalars([
      row({ roomIndex: 1, capacity: 2 }),
      row({ roomIndex: 2, capacity: null }),
    ]);
    expect(d.maxGuests).toBeUndefined();
  });

  it("합 > 50 → 50 클램프", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ roomIndex: i + 1, capacity: 5 }));
    const d = deriveBedroomScalars(rows); // 20*5=100
    expect(d.maxGuests).toBe(50);
  });
});

describe("deriveBedroomScalars — roomIndex 1..N 재정규화", () => {
  it("비연속 roomIndex(5,9) → 1,2 재정규화(오름차순)", () => {
    const d = deriveBedroomScalars([
      row({ roomIndex: 9, bedType: "QUEEN" }),
      row({ roomIndex: 5, bedType: "KING" }),
    ]);
    expect(d.bedrooms).toBe(2);
    // 오름차순 distinct: 5→1, 9→2. 입력 순서 보존, roomIndex만 remap.
    const byBed = Object.fromEntries(d.rows.map((r) => [r.bedType, r.roomIndex]));
    expect(byBed.KING).toBe(1); // roomIndex 5 → 1
    expect(byBed.QUEEN).toBe(2); // roomIndex 9 → 2
  });

  it("같은 방 여러 행은 동일 정규화 roomIndex 유지", () => {
    const d = deriveBedroomScalars([
      row({ roomIndex: 3, bedType: "KING" }),
      row({ roomIndex: 3, bedType: "SINGLE" }),
      row({ roomIndex: 7, bedType: "TWIN" }),
    ]);
    expect(d.rows.filter((r) => r.roomIndex === 1)).toHaveLength(2); // roomIndex 3 → 1 (2행)
    expect(d.rows.filter((r) => r.roomIndex === 2)).toHaveLength(1); // roomIndex 7 → 2
  });
});
