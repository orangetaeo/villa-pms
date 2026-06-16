// ADR-0009 S5 — 수신 자동번역 maybeTranslateInbound (OFF 스킵 / VI·EN → ko 타깃 / 실패 무시)
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMsgUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { zaloMessage: { update: (...a: unknown[]) => mockMsgUpdate(...a) } },
}));

const mockTranslateText = vi.fn();
vi.mock("@/lib/gemini", () => ({
  translateText: (...a: unknown[]) => mockTranslateText(...a),
}));

import { maybeTranslateInbound } from "@/lib/zalo-inbound";

beforeEach(() => {
  vi.clearAllMocks();
  mockMsgUpdate.mockResolvedValue({});
});

describe("maybeTranslateInbound — 수신 자동번역 (D7.4)", () => {
  it("OFF → translateText 호출 0, message.update 0 (Gemini 호출 없음)", async () => {
    await maybeTranslateInbound("m1", "Xin chào", "OFF");
    expect(mockTranslateText).not.toHaveBeenCalled();
    expect(mockMsgUpdate).not.toHaveBeenCalled();
  });

  it("VI → 수신을 ko로 번역해 translatedText 저장(수신 타깃 항상 ko)", async () => {
    mockTranslateText.mockResolvedValue("안녕하세요");
    await maybeTranslateInbound("m1", "Xin chào", "VI");
    expect(mockTranslateText).toHaveBeenCalledWith("Xin chào", "ko");
    expect(mockMsgUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { translatedText: "안녕하세요" },
    });
  });

  it("EN → 수신을 ko로 번역(en→ko도 ko 타깃)", async () => {
    mockTranslateText.mockResolvedValue("안녕");
    await maybeTranslateInbound("m1", "Hello", "EN");
    expect(mockTranslateText).toHaveBeenCalledWith("Hello", "ko");
  });

  it("빈 본문 → 번역 스킵", async () => {
    await maybeTranslateInbound("m1", "   ", "VI");
    expect(mockTranslateText).not.toHaveBeenCalled();
  });

  it("번역 결과 빈 문자열 → update 0", async () => {
    mockTranslateText.mockResolvedValue("");
    await maybeTranslateInbound("m1", "Xin chào", "VI");
    expect(mockMsgUpdate).not.toHaveBeenCalled();
  });

  it("번역 실패는 조용히 무시(throw 0, update 0)", async () => {
    mockTranslateText.mockRejectedValue(new Error("API down"));
    await expect(maybeTranslateInbound("m1", "Xin chào", "VI")).resolves.toBeUndefined();
    expect(mockMsgUpdate).not.toHaveBeenCalled();
  });
});
