import { describe, expect, it } from "vitest";
import { MAX_CONCURRENT_RENDERS, isRenderBusy, winsRenderRace } from "./render-lock";

describe("isRenderBusy — 전역 렌더 락", () => {
  it("살아있는 렌더가 없으면 진행한다", () => {
    expect(isRenderBusy(0)).toBe(false);
  });

  it("살아있는 렌더가 1건이면 이번 주기는 건너뛴다 (M-7의 핵심)", () => {
    // 주기 5분 < 렌더 8분이라 이전 주기의 렌더가 아직 도는 상황.
    expect(isRenderBusy(1)).toBe(true);
  });

  it("이미 여러 건이 겹쳐버린 상태에서도 새로 집지 않는다", () => {
    expect(isRenderBusy(3)).toBe(true);
  });

  it("동시 렌더 상한은 1이다 — 컨테이너 1대에서 ffmpeg 겹침 금지", () => {
    expect(MAX_CONCURRENT_RENDERS).toBe(1);
  });
});

describe("winsRenderRace — claim 후 동시 기동 경합 tie-break", () => {
  it("경쟁자가 없으면 진행한다", () => {
    expect(winsRenderRace("b", [])).toBe(true);
  });

  it("내 id가 최소면 진행한다", () => {
    expect(winsRenderRace("a", ["b", "c"])).toBe(true);
  });

  it("나보다 작은 id가 있으면 양보한다", () => {
    expect(winsRenderRace("b", ["a"])).toBe(false);
    expect(winsRenderRace("c", ["z", "a"])).toBe(false);
  });

  it("두 주기가 서로를 봐도 정확히 한쪽만 살아남는다 (livelock 없음)", () => {
    // A는 job1을, B는 job2를 claim한 뒤 서로를 발견한 상황.
    const survivors = [
      winsRenderRace("job1", ["job2"]),
      winsRenderRace("job2", ["job1"]),
    ].filter(Boolean);
    expect(survivors).toHaveLength(1);
  });

  it("3중 경합에서도 승자는 정확히 1명이다", () => {
    const ids = ["job-c", "job-a", "job-b"];
    const survivors = ids.filter((id) => winsRenderRace(id, ids.filter((o) => o !== id)));
    expect(survivors).toEqual(["job-a"]);
  });

  it("cuid 형태의 실제 id에서도 결정적이다", () => {
    const a = "cm3x0000abcd";
    const b = "cm3x0001wxyz";
    expect(winsRenderRace(a, [b])).toBe(true);
    expect(winsRenderRace(b, [a])).toBe(false);
  });
});
