import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ko from "../messages/ko.json";
import vi from "../messages/vi.json";
import {
  TOURS,
  tourIdForRoute,
  visibleTourSteps,
  type TourId,
} from "../components/tour/tour-definitions";

// 코치마크 투어 (T-tutorial-onboarding) — 계약 완료기준 9번의 단위 테스트 5종.
// 유지보수 규칙: 투어가 걸린 화면 UI 변경 시 tour-definitions.ts 스텝과 tour 문구(ko/vi)를
// 동시 갱신한다 — 이 테스트가 키 실존·패리티를 강제해 절반은 자동으로 잡는다.

type Msgs = Record<string, unknown>;

function keysDeep(obj: Msgs, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? keysDeep(v as Msgs, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );
}

function lookup(obj: Msgs, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc !== null && typeof acc === "object") return (acc as Msgs)[k];
    return undefined;
  }, obj);
}

describe("tour 네임스페이스 ko/vi 패리티", () => {
  // ① 전 키가 양쪽에 존재하고 비어 있지 않다 (guide-i18n-keys 패턴 — 전역 패리티 자동검사가 없어 NS별 강제)
  it("ko와 vi의 tour 키 집합이 동일하다", () => {
    const koKeys = keysDeep(ko.tour as Msgs).sort();
    const viKeys = keysDeep(vi.tour as Msgs).sort();
    expect(koKeys).toEqual(viKeys);
    expect(koKeys.length).toBeGreaterThan(0);
  });

  it("모든 tour 문구가 비어 있지 않은 문자열이다", () => {
    for (const messages of [ko.tour, vi.tour]) {
      for (const key of keysDeep(messages as Msgs)) {
        const val = lookup(messages as Msgs, key);
        expect(typeof val, `${key} 타입`).toBe("string");
        expect((val as string).trim().length, `${key} 비어있음`).toBeGreaterThan(0);
      }
    }
  });
});

describe("투어 정의 무결성", () => {
  // ⑤ 정의된 모든 스텝 키가 ko·vi tour NS에 title/desc로 실존 (오타·죽은 키 차단)
  it("모든 스텝의 title/desc 키가 ko·vi에 실존한다", () => {
    for (const [tourId, tour] of Object.entries(TOURS)) {
      for (const step of tour.steps) {
        for (const [localeName, messages] of [
          ["ko", ko.tour],
          ["vi", vi.tour],
        ] as const) {
          for (const leaf of ["title", "desc"]) {
            const val = lookup(messages as Msgs, `${step.key}.${leaf}`);
            expect(
              typeof val === "string" && val.trim().length > 0,
              `[${localeName}] tour.${step.key}.${leaf} 누락 (tourId=${tourId})`
            ).toBe(true);
          }
        }
      }
    }
  });

  it("화면당 스텝은 3개 이하다 (UX-VN 확정 — 베트남 사용자 텍스트 최소화)", () => {
    for (const [tourId, tour] of Object.entries(TOURS)) {
      expect(tour.steps.length, `${tourId} 스텝 수`).toBeLessThanOrEqual(3);
      expect(tour.steps.length, `${tourId} 스텝 없음`).toBeGreaterThan(0);
    }
  });

  it("앵커 id는 투어 안에서 중복되지 않는다", () => {
    for (const [tourId, tour] of Object.entries(TOURS)) {
      const anchors = tour.steps.map((s) => s.anchor);
      expect(new Set(anchors).size, `${tourId} 앵커 중복`).toBe(anchors.length);
    }
  });

  it("route 매핑은 pathname 정확일치로 동작한다", () => {
    expect(tourIdForRoute("/my-villas")).toBe("myVillas");
    expect(tourIdForRoute("/calendar")).toBe("calendar");
    expect(tourIdForRoute("/cleaning")).toBe("cleaningList");
    // 상세·무투어 경로는 null — cleaningDetail은 명시 tourId로만 (route:null)
    expect(tourIdForRoute("/cleaning/abc123")).toBeNull();
    expect(tourIdForRoute("/earnings")).toBeNull();
  });
});

describe("visibleTourSteps — 앵커 부재 자동 스킵 (순수 함수)", () => {
  const steps = TOURS.myVillas.steps;

  // ③ 전 부재 → [] (투어 미표시), 일부 부재 → 존재분만 원래 순서로
  it("전 앵커 부재면 빈 배열(투어 미표시)", () => {
    expect(visibleTourSteps(steps, () => false)).toEqual([]);
  });

  it("일부 앵커 부재면 존재 스텝만 순서 보존", () => {
    // 빈 목록 첫 진입 시나리오: villa-status 앵커 없음 → add·tabs만
    const present = new Set(["villa-add", "tab-bar"]);
    const result = visibleTourSteps(steps, (a) => present.has(a));
    expect(result.map((s) => s.anchor)).toEqual(["villa-add", "tab-bar"]);
  });

  it("전 앵커 존재면 전체 유지", () => {
    expect(visibleTourSteps(steps, () => true)).toHaveLength(steps.length);
  });
});

describe("tour-definitions 순수 모듈 (RSC spread 함정 회귀 차단)", () => {
  // ④ 서버 컴포넌트가 TOURS를 spread하므로 client 지시자가 붙으면 런타임 500
  //    [[rsc-client-module-const-spread-bug]] — 소스에 "use client" 미포함을 강제
  it('tour-definitions.ts에 "use client" 지시자가 없다', () => {
    const src = readFileSync("components/tour/tour-definitions.ts", "utf8");
    // 지시자는 줄 시작의 문자열 리터럴 — 주석 속 언급은 무해하므로 줄 앵커로만 검사
    expect(/^\s*["']use client["']/m.test(src)).toBe(false);
  });
});

describe("data-tour 앵커 실존 — 정의된 앵커가 대상 화면 소스에 있다", () => {
  // 앵커 표식이 리팩터링으로 소리 없이 사라지는 것을 커밋 시점에 잡는다.
  // (런타임 자동 스킵은 안전장치일 뿐 — 안내 공백은 여기서 먼저 발견)
  const ANCHOR_SOURCES: Record<TourId, string[]> = {
    myVillas: ["app/(supplier)/my-villas/page.tsx", "components/supplier/tab-bar.tsx"],
    calendar: ["app/(supplier)/calendar/calendar-view.tsx"],
    cleaningList: ["app/(supplier)/cleaning/page.tsx"],
    cleaningDetail: ["app/(supplier)/cleaning/[id]/cleaning-submit.tsx"],
    partnerHome: [
      "app/partner/partner-bookings-list.tsx",
      "app/partner/layout.tsx",
      "components/partner/partner-tab-bar.tsx",
    ],
    partnerReceivables: ["app/partner/receivables/page.tsx"],
    partnerProposals: ["app/partner/proposals/page.tsx"],
    vendorBoard: ["components/vendor/vendor-board.tsx"],
  };

  it.each(Object.keys(TOURS) as TourId[])("[%s] 전 앵커가 소스에 존재", (tourId) => {
    const src = ANCHOR_SOURCES[tourId].map((f) => readFileSync(f, "utf8")).join("\n");
    for (const step of TOURS[tourId].steps) {
      expect(
        src.includes(`"${step.anchor}"`),
        `data-tour="${step.anchor}" 앵커가 ${ANCHOR_SOURCES[tourId].join(", ")}에 없음`
      ).toBe(true);
    }
  });
});
