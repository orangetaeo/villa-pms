// ADR-0009 S5 — 수신 자동번역 maybeTranslateInbound (OFF 스킵 / VI·EN → ko 타깃 / 실패 무시)
// + inbound-translate-realtime — 번역 채움 후 실시간 "update" 재발행(노출 지연 버그 수정)
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMsgUpdate = vi.fn();
const mockMsgFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloMessage: {
      update: (...a: unknown[]) => mockMsgUpdate(...a),
      findUnique: (...a: unknown[]) => mockMsgFindUnique(...a),
    },
  },
}));

const mockTranslateText = vi.fn();
vi.mock("@/lib/gemini", () => ({
  translateText: (...a: unknown[]) => mockTranslateText(...a),
}));

// 실시간 버스 — 번역 채움 후 "update" 신호 재발행 검증용.
const mockPublish = vi.fn();
vi.mock("@/lib/realtime-bus", () => ({
  publish: (...a: unknown[]) => mockPublish(...a),
}));

import { maybeTranslateInbound } from "@/lib/zalo-inbound";

beforeEach(() => {
  vi.clearAllMocks();
  mockMsgUpdate.mockResolvedValue({});
  // publishInboundTranslated가 messageId→conversation을 조회해 ownerAdminId 채널로 emit.
  mockMsgFindUnique.mockResolvedValue({
    conversationId: "c1",
    conversation: { ownerAdminId: "admin1" },
  });
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

  it("번역 채움 후 실시간 'update' 신호 1회 재발행(본인 채널·convId만, 누수 0)", async () => {
    mockTranslateText.mockResolvedValue("안녕하세요");
    await maybeTranslateInbound("m1", "Xin chào", "VI");
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith("admin1", {
      type: "update",
      conversationId: "c1",
    });
  });

  it("OFF → 번역도 실시간 발행도 0", async () => {
    await maybeTranslateInbound("m1", "Xin chào", "OFF");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("실시간 발행 실패는 swallow(throw 0) — translatedText 저장은 유지", async () => {
    mockTranslateText.mockResolvedValue("안녕하세요");
    mockMsgFindUnique.mockRejectedValue(new Error("db blip"));
    await expect(maybeTranslateInbound("m1", "Xin chào", "VI")).resolves.toBeUndefined();
    expect(mockMsgUpdate).toHaveBeenCalledTimes(1); // 저장은 완료
  });

  it("EN → 수신을 ko로 번역(en→ko도 ko 타깃)", async () => {
    mockTranslateText.mockResolvedValue("안녕");
    await maybeTranslateInbound("m1", "Hello", "EN");
    expect(mockTranslateText).toHaveBeenCalledWith("Hello", "ko");
  });

  it("빈 본문 → 번역 스킵", async () => {
    await maybeTranslateInbound("m1", "   ", "VI");
    expect(mockTranslateText).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("번역 결과 빈 문자열 → update 0, 발행 0", async () => {
    mockTranslateText.mockResolvedValue("");
    await maybeTranslateInbound("m1", "Xin chào", "VI");
    expect(mockMsgUpdate).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("번역 실패는 조용히 무시(throw 0, update 0, 발행 0)", async () => {
    mockTranslateText.mockRejectedValue(new Error("API down"));
    await expect(maybeTranslateInbound("m1", "Xin chào", "VI")).resolves.toBeUndefined();
    expect(mockMsgUpdate).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
