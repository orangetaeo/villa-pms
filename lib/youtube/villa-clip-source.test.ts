import { describe, expect, it } from "vitest";
import {
  ClipSourceError,
  applyResolvedClipKeys,
  extractClipRefs,
  isVillaClipSourceKey,
  resolveSourceVilla,
  type ApprovedClipRow,
} from "./villa-clip-source";

const KEY_A = "villa-clips/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4";
const KEY_B = "villa-clips/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mov";
const ROW_A: ApprovedClipRow = { id: "clip-a", r2Key: KEY_A, villaId: "villa-1" };
const ROW_B: ApprovedClipRow = { id: "clip-b", r2Key: KEY_B, villaId: "villa-1" };

describe("isVillaClipSourceKey", () => {
  it("villa-clips 접두 + mp4/mov만 참", () => {
    expect(isVillaClipSourceKey(KEY_A)).toBe(true);
    expect(isVillaClipSourceKey(KEY_B)).toBe(true);
  });

  it("다른 접두·확장자·경로 주입은 거짓", () => {
    expect(isVillaClipSourceKey("youtube-clips/abc.mp4")).toBe(false);
    expect(isVillaClipSourceKey("villa-clips/../secret.mp4")).toBe(false);
    expect(isVillaClipSourceKey("villa-clips/abc.webm")).toBe(false);
    expect(isVillaClipSourceKey("villa-photos/abc.mp4")).toBe(false);
    expect(isVillaClipSourceKey(undefined)).toBe(false);
  });
});

describe("extractClipRefs", () => {
  it("villaClipId와 villa-clips 직접 키를 각각 모은다", () => {
    const refs = extractClipRefs({
      clips: [
        { villaClipId: "clip-a" },
        { key: KEY_B },
        { key: "youtube-clips/deadbeef.mp4" }, // 기존 경로는 참조로 세지 않는다
      ],
    });
    expect(refs.ids).toEqual(["clip-a"]);
    expect(refs.keys).toEqual([KEY_B]);
  });

  it("중복은 제거하고 등장 순서를 보존한다", () => {
    const refs = extractClipRefs({
      clips: [{ villaClipId: "b" }, { villaClipId: "a" }, { villaClipId: "b" }],
    });
    expect(refs.ids).toEqual(["b", "a"]);
  });

  it("clips가 없거나 이상한 입력에도 터지지 않는다", () => {
    expect(extractClipRefs(null)).toEqual({ ids: [], keys: [] });
    expect(extractClipRefs({})).toEqual({ ids: [], keys: [] });
    expect(extractClipRefs({ clips: "nope" })).toEqual({ ids: [], keys: [] });
    expect(extractClipRefs({ clips: [null, 3, "x"] })).toEqual({ ids: [], keys: [] });
  });
});

describe("resolveSourceVilla", () => {
  it("전부 조회되면 소재 빌라 id를 돌려준다", () => {
    const refs = { ids: ["clip-a", "clip-b"], keys: [] };
    expect(resolveSourceVilla([ROW_A, ROW_B], refs)).toBe("villa-1");
  });

  it("미승인·미존재 id는 CLIP_NOT_USABLE — 사유를 나누지 않는다(존재 누설 차단)", () => {
    // 라우트는 APPROVED만 조회하므로 "미승인"과 "미존재"는 똑같이 '조회 안 됨'으로 도착한다.
    const refs = { ids: ["clip-a", "clip-없음"], keys: [] };
    expect(() => resolveSourceVilla([ROW_A], refs)).toThrowError(ClipSourceError);
    try {
      resolveSourceVilla([ROW_A], refs);
    } catch (e) {
      expect((e as ClipSourceError).code).toBe("CLIP_NOT_USABLE");
    }
  });

  it("형식만 맞는 villa-clips 키를 직접 주입하면 거부한다 (우회 차단)", () => {
    const refs = { ids: [], keys: ["villa-clips/ffffffffffffffffffffffffffffffff.mp4"] };
    try {
      resolveSourceVilla([], refs);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ClipSourceError).code).toBe("CLIP_NOT_USABLE");
    }
  });

  it("여러 빌라의 영상을 섞으면 CLIP_VILLA_MISMATCH", () => {
    const other: ApprovedClipRow = { id: "clip-x", r2Key: KEY_B, villaId: "villa-2" };
    const refs = { ids: ["clip-a", "clip-x"], keys: [] };
    try {
      resolveSourceVilla([ROW_A, other], refs);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ClipSourceError).code).toBe("CLIP_VILLA_MISMATCH");
    }
  });

  it("지정한 빌라와 소재 빌라가 다르면 CLIP_VILLA_MISMATCH", () => {
    const refs = { ids: ["clip-a"], keys: [] };
    try {
      resolveSourceVilla([ROW_A], refs, "villa-9");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ClipSourceError).code).toBe("CLIP_VILLA_MISMATCH");
    }
  });

  it("지정한 빌라와 소재 빌라가 같으면 통과", () => {
    expect(resolveSourceVilla([ROW_A], { ids: ["clip-a"], keys: [] }, "villa-1")).toBe("villa-1");
  });
});

describe("applyResolvedClipKeys", () => {
  it("villaClipId를 r2Key로 치환하고 villaClipId 필드는 제거한다", () => {
    const out = applyResolvedClipKeys(
      { headline: "제목", clips: [{ villaClipId: "clip-a", durationSec: 5 }] },
      [ROW_A]
    ) as { headline: string; clips: Record<string, unknown>[] };

    expect(out.clips[0].key).toBe(KEY_A);
    expect(out.clips[0].durationSec).toBe(5); // 트림 설정은 보존
    expect("villaClipId" in out.clips[0]).toBe(false); // 저장 JSON에 스키마 외 필드를 남기지 않는다
    expect(out.headline).toBe("제목"); // 나머지 params 보존
  });

  it("입력을 변형하지 않는다(불변)", () => {
    const input = { clips: [{ villaClipId: "clip-a" }] };
    applyResolvedClipKeys(input, [ROW_A]);
    expect(input.clips[0]).toEqual({ villaClipId: "clip-a" });
  });

  it("기존 youtube-clips 항목은 그대로 통과시킨다 (회귀 없음)", () => {
    const out = applyResolvedClipKeys(
      { clips: [{ key: "youtube-clips/deadbeef.mp4", startSec: 2 }] },
      []
    ) as { clips: Record<string, unknown>[] };
    expect(out.clips[0]).toEqual({ key: "youtube-clips/deadbeef.mp4", startSec: 2 });
  });

  it("두 소재를 섞어 쓸 수 있다", () => {
    const out = applyResolvedClipKeys(
      { clips: [{ key: "youtube-clips/deadbeef.mp4" }, { villaClipId: "clip-b" }] },
      [ROW_B]
    ) as { clips: Record<string, unknown>[] };
    expect(out.clips.map((c) => c.key)).toEqual(["youtube-clips/deadbeef.mp4", KEY_B]);
  });
});
