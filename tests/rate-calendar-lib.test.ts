import { describe, expect, it } from "vitest";
import type { WorkLayer } from "@/components/rate-calendar/types";
import {
  packWeekBands,
  segmentCount,
  sortLayersForPanel,
  stackForDate,
  toUtc,
  winnerForDate,
} from "@/components/rate-calendar/calendar-lib";

// rate-calendar-ux — 캘린더 순수 로직(lane-packing·승자 표시 정렬·구간 수). 서버 판정(resolveRatePeriod) 재사용.

let seq = 0;
function mk(
  p: Omit<Partial<WorkLayer>, "start" | "end"> & { season: WorkLayer["season"]; start: string | null; end: string | null }
): WorkLayer {
  return {
    id: p.id ?? `L${seq++}`,
    isBase: p.isBase ?? false,
    season: p.season,
    start: p.start ? toUtc(p.start) : null,
    end: p.end ? toUtc(p.end) : null,
    label: p.label ?? null,
    batchId: p.batchId ?? null,
    cost: p.cost ?? 1_000_000n,
    net: p.net ?? 1_200_000n,
    netKrw: p.netKrw ?? 60_000,
    consumer: p.consumer ?? null,
    consumerKrw: p.consumerKrw ?? null,
    pCost: p.pCost ?? null,
    pNet: p.pNet ?? null,
    pNetKrw: p.pNetKrw ?? null,
    pConsumer: p.pConsumer ?? null,
    pConsumerKrw: p.pConsumerKrw ?? null,
    marginType: p.marginType ?? "PERCENT",
    marginValue: p.marginValue ?? "20",
    consumerMarginType: p.consumerMarginType ?? "PERCENT",
    consumerMarginValue: p.consumerMarginValue ?? "0",
  };
}

const base = mk({ id: "base", isBase: true, season: "LOW", start: null, end: null });

describe("winnerForDate — 밤별 승자 (resolveRatePeriod 재사용)", () => {
  const high = mk({ id: "high", season: "HIGH", start: "2027-01-01", end: "2027-01-31" }); // 30박
  const peak = mk({ id: "peak", season: "PEAK", start: "2027-01-10", end: "2027-01-13" }); // 3박 내부

  it("겹친 밤은 짧은 기간(PEAK)이 이긴다", () => {
    expect(winnerForDate(toUtc("2027-01-11"), [high, peak], base)?.id).toBe("peak");
  });
  it("PEAK 밖·HIGH 안은 HIGH", () => {
    expect(winnerForDate(toUtc("2027-01-05"), [high, peak], base)?.id).toBe("high");
  });
  it("어떤 기간도 없으면 base", () => {
    expect(winnerForDate(toUtc("2027-06-01"), [high, peak], base)?.id).toBe("base");
  });
});

describe("stackForDate — 승자→가려짐 순", () => {
  const high = mk({ id: "high", season: "HIGH", start: "2027-01-01", end: "2027-01-31" });
  const peak = mk({ id: "peak", season: "PEAK", start: "2027-01-10", end: "2027-01-13" });

  it("3중 겹침 밤: [PEAK, HIGH, base]", () => {
    const stack = stackForDate(toUtc("2027-01-11"), [high, peak], base);
    expect(stack.map((r) => r.id)).toEqual(["peak", "high", "base"]);
  });
});

describe("packWeekBands — lane-packing", () => {
  const weekStart = toUtc("2027-01-03"); // 일요일

  it("겹치는 두 기간은 다른 lane", () => {
    const a = mk({ id: "a", season: "HIGH", start: "2027-01-03", end: "2027-01-07" });
    const b = mk({ id: "b", season: "PEAK", start: "2027-01-05", end: "2027-01-10" });
    const bands = packWeekBands([a, b], weekStart);
    const la = bands.find((x) => x.layerId === "a")!.lane;
    const lb = bands.find((x) => x.layerId === "b")!.lane;
    expect(la).not.toBe(lb);
  });

  it("겹치지 않는 두 기간은 같은 lane 재사용", () => {
    const a = mk({ id: "a", season: "HIGH", start: "2027-01-03", end: "2027-01-05" });
    const b = mk({ id: "b", season: "PEAK", start: "2027-01-06", end: "2027-01-09" });
    const bands = packWeekBands([a, b], weekStart);
    expect(bands.find((x) => x.layerId === "a")!.lane).toBe(0);
    expect(bands.find((x) => x.layerId === "b")!.lane).toBe(0);
  });

  it("주 경계를 넘는 기간은 contL/contR 플래그", () => {
    const a = mk({ id: "a", season: "HIGH", start: "2026-12-28", end: "2027-01-20" });
    const bands = packWeekBands([a], weekStart);
    const band = bands.find((x) => x.layerId === "a")!;
    expect(band.contL).toBe(true);
    expect(band.contR).toBe(true);
    expect(band.colStart).toBe(0);
    expect(band.colEnd).toBe(7);
  });
});

describe("sortLayersForPanel — 짧은 기간·높은 시즌 우선", () => {
  it("PEAK(3박)이 HIGH(30박)보다 앞", () => {
    const high = mk({ id: "high", season: "HIGH", start: "2027-01-01", end: "2027-01-31" });
    const peak = mk({ id: "peak", season: "PEAK", start: "2027-01-10", end: "2027-01-13" });
    expect(sortLayersForPanel([high, peak]).map((r) => r.id)).toEqual(["peak", "high"]);
  });
});

describe("segmentCount — 일괄 조정 미리보기(서버 구간화와 동형)", () => {
  const high = mk({ id: "high", season: "HIGH", start: "2027-01-01", end: "2027-01-31" });
  const peak = mk({ id: "peak", season: "PEAK", start: "2027-01-10", end: "2027-01-13" });

  it("base+HIGH+PEAK 걸친 range → 3구간", () => {
    const n = segmentCount({ start: toUtc("2026-12-30"), end: toUtc("2027-01-13") }, [high, peak], base);
    expect(n).toBe(3);
  });
  it("승자 1개면 1구간", () => {
    const n = segmentCount({ start: toUtc("2027-06-01"), end: toUtc("2027-06-05") }, [high, peak], base);
    expect(n).toBe(1);
  });
});
