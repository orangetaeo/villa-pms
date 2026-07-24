// tests/villa-translation.test.ts — 빌라 소개문 번역 파이프라인 회귀 (ADR-0050 Phase 2)
//
// 잠그는 것: ① villaSourceHash 결정성 ② 누수 가드(실명·금액·길이 폭주·빈 출력) → FAILED(서빙 제외)
//   ③ descriptionVi가 프롬프트에 절대 도달하지 않음(공급자 원문 우회 봉쇄) ④ localizedVillaLabel 5개 언어.
import { describe, it, expect } from "vitest";
import { villaSourceHash, translateVillaDescription } from "@/lib/seo/translate-villa";
import { localizedVillaLabel, type PublicVilla } from "@/lib/seo/public-villa";
import type { DbClient } from "@/lib/availability";

// GEMINI_API_KEY가 없으면 callGemini가 즉시 null(=gemini_no_response)이라 가드 경로를 못 탄다 — 테스트용 키 주입.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "test-key";

/** 마지막 upsert된 create 페이로드를 캡처하는 가짜 db. */
function makeDb() {
  const captured: { create?: Record<string, unknown> } = {};
  const db = {
    villaTranslation: {
      findUnique: async () => null,
      upsert: async (args: { create: Record<string, unknown> }) => {
        captured.create = args.create;
        return { id: "vt_1" };
      },
    },
    auditLog: { create: async () => ({}) },
  } as unknown as DbClient;
  return { db, captured };
}

/** Gemini 응답 텍스트(JSON 문자열)를 돌려주는 가짜 fetch. 요청 body도 캡처한다. */
function makeFetch(responseText: string, sink?: { body?: string }) {
  return (async (_url: string, init?: { body?: string }) => {
    if (sink) sink.body = init?.body;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] }),
    };
  }) as unknown as typeof fetch;
}

const NEEDLES = ["sonasea v12", "m villa m1"];

describe("villaSourceHash", () => {
  it("같은 입력은 같은 해시(결정형)", () => {
    expect(villaSourceHash("소개문")).toBe(villaSourceHash("소개문"));
  });
  it("입력이 바뀌면 해시가 달라진다", () => {
    expect(villaSourceHash("소개문 A")).not.toBe(villaSourceHash("소개문 B"));
  });
  it("빈 문자열도 안정적으로 해시된다", () => {
    expect(villaSourceHash("")).toBe(villaSourceHash(""));
  });
});

describe("translateVillaDescription — 누수 가드 → FAILED(서빙 제외)", () => {
  const villa = { id: "villa_1", description: "바다 근처의 아늑한 풀빌라입니다. ".repeat(20) };

  it("깨끗한 번역은 READY로 저장된다", async () => {
    const { db, captured } = makeDb();
    const fetchFn = makeFetch('{"text":"A cozy pool villa near the beach."}');
    const r = await translateVillaDescription(villa, "en", { db, fetchFn, realNameNeedles: NEEDLES });
    expect(r.status).toBe("READY");
    expect(r.errorNote).toBeNull();
    expect(captured.create?.description).toBe("A cozy pool villa near the beach.");
    expect(captured.create?.status).toBe("READY");
  });

  it("빌라 고유 실명이 새면 FAILED", async () => {
    const { db } = makeDb();
    const fetchFn = makeFetch('{"text":"Stay at Sonasea V12 tonight, a lovely villa."}');
    const r = await translateVillaDescription(villa, "en", { db, fetchFn, realNameNeedles: NEEDLES });
    expect(r.status).toBe("FAILED");
    expect(r.errorNote).toContain("real_name_leak");
  });

  it("금액이 새면 FAILED", async () => {
    const { db } = makeDb();
    const fetchFn = makeFetch('{"text":"A pool villa for $120 per night by the sea."}');
    const r = await translateVillaDescription(villa, "vi", { db, fetchFn, realNameNeedles: NEEDLES });
    expect(r.status).toBe("FAILED");
    expect(r.errorNote).toContain("money_leak");
  });

  it("길이 폭주(원문 ×3 초과)면 FAILED", async () => {
    const { db } = makeDb();
    const shortVilla = { id: "villa_2", description: "짧다" }; // 2자
    const fetchFn = makeFetch('{"text":"This is a very very long hallucinated translation that far exceeds the source length."}');
    const r = await translateVillaDescription(shortVilla, "ru", { db, fetchFn, realNameNeedles: NEEDLES });
    expect(r.status).toBe("FAILED");
    expect(r.errorNote).toContain("length_blowup");
  });

  it("Gemini 응답 실패(HTTP not ok)면 FAILED gemini_no_response", async () => {
    const { db } = makeDb();
    const badFetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const r = await translateVillaDescription(villa, "zh", { db, fetchFn: badFetch, realNameNeedles: NEEDLES });
    expect(r.status).toBe("FAILED");
    expect(r.errorNote).toBe("gemini_no_response");
  });
});

describe("descriptionVi 미사용 — 공급자 원문이 프롬프트에 도달하지 않는다(ADR §2)", () => {
  it("Gemini 요청 body는 ko description만 담고 descriptionVi는 없다", async () => {
    const { db } = makeDb();
    const sink: { body?: string } = {};
    const fetchFn = makeFetch('{"text":"translated"}', sink);
    // descriptionVi를 억지로 끼워도(as any) 함수 시그니처가 {id,description}만 받으므로 프롬프트에 못 들어간다.
    const villa = {
      id: "villa_9",
      description: "한국어 검증 소개문입니다.",
      descriptionVi: "BÍ MẬT nhà cung cấp chưa kiểm duyệt",
    } as unknown as { id: string; description: string };
    await translateVillaDescription(villa, "en", { db, fetchFn, realNameNeedles: NEEDLES });
    expect(sink.body).toBeTruthy();
    expect(sink.body).toContain("한국어 검증 소개문입니다.");
    expect(sink.body).not.toContain("BÍ MẬT");
    expect(sink.body).not.toContain("descriptionVi");
  });
});

describe("localizedVillaLabel — 5개 언어 결정형", () => {
  const v = {
    complex: "Sonasea",
    areaNameKo: "쏘나씨",
    areaName: "Sonasea",
    bedrooms: 3,
    hasPool: true,
  } as unknown as PublicVilla;

  it("각 언어 라벨이 계약 예시와 일치한다", () => {
    expect(localizedVillaLabel(v, "ko")).toBe("푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라");
    expect(localizedVillaLabel(v, "en")).toBe("Phu Quoc Sonasea 3-Bedroom Private Pool Villa");
    expect(localizedVillaLabel(v, "vi")).toBe("Biệt thự hồ bơi riêng 3 phòng ngủ Sonasea Phú Quốc");
    expect(localizedVillaLabel(v, "ru")).toBe("Вилла с бассейном 3-спальная Sonasea Фукуок");
    expect(localizedVillaLabel(v, "zh")).toBe("富国岛 Sonasea 3卧 私人泳池别墅");
  });

  it("비-ko는 라틴 정본(areaName)을 쓰고 한글(areaNameKo)을 쓰지 않는다", () => {
    expect(localizedVillaLabel(v, "en")).not.toContain("쏘나씨");
    expect(localizedVillaLabel(v, "ru")).toContain("Sonasea");
  });
});
