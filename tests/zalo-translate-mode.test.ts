// ADR-0009 S5 — 번역 언어쌍·OFF 매핑 (translateText / previewTargetForMode, 실제 구현)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewTargetForMode, translateText } from "@/lib/gemini";

// translateText는 fetchFn 주입 가능 — 네트워크 없이 프롬프트 언어/요청만 검증.
function fakeFetch(replyText: string) {
  return vi.fn(
    async (_input: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: replyText }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
  );
}

describe("previewTargetForMode — translateMode → 발신 미리보기 타깃 (D7.4)", () => {
  it("VI → vi, EN → en, OFF → null", () => {
    expect(previewTargetForMode("VI")).toBe("vi");
    expect(previewTargetForMode("EN")).toBe("en");
    expect(previewTargetForMode("OFF")).toBeNull();
  });
});

describe("translateText — 언어쌍 프롬프트 (D7.4)", () => {
  const OLD_KEY = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = OLD_KEY;
  });

  it("target=vi → 프롬프트에 Vietnamese", async () => {
    const f = fakeFetch("Xin chào");
    const out = await translateText("안녕하세요", "vi", f);
    expect(out).toBe("Xin chào");
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toContain("Vietnamese");
  });

  it("target=en → 프롬프트에 English (신규 언어쌍)", async () => {
    const f = fakeFetch("Hello");
    const out = await translateText("안녕하세요", "en", f);
    expect(out).toBe("Hello");
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toContain("English");
  });

  it("target=ko → 프롬프트에 Korean (수신 번역)", async () => {
    const f = fakeFetch("안녕하세요");
    await translateText("Xin chào", "ko", f);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toContain("Korean");
  });

  it("빈 입력은 빈 문자열 — fetch 호출 0", async () => {
    const f = fakeFetch("x");
    expect(await translateText("   ", "vi", f)).toBe("");
    expect(f).not.toHaveBeenCalled();
  });
});
