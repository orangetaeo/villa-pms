import { describe, expect, it } from "vitest";
import { buildRuns, planCuts, trimOverlaps, TRANSIT_MAX_READ_SEC, type FrameVerdict } from "./cut-planner";

const v = (atSec: number, space: string | null, summary = "무언가", problems: string[] = []): FrameVerdict => ({
  atSec, space, summary, problems,
});

describe("buildRuns — 같은 공간 연속 구간 묶기", () => {
  it("문제 프레임은 구간을 끊는다(변기가 보이는 순간부터 다른 구간)", () => {
    const runs = buildRuns(
      [v(0, "BATHROOM", "세면대"), v(2, "BATHROOM", "세면대"), v(4, "BATHROOM", "변기", ["변기"]), v(6, "BATHROOM", "욕조")],
      2
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].toSec).toBe(2); // 변기 직전까지
    expect(runs[1].fromSec).toBe(6);
  });

  it("공간이 바뀌면 새 구간", () => {
    const runs = buildRuns([v(0, "LIVING"), v(2, "LIVING"), v(4, "KITCHEN")], 2);
    expect(runs.map((r) => r.space)).toEqual(["LIVING", "KITCHEN"]);
  });

  it("가장 긴 요약을 note로 남긴다", () => {
    const runs = buildRuns([v(0, "KITCHEN", "주방"), v(2, "KITCHEN", "원목 식탁과 다이닝 공간")], 2);
    expect(runs[0].note).toBe("원목 식탁과 다이닝 공간");
  });
});

describe("trimOverlaps — 같은 장면이 두 번 나가지 않게", () => {
  it("이동 컷이 다음 컷 시작을 넘게 읽으면 길이를 깎는다", () => {
    const cuts = trimOverlaps([
      { label: "to-bath", src: 138, len: 6, pace: "fast", space: "ETC", note: "이동" },
      { label: "bathroom", src: 139.6, len: 4.2, pace: "slow", space: "BATHROOM", note: "세면대" },
    ]);
    // 138 + min(6, 3.515) = 141.5 > 139.6 → 1.6으로 깎여 2초 미만이라 제외된다
    expect(cuts.map((c) => c.label)).toEqual(["bathroom"]);
  });

  it("겹치지 않으면 그대로 둔다", () => {
    const input = [
      { label: "a", src: 10, len: 3, pace: "fast" as const, space: "ETC", note: "" },
      { label: "b", src: 20, len: 6, pace: "slow" as const, space: "POOL", note: "" },
    ];
    expect(trimOverlaps(input)).toEqual(input);
  });

  it("이동 컷의 읽기 상한은 1.9×1.85초다", () => {
    expect(TRANSIT_MAX_READ_SEC).toBeCloseTo(3.515, 3);
  });
});

describe("planCuts — 판정 배열 → 컷 표", () => {
  const verdicts: FrameVerdict[] = [
    ...[0, 2, 4, 6].map((t) => v(t, "POOL", "프라이빗 수영장")),
    ...[8, 10].map((t) => v(t, "ETC", "실내로 이동")),
    ...[12, 14, 16, 18].map((t) => v(t, "LIVING", "큰 소파와 티브이가 있는 거실")),
    ...[20, 22].map((t) => v(t, "BATHROOM", "변기", ["변기"])), // 통째로 버려져야 한다
    ...[24, 26, 28, 30].map((t) => v(t, "BEDROOM", "킹베드와 통창")),
  ];

  it("문제 구간(변기)은 컷이 되지 않는다", () => {
    const cuts = planCuts(verdicts, { stepSec: 2 });
    expect(cuts.some((c) => c.space === "BATHROOM")).toBe(false);
  });

  it("보여주는 컷은 slow, 이동 컷은 fast·ETC로 나온다", () => {
    const cuts = planCuts(verdicts, { stepSec: 2 });
    expect(cuts.some((c) => c.pace === "slow" && c.space === "POOL")).toBe(true);
    const transit = cuts.find((c) => c.pace === "fast");
    if (transit) expect(transit.space).toBe("ETC");
  });

  it("어떤 컷도 다음 컷 시작을 넘게 읽지 않는다(중복 0)", () => {
    const cuts = planCuts(verdicts, { stepSec: 2 });
    for (let i = 0; i < cuts.length - 1; i++) {
      const maxRead = cuts[i].pace === "fast" ? Math.min(cuts[i].len, TRANSIT_MAX_READ_SEC) : cuts[i].len;
      expect(cuts[i].src + maxRead).toBeLessThanOrEqual(cuts[i + 1].src + 1e-6);
    }
  });

  it("컷 수 상한을 넘지 않는다", () => {
    const many: FrameVerdict[] = [];
    for (let t = 0; t < 600; t += 2) many.push(v(t, t % 40 < 20 ? "BEDROOM" : "LIVING", "방"));
    expect(planCuts(many, { stepSec: 2, maxCuts: 30 }).length).toBeLessThanOrEqual(30);
  });
});
