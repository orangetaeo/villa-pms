// translateText 견고화 — 부분실패 감지·재시도 단위 테스트 (fetchFn 주입, DB·zca-js 의존 0).
// 부분번역(원문 잔류) → 재시도 → 정상번역 / 재시도도 실패 시 더 나은 쪽 / 정상은 재시도 없음.
// translateImage·transcribeVoice 테스트 패턴 차용 — fetch 주입으로 순수 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  translateText,
  isBrokenKoTranslation,
  hangulRatio,
  GeminiNotConfiguredError,
} from "@/lib/gemini";

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

/** Gemini generateContent 응답 모양으로 텍스트 1건을 돌려주는 가짜 fetch(고정 응답). */
function fakeFetchWithText(text: string): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  ) as unknown as typeof fetch;
}

/** 호출 순서대로 다른 텍스트를 돌려주는 가짜 fetch(재시도 검증용). */
function fakeFetchSequence(...texts: string[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const text = texts[Math.min(i, texts.length - 1)];
    i += 1;
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;
}

const VI_SOURCE =
  "Tôi đã tìm đến nhà sản xuất tất và họ không có ý định hợp tác bạn ạ";
const BROKEN_KO =
  "제가 양 nhà sản xuất tất và họ không có ý định hợp tác bạn ạ"; // 실제 부분실패 사례
const GOOD_KO = "제가 양말 제조사를 찾아갔는데 그들은 협력할 의사가 없다고 합니다";

describe("hangulRatio / isBrokenKoTranslation — 부분실패 감지", () => {
  it("정상 한국어 번역은 부분실패가 아니다", () => {
    expect(hangulRatio(GOOD_KO)).toBeGreaterThan(0.8);
    expect(isBrokenKoTranslation(VI_SOURCE, GOOD_KO)).toBe(false);
  });

  it("앞 몇 글자만 한국어인 부분실패를 감지한다", () => {
    expect(hangulRatio(BROKEN_KO)).toBeLessThan(0.35);
    expect(isBrokenKoTranslation(VI_SOURCE, BROKEN_KO)).toBe(true);
  });

  it("원문 그대로 되돌아오면 부분실패로 본다", () => {
    expect(isBrokenKoTranslation(VI_SOURCE, VI_SOURCE)).toBe(true);
  });

  it("고유명사/브랜드만 라틴인 짧은 정상 번역은 부분실패가 아니다", () => {
    expect(isBrokenKoTranslation("Hoka 신발 있어요?", "Hoka 신발 있나요?")).toBe(false);
  });

  it("빈 결과는 부분실패가 아니다(별도 처리)", () => {
    expect(isBrokenKoTranslation(VI_SOURCE, "")).toBe(false);
  });
});

describe("translateText — 견고화(재시도)", () => {
  it("키 미설정 → GeminiNotConfiguredError throw (fetch 미호출)", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(translateText("xin chào", "ko", fetchFn)).rejects.toBeInstanceOf(
      GeminiNotConfiguredError
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("빈 입력 → 빈 문자열(fetch 미호출)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = vi.fn() as unknown as typeof fetch;
    expect(await translateText("   ", "ko", fetchFn)).toBe("");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("정상 ko 번역 → 재시도 없이 1회 호출", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = fakeFetchWithText(GOOD_KO);
    const out = await translateText(VI_SOURCE, "ko", fetchFn);
    expect(out).toBe(GOOD_KO);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("부분번역 → 재시도 → 정상번역 반환(2회 호출)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = fakeFetchSequence(BROKEN_KO, GOOD_KO);
    const out = await translateText(VI_SOURCE, "ko", fetchFn);
    expect(out).toBe(GOOD_KO);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("재시도도 부분실패면 한글 비율 더 높은 쪽 반환(≤2회)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    // 1차: 한글 0글자 부분실패, 2차: 앞 일부만 한글(여전히 부분실패지만 1차보다 나음)
    const fetchFn = fakeFetchSequence(VI_SOURCE, BROKEN_KO);
    const out = await translateText(VI_SOURCE, "ko", fetchFn);
    expect(out).toBe(BROKEN_KO); // 더 나은 쪽
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("재시도가 HTTP 오류면 1차 결과 반환(throw 안 함, ≤2회)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: BROKEN_KO }] } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("err", { status: 503 });
    }) as unknown as typeof fetch;
    const out = await translateText(VI_SOURCE, "ko", fetchFn);
    expect(out).toBe(BROKEN_KO);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("vi 타겟은 부분실패 감지·재시도 안 함(1회 호출)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = fakeFetchWithText("xin chào"); // ko가 아니므로 잔류 판정 미적용
    const out = await translateText("안녕하세요", "vi", fetchFn);
    expect(out).toBe("xin chào");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("API 오류(1차) → Error throw(상태 코드만)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = vi.fn(async () =>
      new Response("err", { status: 429 })
    ) as unknown as typeof fetch;
    await expect(translateText(VI_SOURCE, "ko", fetchFn)).rejects.toThrow("HTTP 429");
  });
});
