import { describe, expect, it } from "vitest";
import {
  MAX_SLOWDOWN,
  MAX_SPEEDUP,
  PACE_SPEED,
  pacingFilterChain,
  planClipTiming,
  resolveClipPace,
} from "./pacing";

describe("resolveClipPace — 공간·메모 → 컷 성격", () => {
  it("ETC(공간 미특정)는 이동 컷으로 본다 — 대개 복도·계단이다", () => {
    const p = resolveClipPace("ETC", null);
    expect(p.kind).toBe("transit");
    expect(p.sourceSpeed).toBeGreaterThan(1);
    expect(p.ramp).toBe(true);
  });

  it("외관·수영장은 hero — 첫인상 컷이라 살짝 느리게 흘린다", () => {
    expect(resolveClipPace("EXTERIOR").kind).toBe("hero");
    expect(resolveClipPace("POOL").kind).toBe("hero");
    expect(PACE_SPEED.hero).toBeLessThan(1);
  });

  it("침실·거실·주방은 feature(거의 정속)", () => {
    for (const s of ["BEDROOM", "LIVING", "KITCHEN", "BATHROOM", "BALCONY"]) {
      expect(resolveClipPace(s).kind).toBe("feature");
    }
  });

  it("공간 미지정(null)은 feature로 안전하게 둔다 — 모르면 손대지 않는다", () => {
    expect(resolveClipPace(null).kind).toBe("feature");
  });

  it("메모의 이동 단어가 공간 코드를 이긴다 (한국어·베트남어·영어)", () => {
    expect(resolveClipPace("BEDROOM", "침실로 가는 복도").kind).toBe("transit");
    expect(resolveClipPace("BEDROOM", "hành lang lên phòng").kind).toBe("transit");
    expect(resolveClipPace("LIVING", "walking through the hallway").kind).toBe("transit");
  });

  it("머무는 단어가 이동 단어를 이긴다 — '계단 위 수영장'은 머물러야 한다", () => {
    expect(resolveClipPace("ETC", "계단 위 수영장 전망").kind).toBe("hero");
  });
});

describe("planClipTiming — 화면 길이는 고정, 원본 소비량만 바꾼다", () => {
  const transit = resolveClipPace("ETC");
  const feature = resolveClipPace("BEDROOM");

  it("이동 컷은 같은 화면 시간에 원본을 더 많이 소비한다(빨리 감기)", () => {
    const plan = planClipTiming(4, 20, transit);
    expect(plan.readSec).toBeCloseTo(4 * PACE_SPEED.transit, 3);
    expect(plan.screenSec).toBeCloseTo(4, 3); // ★ 화면 길이는 그대로
    expect(plan.factor).toBeLessThan(1);
    expect(plan.applied).toBe(true);
  });

  it("hero 컷은 원본을 덜 소비한다(슬로우) — 화면 길이는 동일", () => {
    const plan = planClipTiming(4, 20, resolveClipPace("POOL"));
    expect(plan.readSec).toBeLessThan(4);
    expect(plan.screenSec).toBeCloseTo(4, 3);
    expect(plan.factor).toBeGreaterThan(1);
  });

  it("원본이 모자라면 있는 만큼 읽고 감속으로 채운다(기존 동작 유지)", () => {
    const plan = planClipTiming(6, 4, feature);
    expect(plan.readSec).toBeCloseTo(4, 3);
    expect(plan.factor).toBeCloseTo(1.5, 3);
    expect(plan.screenSec).toBeCloseTo(6, 3);
  });

  it("감속 상한(1.6배)을 넘기지 않는다 — 넘으면 화면이 더 짧게 나온다", () => {
    const plan = planClipTiming(10, 2, feature);
    expect(plan.factor).toBeCloseTo(MAX_SLOWDOWN, 5);
    expect(plan.screenSec).toBeCloseTo(2 * MAX_SLOWDOWN, 3);
    expect(plan.screenSec).toBeLessThan(10); // ★ 이 부족분을 edit.ts가 실측으로 재동기화한다
  });

  it("빨리 감기 상한을 넘기지 않는다", () => {
    const crazy = { kind: "transit" as const, sourceSpeed: 10, ramp: false };
    const plan = planClipTiming(4, 100, crazy);
    expect(plan.factor).toBeGreaterThanOrEqual(1 / MAX_SPEEDUP - 1e-9);
  });

  it("원본 길이를 모르면(ffprobe 실패) 절대 손대지 않는다", () => {
    const plan = planClipTiming(4, null, transit);
    expect(plan.factor).toBe(1);
    expect(plan.ramp).toBeNull();
    expect(plan.applied).toBe(false);
    expect(plan.readSec).toBe(4);
  });
});

describe("램프(감속 진입) 수식 — f(S)가 정확히 화면 길이가 되어야 한다", () => {
  it("적분 결과가 목표 화면 길이와 일치한다", () => {
    const plan = planClipTiming(4, 30, resolveClipPace("ETC"));
    expect(plan.ramp).not.toBeNull();
    const { a, b } = plan.ramp!;
    const S = plan.readSec;
    // f(T) = (S/(b−a))·ln(1 + ((b−a)/(a·S))·T)
    const f = (T: number) => (S / (b - a)) * Math.log(1 + ((b - a) / (a * S)) * T);
    expect(f(S)).toBeCloseTo(plan.screenSec, 6);
    expect(f(0)).toBeCloseTo(0, 9);
  });

  it("시작이 끝보다 빠르다 — 빠르게 들어가 도착하며 감속", () => {
    const plan = planClipTiming(4, 30, resolveClipPace("ETC"));
    expect(plan.ramp!.a).toBeGreaterThan(plan.ramp!.b);
  });

  it("단조 증가한다 — 뒤로 감기는 프레임이 없어야 한다", () => {
    const plan = planClipTiming(5, 40, resolveClipPace("ETC"));
    const { a, b } = plan.ramp!;
    const S = plan.readSec;
    const f = (T: number) => (S / (b - a)) * Math.log(1 + ((b - a) / (a * S)) * T);
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const v = f((S * i) / 50);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("감속 컷에는 램프를 걸지 않는다(정지처럼 보인다)", () => {
    expect(planClipTiming(4, 2, resolveClipPace("ETC")).ramp).toBeNull();
  });
});

describe("pacingFilterChain — filter_complex 안전성", () => {
  it("표현식에 콤마를 쓰지 않는다 (filter_complex 파싱 사고 방지)", () => {
    const ramp = pacingFilterChain(planClipTiming(4, 30, resolveClipPace("ETC")));
    // 콤마는 **필터 구분자 1개**(setpts,setpts)뿐이어야 한다 — 표현식 안에 들어가면 파싱이 깨진다
    expect(ramp.split(",").length).toBe(2);
    expect(ramp).toContain("log(");
    expect(ramp.startsWith("setpts=PTS-STARTPTS,")).toBe(true);
  });

  it("배속이 사실상 1이면 필터를 아예 붙이지 않는다(불필요한 재타이밍 방지)", () => {
    expect(pacingFilterChain({ readSec: 4, factor: 1, ramp: null, screenSec: 4, applied: false })).toBe("");
  });

  it("정속 배속은 setpts 곱 하나로 표현된다", () => {
    const chain = pacingFilterChain({ readSec: 8, factor: 0.5, ramp: null, screenSec: 4, applied: true });
    expect(chain).toBe("setpts=0.500000*(PTS-STARTPTS)");
  });
});
