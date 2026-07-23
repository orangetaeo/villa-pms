// 영상 길이 표시 포맷 — 목록(쇼츠·릴스)에 재생시간을 노출하기 위한 공용 규칙.
import { describe, it, expect } from "vitest";
import { formatDurationSec, igMediaDurationSec } from "@/lib/marketing/duration";

describe("formatDurationSec", () => {
  it("1분 미만은 0:ss", () => {
    expect(formatDurationSec(42)).toBe("0:42");
    expect(formatDurationSec(7)).toBe("0:07");
  });

  it("분 단위는 m:ss", () => {
    expect(formatDurationSec(83)).toBe("1:23");
    expect(formatDurationSec(600)).toBe("10:00");
  });

  it("소수점 길이는 반올림한다 (ffprobe 값이 정수가 아님)", () => {
    expect(formatDurationSec(41.6)).toBe("0:42");
  });

  it("1시간 이상은 h:mm:ss", () => {
    expect(formatDurationSec(3725)).toBe("1:02:05");
  });

  it("0초도 표시한다(값 없음과 구분)", () => {
    expect(formatDurationSec(0)).toBe("0:00");
  });

  it("값이 없거나 비정상이면 null — 뱃지를 그리지 않는다", () => {
    expect(formatDurationSec(null)).toBeNull();
    expect(formatDurationSec(undefined)).toBeNull();
    expect(formatDurationSec(-3)).toBeNull();
    expect(formatDurationSec(NaN)).toBeNull();
  });
});

describe("igMediaDurationSec", () => {
  it("릴스(videoUrl+durationSec)면 길이를 돌려준다", () => {
    expect(igMediaDurationSec([{ videoUrl: "https://r2/x.mp4", durationSec: 38 }])).toBe(38);
  });

  it("이미지 캐러셀이면 null", () => {
    expect(igMediaDurationSec([{}, {}])).toBeNull();
  });

  it("영상이지만 길이가 없으면 null (구 데이터 — 조용히 0으로 만들지 않는다)", () => {
    expect(igMediaDurationSec([{ videoUrl: "https://r2/x.mp4" }])).toBeNull();
  });

  it("빈 배열은 null", () => {
    expect(igMediaDurationSec([])).toBeNull();
  });
});
