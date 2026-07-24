// tests/seo-auto-tag.test.ts — 사진 AI 자동 태그 (T-photo-autotag)
//
// 지키는 것:
//  1) 실패·키 미설정 시 **안전 폴백**(kind null + 가게명) — 자동태그가 업로드를 막지 않는다
//  2) Gemini kind는 화이트리스트(MEDIA_KINDS) 검증 — 엉뚱한 값은 null
//  3) alt = "가게명 + 설명" 으로 조립(갤러리 그룹 키가 된다)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { autoTagImage } from "@/lib/seo/auto-tag";

let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .jpeg()
    .toBuffer();
});

/** 1번째 호출=이미지 다운로드, 2번째=Gemini 응답. gemini가 null이면 실패(ok:false) 시뮬. */
function fakeFetch(image: Buffer, gemini: unknown | null): typeof fetch {
  let n = 0;
  return (async () => {
    n++;
    if (n === 1) return { ok: true, arrayBuffer: async () => image } as unknown as Response;
    if (gemini === null) return { ok: false, status: 500 } as unknown as Response;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(gemini) }] } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("autoTagImage", () => {
  const KEY = process.env.GEMINI_API_KEY;
  beforeAll(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterAll(() => {
    if (KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = KEY;
  });

  it("키가 없으면 폴백(kind null + 가게명) — 업로드를 막지 않는다", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const r = await autoTagImage("https://cdn.r2.dev/x.jpg", "메오키친");
    expect(r).toEqual({ kind: null, alt: "메오키친" });
    process.env.GEMINI_API_KEY = saved;
  });

  it("사진을 분류해 kind + '가게명 설명' alt를 만든다", async () => {
    const r = await autoTagImage("https://cdn.r2.dev/x.jpg", "메오키친", fakeFetch(jpeg, { kind: "food", label: "반쎄오" }));
    expect(r.kind).toBe("food");
    expect(r.alt).toBe("메오키친 반쎄오");
  });

  it("스팟 종류(수영장·시설)도 분류된다", async () => {
    const r = await autoTagImage("https://cdn.r2.dev/x.jpg", "썬셋사나토", fakeFetch(jpeg, { kind: "facility", label: "수영장" }));
    expect(r.kind).toBe("facility");
    expect(r.alt).toBe("썬셋사나토 수영장");
  });

  it("화이트리스트 밖 kind는 null로 떨어뜨린다(설명은 유지)", async () => {
    const r = await autoTagImage("https://cdn.r2.dev/x.jpg", "가게", fakeFetch(jpeg, { kind: "banana", label: "노을" }));
    expect(r.kind).toBeNull();
    expect(r.alt).toBe("가게 노을");
  });

  it("Gemini 실패 시 폴백", async () => {
    const r = await autoTagImage("https://cdn.r2.dev/x.jpg", "가게", fakeFetch(jpeg, null));
    expect(r).toEqual({ kind: null, alt: "가게" });
  });

  it("설명이 비면 가게명만", async () => {
    const r = await autoTagImage("https://cdn.r2.dev/x.jpg", "가게", fakeFetch(jpeg, { kind: "etc", label: "" }));
    expect(r.alt).toBe("가게");
    expect(r.kind).toBe("etc");
  });
});
