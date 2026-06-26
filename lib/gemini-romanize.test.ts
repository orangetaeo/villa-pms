import { describe, expect, it, afterEach, vi } from "vitest";
import { romanizeVillaName, GeminiNotConfiguredError } from "./gemini";

// ADR-0020 빌라명 음역(romanizeVillaName) — mock fetch로 동작 고정.
// 실 Gemini 호출은 별도 수동 검증(프롬프트 정합). 여기선 키 게이트·응답 파싱·정리 로직 검증.

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;
afterEach(() => {
  process.env.GEMINI_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
});

function mockFetchReturning(text: string): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
    })
  ) as unknown as typeof fetch;
}

describe("romanizeVillaName", () => {
  it("키 미설정이면 GeminiNotConfiguredError", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(romanizeVillaName("쏘나씨 V11")).rejects.toBeInstanceOf(
      GeminiNotConfiguredError
    );
  });

  it("빈 입력은 빈 문자열(API 호출 안 함)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const f = vi.fn() as unknown as typeof fetch;
    expect(await romanizeVillaName("   ", f)).toBe("");
    expect(f).not.toHaveBeenCalled();
  });

  it("응답 텍스트를 트림해 반환", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    expect(await romanizeVillaName("쏘나씨 V11", mockFetchReturning("  Sonasea V11  "))).toBe(
      "Sonasea V11"
    );
  });

  it("모델이 붙인 따옴표·여러 줄은 정리(첫 줄·양끝 따옴표 제거)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    expect(
      await romanizeVillaName("썬셋 사나토 A3", mockFetchReturning('"Sunset Sanato A3"\n설명...'))
    ).toBe("Sunset Sanato A3");
  });

  it("API 비정상(HTTP 500)이면 throw", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const f = vi.fn(async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    await expect(romanizeVillaName("쏘나씨 V11", f)).rejects.toThrow("Gemini API HTTP 500");
  });
});
