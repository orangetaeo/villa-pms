import { describe, expect, it } from "vitest";
import {
  VILLA_CLIP_POLICY_DEFAULTS,
  VILLA_CLIP_SETTING_KEYS,
  checkClipAgainstPolicy,
  loadVillaClipPolicy,
  rejectStatus,
  type ClipProbe,
  type VillaClipPolicy,
} from "./villa-clip";

const POLICY: VillaClipPolicy = { ...VILLA_CLIP_POLICY_DEFAULTS };

/** 정책을 넉넉히 통과하는 기준 클립 — 세로 1080×1920, 12초, 20MB */
const OK_PROBE: ClipProbe = {
  sizeBytes: 20 * 1024 * 1024,
  durationSec: 12,
  width: 1080,
  height: 1920,
};

/** AppSetting 인메모리 fake — findMany(where.key.in)만 구현 */
function fakeDb(rows: Record<string, string>) {
  return {
    appSetting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        Object.entries(rows)
          .filter(([k]) => where.key.in.includes(k))
          .map(([key, value]) => ({ key, value })),
    },
  };
}

describe("checkClipAgainstPolicy", () => {
  it("정상 클립은 통과", () => {
    expect(checkClipAgainstPolicy(OK_PROBE, POLICY, 0)).toEqual({ ok: true });
  });

  it("쿼터가 찼으면 다른 위반보다 먼저 QUOTA_EXCEEDED — 헛된 업로드 안내를 정확히 하기 위함", () => {
    const oversized = { ...OK_PROBE, sizeBytes: POLICY.maxBytes + 1 };
    expect(checkClipAgainstPolicy(oversized, POLICY, POLICY.maxPerVilla)).toEqual({
      ok: false,
      reason: "QUOTA_EXCEEDED",
    });
  });

  it("상한 경계는 통과, 1바이트/0.1초 초과부터 거부", () => {
    expect(checkClipAgainstPolicy({ ...OK_PROBE, sizeBytes: POLICY.maxBytes }, POLICY, 0)).toEqual({
      ok: true,
    });
    expect(
      checkClipAgainstPolicy({ ...OK_PROBE, sizeBytes: POLICY.maxBytes + 1 }, POLICY, 0)
    ).toEqual({ ok: false, reason: "TOO_LARGE" });

    expect(
      checkClipAgainstPolicy({ ...OK_PROBE, durationSec: POLICY.maxDurationSec }, POLICY, 0)
    ).toEqual({ ok: true });
    expect(
      checkClipAgainstPolicy({ ...OK_PROBE, durationSec: POLICY.maxDurationSec + 0.1 }, POLICY, 0)
    ).toEqual({ ok: false, reason: "TOO_LONG" });
  });

  it("너무 짧은 클립(실수 촬영)은 TOO_SHORT", () => {
    expect(checkClipAgainstPolicy({ ...OK_PROBE, durationSec: 0.8 }, POLICY, 0)).toEqual({
      ok: false,
      reason: "TOO_SHORT",
    });
  });

  it("짧은 변 기준으로 저해상도 판정 — 가로 영상도 세로 영상과 동일 기준", () => {
    // 세로 480×854: 짧은 변 480 < 540 → 거부
    expect(checkClipAgainstPolicy({ ...OK_PROBE, width: 480, height: 854 }, POLICY, 0)).toEqual({
      ok: false,
      reason: "RESOLUTION_TOO_LOW",
    });
    // 가로 1920×1080: 짧은 변 1080 ≥ 540 → 통과(9:16 정규화는 편집 단계에서)
    expect(checkClipAgainstPolicy({ ...OK_PROBE, width: 1920, height: 1080 }, POLICY, 0)).toEqual({
      ok: true,
    });
  });

  it("빌라당 개수 상한 직전까지는 허용", () => {
    expect(checkClipAgainstPolicy(OK_PROBE, POLICY, POLICY.maxPerVilla - 1)).toEqual({ ok: true });
    expect(checkClipAgainstPolicy(OK_PROBE, POLICY, POLICY.maxPerVilla)).toEqual({
      ok: false,
      reason: "QUOTA_EXCEEDED",
    });
  });
});

describe("rejectStatus", () => {
  it("쿼터는 409, 소재 문제는 400", () => {
    expect(rejectStatus("QUOTA_EXCEEDED")).toBe(409);
    expect(rejectStatus("TOO_LARGE")).toBe(400);
    expect(rejectStatus("TOO_LONG")).toBe(400);
    expect(rejectStatus("RESOLUTION_TOO_LOW")).toBe(400);
  });
});

describe("loadVillaClipPolicy", () => {
  it("설정 행이 없으면 기본값 (무중단)", async () => {
    await expect(loadVillaClipPolicy(fakeDb({}))).resolves.toEqual(POLICY);
  });

  it("AppSetting 값이 기본값을 오버라이드", async () => {
    const policy = await loadVillaClipPolicy(
      fakeDb({
        [VILLA_CLIP_SETTING_KEYS.maxBytes]: "1048576",
        [VILLA_CLIP_SETTING_KEYS.maxDurationSec]: "15",
        [VILLA_CLIP_SETTING_KEYS.maxPerVilla]: "3",
      })
    );
    expect(policy.maxBytes).toBe(1048576);
    expect(policy.maxDurationSec).toBe(15);
    expect(policy.maxPerVilla).toBe(3);
  });

  it("쓰레기·0·음수 값은 기본값으로 폴백 — 잘못된 설정이 업로드를 막지 않게", async () => {
    const policy = await loadVillaClipPolicy(
      fakeDb({
        [VILLA_CLIP_SETTING_KEYS.maxBytes]: "abc",
        [VILLA_CLIP_SETTING_KEYS.maxDurationSec]: "0",
        [VILLA_CLIP_SETTING_KEYS.maxPerVilla]: "-5",
      })
    );
    expect(policy.maxBytes).toBe(POLICY.maxBytes);
    expect(policy.maxDurationSec).toBe(POLICY.maxDurationSec);
    expect(policy.maxPerVilla).toBe(POLICY.maxPerVilla);
  });

  it("설정 조회가 실패해도 기본값으로 진행", async () => {
    const brokenDb = {
      appSetting: {
        findMany: async () => {
          throw new Error("DB down");
        },
      },
    };
    await expect(loadVillaClipPolicy(brokenDb)).resolves.toEqual(POLICY);
  });
});
