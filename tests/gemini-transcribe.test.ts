// S5 A6-3 — transcribeVoice 단위 테스트 (fetchFn 주입: 키 미설정 throw / 정상 텍스트 / 빈 입력 "")
// translateText·ocrPassport 테스트 패턴 차용 — DB·zca-js 의존 0, fetch 주입으로 순수 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeVoice, GeminiNotConfiguredError } from "@/lib/gemini";

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

/** Gemini generateContent 응답 모양으로 텍스트 1건을 돌려주는 가짜 fetch. */
function fakeFetchWithText(text: string): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  ) as unknown as typeof fetch;
}

describe("transcribeVoice — 음성 STT (S5 A6-3)", () => {
  it("키 미설정 → GeminiNotConfiguredError throw (fetch 미호출)", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(transcribeVoice("ZmFrZQ==", "audio/mpeg", fetchFn)).rejects.toBeInstanceOf(
      GeminiNotConfiguredError
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("정상 응답 → 받아쓴 텍스트 반환(trim)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = fakeFetchWithText("  Xin chào anh  ");
    const out = await transcribeVoice("ZmFrZQ==", "audio/mpeg", fetchFn);
    expect(out).toBe("Xin chào anh");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("빈 오디오 입력 → 빈 문자열(fetch 미호출)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = vi.fn() as unknown as typeof fetch;
    expect(await transcribeVoice("", "audio/mpeg", fetchFn)).toBe("");
    expect(await transcribeVoice("   ", "audio/mpeg", fetchFn)).toBe("");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("불명확/무음 → 모델이 빈 문자열 반환 시 그대로 빈 문자열", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const out = await transcribeVoice("ZmFrZQ==", "audio/mpeg", fakeFetchWithText(""));
    expect(out).toBe("");
  });

  it("API 오류 → Error throw(상태 코드만, 오디오 비노출)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = vi.fn(async () => new Response("err", { status: 429 })) as unknown as typeof fetch;
    await expect(transcribeVoice("ZmFrZQ==", "audio/mpeg", fetchFn)).rejects.toThrow("HTTP 429");
  });
});
