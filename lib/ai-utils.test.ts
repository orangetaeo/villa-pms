import { describe, expect, it } from "vitest";
import { extractJsonFromAIResponse } from "@/lib/ai-utils";

describe("extractJsonFromAIResponse — 5단계 추출 ([SHARED-MODULE])", () => {
  it("1단계: 전체가 JSON", () => {
    expect(extractJsonFromAIResponse('{"a":1}')).toEqual({ a: 1 });
  });

  it("2단계: ```json 코드 블록", () => {
    const raw = '설명입니다.\n```json\n{"passportNo":"M123"}\n```\n끝.';
    expect(extractJsonFromAIResponse(raw)).toEqual({ passportNo: "M123" });
  });

  it("3단계: 첫 블록이 깨졌으면 가장 큰 코드 블록에서 추출", () => {
    const raw = '```\nbroken json\n```\n중간\n```json\n{"a":1,"b":2,"c":3}\n```';
    expect(extractJsonFromAIResponse(raw)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("4단계: balanced braces — 문자열 안 중괄호·이스케이프 무시", () => {
    const raw = '응답: {"name":"홍 {길동}","note":"escaped \\" quote"} 뒤 텍스트 } 노이즈';
    expect(extractJsonFromAIResponse(raw)).toEqual({
      name: "홍 {길동}",
      note: 'escaped " quote',
    });
  });

  it("JSON이 전혀 없으면 null", () => {
    expect(extractJsonFromAIResponse("죄송합니다. 인식할 수 없습니다.")).toBeNull();
  });

  it("깨진 JSON만 있으면 null", () => {
    expect(extractJsonFromAIResponse('{"a": broken')).toBeNull();
  });
});
