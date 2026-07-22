import { describe, expect, it } from "vitest";
import {
  preflightClipFile,
  remainingClipSlots,
  toClipErrorKey,
  type ClipUploadPolicy,
} from "./villa-clip-upload";

const POLICY: ClipUploadPolicy = {
  maxBytes: 80 * 1024 * 1024,
  maxDurationSec: 30,
  maxPerVilla: 16,
};

const OK = { type: "video/mp4", size: 10 * 1024 * 1024, meta: { durationSec: 12, width: 1080, height: 1920 }, currentCount: 0 };

describe("toClipErrorKey — 원시 코드 노출 방지", () => {
  it("사전에 있는 코드는 그대로 쓴다", () => {
    expect(toClipErrorKey("TOO_LARGE")).toBe("TOO_LARGE");
    expect(toClipErrorKey("QUOTA_EXCEEDED")).toBe("QUOTA_EXCEEDED");
  });

  it("서버 내부 코드는 generic으로 수렴한다 (화면에 키가 새면 안 된다)", () => {
    expect(toClipErrorKey("UPLOAD_NOT_FOUND_OR_INVALID")).toBe("generic");
    expect(toClipErrorKey("R2_NOT_CONFIGURED")).toBe("generic");
    expect(toClipErrorKey("ALREADY_COMMITTED")).toBe("generic");
  });

  it("빈 값도 generic", () => {
    expect(toClipErrorKey(undefined)).toBe("generic");
    expect(toClipErrorKey(null)).toBe("generic");
    expect(toClipErrorKey("")).toBe("generic");
  });
});

describe("preflightClipFile", () => {
  it("정상 파일은 통과", () => {
    expect(preflightClipFile(OK, POLICY)).toBeNull();
  });

  it("mp4·mov만 허용", () => {
    expect(preflightClipFile({ ...OK, type: "video/webm" }, POLICY)).toBe("DISALLOWED_TYPE");
    expect(preflightClipFile({ ...OK, type: "video/quicktime" }, POLICY)).toBeNull();
  });

  it("정책 초과 용량은 올리기 전에 거절", () => {
    expect(preflightClipFile({ ...OK, size: 81 * 1024 * 1024 }, POLICY)).toBe("TOO_LARGE");
  });

  it("길이 초과는 거절하되 0.5초 여유를 둔다 (브라우저·ffprobe 값 차이 흡수)", () => {
    expect(preflightClipFile({ ...OK, meta: { durationSec: 30.4, width: 1080, height: 1920 } }, POLICY)).toBeNull();
    expect(preflightClipFile({ ...OK, meta: { durationSec: 31, width: 1080, height: 1920 } }, POLICY)).toBe("TOO_LONG");
  });

  it("★메타를 못 읽으면 길이로 거절하지 않는다 — 서버 판정에 위임(과잉 거절 방지)", () => {
    // iOS .mov HEVC 등 브라우저가 duration을 못 읽는 경우. 여기서 막으면 정상 파일도 못 올린다.
    expect(preflightClipFile({ ...OK, meta: null, size: 1024 }, POLICY)).toBeNull();
    expect(preflightClipFile({ ...OK, meta: undefined, size: 1024 }, POLICY)).toBeNull();
  });

  it("쿼터가 찼으면 타입·용량보다 먼저 거절한다", () => {
    expect(preflightClipFile({ ...OK, currentCount: 16 }, POLICY)).toBe("QUOTA_EXCEEDED");
    // 쿼터가 찼으면 파일이 어떻든 올릴 수 없으므로 사유는 쿼터가 맞다.
    expect(preflightClipFile({ ...OK, currentCount: 20, type: "video/webm" }, POLICY)).toBe("QUOTA_EXCEEDED");
  });

  it("AppSetting으로 정책이 바뀌면 판정도 따라간다 (하드코딩 아님)", () => {
    const tight: ClipUploadPolicy = { maxBytes: 1024, maxDurationSec: 5, maxPerVilla: 1 };
    expect(preflightClipFile({ ...OK, size: 2048 }, tight)).toBe("TOO_LARGE");
    expect(preflightClipFile({ ...OK, size: 100, meta: { durationSec: 12, width: 1080, height: 1920 } }, tight)).toBe("TOO_LONG");
  });
});

describe("remainingClipSlots", () => {
  it("남은 개수를 돌려주고 음수가 되지 않는다", () => {
    expect(remainingClipSlots(POLICY, 0)).toBe(16);
    expect(remainingClipSlots(POLICY, 15)).toBe(1);
    expect(remainingClipSlots(POLICY, 16)).toBe(0);
    expect(remainingClipSlots(POLICY, 99)).toBe(0);
  });
});
