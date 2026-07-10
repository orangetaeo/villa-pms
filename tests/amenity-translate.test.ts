import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/amenity-translate — custom 비품 라벨 vi→ko 저장형 번역 (best-effort, 커밋 후)
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    villaAmenity: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      updateMany: (...a: unknown[]) => mockUpdateMany(...a),
    },
  },
}));

const mockTranslateText = vi.fn();
vi.mock("@/lib/gemini", () => ({
  translateText: (...a: unknown[]) => mockTranslateText(...a),
}));

import { translateVillaCustomAmenities } from "@/lib/amenity-translate";

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("translateVillaCustomAmenities", () => {
  it("custom 라벨을 dedupe 후 번역하고 성공분만 customLabelKo로 updateMany", async () => {
    mockFindMany.mockResolvedValue([
      { customLabel: "Máy xay" },
      { customLabel: "Máy xay" }, // 중복 → 1회만 번역
      { customLabel: "Nồi áp suất" },
    ]);
    mockTranslateText.mockImplementation(async (label: string) => `KO:${label}`);

    await translateVillaCustomAmenities("villa-1");

    // dedupe → 2회 번역
    expect(mockTranslateText).toHaveBeenCalledTimes(2);
    expect(mockTranslateText).toHaveBeenCalledWith("Máy xay", "ko");
    expect(mockTranslateText).toHaveBeenCalledWith("Nồi áp suất", "ko");
    // 성공분 각각 updateMany (customLabel 매칭 → 동일 라벨 여러 행 동시 갱신)
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
    const firstArg = (mockUpdateMany.mock.calls[0] as unknown[])[0] as {
      where: { villaId: string; itemKey: string; customLabel: string; customLabelKo: null };
      data: { customLabelKo: string };
    };
    expect(firstArg.where).toMatchObject({
      villaId: "villa-1",
      itemKey: "custom",
      customLabel: "Máy xay",
      customLabelKo: null,
    });
    expect(firstArg.data.customLabelKo).toBe("KO:Máy xay");
  });

  it("Gemini 실패(키 미설정 등)여도 예외를 던지지 않고 updateMany 호출 안 함", async () => {
    mockFindMany.mockResolvedValue([{ customLabel: "Máy xay" }]);
    mockTranslateText.mockRejectedValue(new Error("GeminiNotConfigured"));

    await expect(translateVillaCustomAmenities("villa-1")).resolves.toBeUndefined();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("번역 대상이 없으면 조기 반환(번역·저장 호출 없음)", async () => {
    mockFindMany.mockResolvedValue([]);
    await translateVillaCustomAmenities("villa-1");
    expect(mockTranslateText).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("번역 결과가 원문과 동일(음역/미번역)하면 저장 스킵", async () => {
    mockFindMany.mockResolvedValue([{ customLabel: "Wifi" }]);
    mockTranslateText.mockResolvedValue("Wifi");
    await translateVillaCustomAmenities("villa-1");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("findMany 자체가 실패해도 예외 전파 안 함", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    await expect(translateVillaCustomAmenities("villa-1")).resolves.toBeUndefined();
  });
});
