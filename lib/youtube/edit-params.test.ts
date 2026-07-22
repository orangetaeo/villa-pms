import { describe, expect, it } from "vitest";
import { validateEditParams, EditValidationError } from "./edit";

const KEY = "villa-clips/abc123.mp4";

describe("validateEditParams — 컷 메타(space·note) 보존", () => {
  // ★ 이 파일이 존재하는 이유: 2026-07-23까지 space·note가 스키마에 없어 **조용히 버려졌다.**
  //   그 결과 대본 생성기(clipHintsOf)가 항상 "공간 미지정"을 받아 나레이션이 일반론이 됐고,
  //   컷 속도 조절(pacing)도 판정 근거가 없어 전부 정속으로 돌았다. 회귀하면 둘 다 함께 죽는다.
  it("공간 코드를 보존한다", () => {
    const p = validateEditParams({ clips: [{ key: KEY, space: "BEDROOM" }] });
    expect(p.clips[0].space).toBe("BEDROOM");
  });

  it("소문자로 와도 정규화해서 받는다", () => {
    expect(validateEditParams({ clips: [{ key: KEY, space: "pool" }] }).clips[0].space).toBe("POOL");
  });

  it("PhotoSpace에 없는 값은 버린다(임의 문자열 저장 금지)", () => {
    expect(validateEditParams({ clips: [{ key: KEY, space: "GARAGE" }] }).clips[0].space).toBeNull();
    expect(validateEditParams({ clips: [{ key: KEY, space: 7 }] }).clips[0].space).toBeNull();
  });

  it("메모를 보존하고 200자로 자른다", () => {
    const long = "가".repeat(300);
    const p = validateEditParams({ clips: [{ key: KEY, note: long }] });
    expect(p.clips[0].note).toHaveLength(200);
    expect(validateEditParams({ clips: [{ key: KEY, note: "  킹베드  " }] }).clips[0].note).toBe("킹베드");
    expect(validateEditParams({ clips: [{ key: KEY, note: "   " }] }).clips[0].note).toBeNull();
  });
});

describe("validateEditParams — 배경음·페이싱 기본값", () => {
  it("미지정이면 배경음 soft · 페이싱 켬 (재렌더하면 저절로 좋아지는 쪽이 기본)", () => {
    const p = validateEditParams({ clips: [{ key: KEY }] });
    expect(p.bgm).toBe("soft");
    expect(p.pacing).toBe(true);
  });

  it("명시적으로 끌 수 있다", () => {
    const p = validateEditParams({ clips: [{ key: KEY }], bgm: "none", pacing: false });
    expect(p.bgm).toBe("none");
    expect(p.pacing).toBe(false);
  });
});

describe("validateEditParams — 기존 계약 회귀", () => {
  it("클립이 없으면 거부", () => {
    expect(() => validateEditParams({ clips: [] })).toThrow(EditValidationError);
  });

  it("허용 접두 밖 키는 거부(임의 R2 키 조회 차단)", () => {
    expect(() => validateEditParams({ clips: [{ key: "secrets/a.mp4" }] })).toThrow(EditValidationError);
  });

  it("트림 길이는 2~8초로 클램프", () => {
    expect(validateEditParams({ clips: [{ key: KEY, durationSec: 99 }] }).clips[0].durationSec).toBe(8);
    expect(validateEditParams({ clips: [{ key: KEY, durationSec: 0.1 }] }).clips[0].durationSec).toBe(2);
  });
});
