import { describe, it, expect } from "vitest";
import { wrapHeadlineToFit, estimateTextWidth } from "@/lib/instagram/headline-wrap";

// 실측 버그(2026-07-21): 캐러셀 커버(fontSize 66, 내부폭 912)에서
// "이번 휴가는, 빌라 한 채를 통째로" 의 "로" 한 음절만 다음 줄로 떨어졌다.
const COVER = { fontSize: 66, maxWidth: 912 };

describe("wrapHeadlineToFit", () => {
  it("고아 음절(로)을 만들지 않는다 — 마지막 줄이 1음절이 아니어야", () => {
    const out = wrapHeadlineToFit("이번 휴가는, 빌라 한 채를 통째로", COVER.fontSize, COVER.maxWidth);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1); // 폭 초과라 2줄 이상
    const last = lines[lines.length - 1];
    // 마지막 줄이 "로" 처럼 1음절만 남지 않아야 한다.
    expect(last.replace(/\s/g, "").length).toBeGreaterThan(1);
  });

  it("모든 줄의 추정 폭이 maxWidth 이하 → satori 추가 줄바꿈 없음", () => {
    const out = wrapHeadlineToFit("이번 휴가는, 빌라 한 채를 통째로", COVER.fontSize, COVER.maxWidth);
    for (const line of out.split("\n")) {
      expect(estimateTextWidth(line, COVER.fontSize)).toBeLessThanOrEqual(COVER.maxWidth);
    }
  });

  it("짧은 헤드라인은 한 줄로 유지(불필요한 줄바꿈 없음)", () => {
    const out = wrapHeadlineToFit("푸꾸옥 풀빌라", COVER.fontSize, COVER.maxWidth);
    expect(out).toBe("푸꾸옥 풀빌라");
  });

  it("작가가 넣은 \\n 하드 줄바꿈은 세그먼트 경계로 존중", () => {
    const out = wrapHeadlineToFit("첫 줄\n둘째 줄", COVER.fontSize, COVER.maxWidth);
    expect(out.split("\n")).toEqual(["첫 줄", "둘째 줄"]);
  });

  it("빈 줄(의도된 간격)은 보존", () => {
    const out = wrapHeadlineToFit("위\n\n아래", COVER.fontSize, COVER.maxWidth);
    expect(out.split("\n")).toEqual(["위", "", "아래"]);
  });

  it("모든 템플릿 폭에서 예시 헤드라인이 마지막 줄 1음절 고아를 만들지 않는다", () => {
    const specs = [
      { fontSize: 66, maxWidth: 912 }, // 캐러셀 커버
      { fontSize: 62, maxWidth: 888 }, // 캐러셀 CTA
      { fontSize: 62, maxWidth: 944 }, // 캐러셀 서비스
      { fontSize: 74, maxWidth: 900 }, // 릴스 커버
      { fontSize: 68, maxWidth: 880 }, // 릴스 CTA
    ];
    const samples = [
      "이번 휴가는, 빌라 한 채를 통째로",
      "푸꾸옥 바다 앞, 우리 가족만의 풀빌라",
      "온 가족이 모여 특별한 하루를 보내는 곳",
    ];
    for (const spec of specs) {
      for (const s of samples) {
        const lines = wrapHeadlineToFit(s, spec.fontSize, spec.maxWidth).split("\n");
        const last = lines[lines.length - 1].replace(/\s/g, "");
        expect(last.length).toBeGreaterThan(1);
        for (const line of lines) {
          expect(estimateTextWidth(line, spec.fontSize)).toBeLessThanOrEqual(spec.maxWidth);
        }
      }
    }
  });
});
