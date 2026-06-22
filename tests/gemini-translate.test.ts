// translateText 견고화 — 부분실패 감지·재시도 단위 테스트 (fetchFn 주입, DB·zca-js 의존 0).
// 부분번역(원문 잔류) → 재시도 → 정상번역 / 재시도도 실패 시 더 나은 쪽 / 정상은 재시도 없음.
// translateImage·transcribeVoice 테스트 패턴 차용 — fetch 주입으로 순수 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  translateText,
  isBrokenKoTranslation,
  numbersPreserved,
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

describe("numbersPreserved — 금액·숫자 복사 오류 감지", () => {
  it("실제 버그: 1,700,000 → 1,770,000(같은 자릿수 변형)을 잡는다", () => {
    const src = "dạ sếp ơi, hôm nay cho em xin ứng 1,700,000 nữa nhé, vẫn mã QR cũ ạ";
    const bad = "네 사장님, 오늘 1,770,000원 더 가불 신청합니다. QR 코드는 예전 것과 동일합니다.";
    const good = "네 사장님, 오늘 1,700,000원 더 가불 신청합니다. QR 코드는 예전 것과 동일합니다.";
    expect(numbersPreserved(src, bad)).toBe(false);
    expect(numbersPreserved(src, good)).toBe(true);
  });

  it("천단위 구분자 차이(. ↔ ,)는 동일 숫자로 본다", () => {
    expect(numbersPreserved("giá 1.700.000 đồng", "가격 1,700,000원")).toBe(true);
  });

  it("전화번호 같은 자릿수 변형(복사 오타)을 잡는다", () => {
    expect(numbersPreserved("gọi 0905123456", "0905123356으로 전화하세요")).toBe(false);
  });

  it("정당한 단위어 변환은 오탐하지 않는다(nghìn/triệu/tr·만·억)", () => {
    // "119 nghìn"(=119,000) → "119,000": 원문 큰 숫자(4자리↑) 없음 → 통과
    expect(numbersPreserved("119 nghìn VNĐ", "119,000 VND")).toBe(true);
    // "5000.000"(=5,000,000) → "500만": 같은 자릿수(7) 그룹이 출력에 없음 → 통과
    expect(numbersPreserved("em thấy bán 5000.000", "베트남에서는 500만에 팔던데요")).toBe(true);
    // "50.000.000"(=50,000,000) → "5천만": 같은 자릿수(8) 그룹 없음 → 통과
    expect(numbersPreserved("phạt 50.000.000 đồng", "벌금 5천만 동")).toBe(true);
    // "100tr"(=100 triệu) → "1억": 큰 숫자 없음(100<4자리 미만 취급) → 통과
    expect(numbersPreserved("Nếu họ phạt 100tr thì nặng quá", "1억을 벌금으로 매기면 너무 심하네요")).toBe(true);
  });

  it("큰 숫자 없으면(또는 한 자리 수량) 통과 — 오탐 방지", () => {
    expect(numbersPreserved("xin chào", "안녕하세요")).toBe(true);
    expect(numbersPreserved("2 phòng", "방 2개")).toBe(true);
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

  it("숫자 오역(1차) → 재시도 → 숫자 보존된 결과 반환(2회 호출)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const src = "ứng 1,700,000 nhé";
    const bad = "1,770,000원 가불해 주세요"; // 숫자 틀림
    const good = "1,700,000원 가불해 주세요"; // 숫자 보존
    const fetchFn = fakeFetchSequence(bad, good);
    const out = await translateText(src, "ko", fetchFn);
    expect(out).toBe(good);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("숫자 오역은 vi 타겟에서도 재시도한다(모든 타겟 적용)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const src = "1,700,000원 가불";
    const bad = "ứng 1,770,000"; // 숫자 틀림
    const good = "ứng 1,700,000"; // 숫자 보존
    const fetchFn = fakeFetchSequence(bad, good);
    const out = await translateText(src, "vi", fetchFn);
    expect(out).toBe(good);
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
