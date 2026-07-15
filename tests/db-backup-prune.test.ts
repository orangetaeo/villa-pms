import { describe, it, expect } from "vitest";
import { selectKeysToPrune } from "@/lib/db-snapshot";

// 보존 경계 로직(순수 함수) — 14/12 초과분만 삭제되는지 검증.
describe("selectKeysToPrune", () => {
  const dailyKey = (d: string) => `daily/villa-pms-${d}.json.gz`;

  it("보존 개수 이하면 삭제 없음", () => {
    const keys = ["2026-07-13", "2026-07-14", "2026-07-15"].map(dailyKey);
    expect(selectKeysToPrune(keys, 14)).toEqual([]);
  });

  it("초과분(가장 오래된 것)만 삭제 대상", () => {
    // 16일치 → keep 14 → 가장 오래된 2일 삭제.
    const days = Array.from({ length: 16 }, (_, i) =>
      dailyKey(`2026-07-${String(i + 1).padStart(2, "0")}`)
    );
    const pruned = selectKeysToPrune(days, 14);
    expect(pruned.sort()).toEqual([dailyKey("2026-07-01"), dailyKey("2026-07-02")]);
  });

  it("입력 순서와 무관하게 사전순(=시간순) 최신 keep개 보존", () => {
    const shuffled = [
      dailyKey("2026-07-03"),
      dailyKey("2026-07-01"),
      dailyKey("2026-07-05"),
      dailyKey("2026-07-02"),
      dailyKey("2026-07-04"),
    ];
    // keep 2 → 최신 2개(04,05) 보존, 나머지 3개 삭제.
    const pruned = selectKeysToPrune(shuffled, 2).sort();
    expect(pruned).toEqual([
      dailyKey("2026-07-01"),
      dailyKey("2026-07-02"),
      dailyKey("2026-07-03"),
    ]);
  });

  it("monthly 12개 경계", () => {
    const months = Array.from({ length: 13 }, (_, i) =>
      `monthly/villa-pms-2026-${String(i + 1).padStart(2, "0")}.json.gz`
    );
    const pruned = selectKeysToPrune(months, 12);
    expect(pruned).toEqual(["monthly/villa-pms-2026-01.json.gz"]);
  });

  it("빈 목록·원본 불변", () => {
    const keys = ["daily/a", "daily/b"];
    const copy = [...keys];
    selectKeysToPrune(keys, 1);
    expect(keys).toEqual(copy); // sort/reverse가 원본을 건드리지 않음
    expect(selectKeysToPrune([], 14)).toEqual([]);
  });
});
