// tests/gemini-json-mode.test.ts — JSON을 파싱하는 Gemini 생성기는 응답을 JSON 모드로 강제한다
//
// 배경(테오 지적 2026-07-24): 카피가이드가 주입된 큰 프롬프트에서 모델이 가이드를 그대로 복창해
//   파싱 0블록이 되는 간헐 실패가 있었다. 재시도로 넘어가지만, 근본 완화는 응답을 JSON 디코딩 모드로
//   강제하는 것(generationConfig.responseMimeType = "application/json")이다.
// ★ 이 테스트가 회귀 방지선 — JSON을 파싱하는 생성기에서 이 설정이 빠지면 여기서 깨진다.
//   (평문을 반환하는 생성기 — villa-prep 소개문·place caption·reel 자막 등 — 은 대상이 아니다.)
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ServiceType } from "@prisma/client";
import { generateArticleBody, generateVillaArticleBody, type ArticleTopic } from "@/lib/seo/article-draft";
import { generatePlaceArticleBody, PLACE_CATEGORIES, type PlaceRow } from "@/lib/seo/place-article";
import { generateServiceArticleBody, serviceTopicByType, buildServiceFacts, type ServiceItemRow } from "@/lib/seo/service-article";
import { generateShortMeta } from "@/lib/youtube/meta";
import type { PublicVilla } from "@/lib/seo/public-villa";
import type { VillaPublicInfo } from "@/lib/instagram/caption";

/** 요청 body를 잡아채고 유효한 JSON 응답을 돌려주는 mock fetch. */
function capturingFetch() {
  const bodies: Record<string, unknown>[] = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const text = JSON.stringify([{ type: "h2", text: "제목" }, { type: "p", text: "충분히 긴 본문 문단입니다." }]);
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

/** 마지막 요청의 generationConfig.responseMimeType */
function lastMime(bodies: Record<string, unknown>[]): unknown {
  const last = bodies[bodies.length - 1] as { generationConfig?: { responseMimeType?: unknown } };
  return last?.generationConfig?.responseMimeType;
}

const topic: ArticleTopic = { key: "airport-transfer", title: "제목", brief: "취재 지시" };

const villa = {
  id: "v1",
  slug: "villa-1",
  publicLabel: "쏘나씨 3베드 풀빌라",
  complex: "Sonasea",
  areaCode: null,
  areaName: null,
  areaNameKo: "쏘나씨",
  bedrooms: 3,
  bathrooms: 3,
  commonBathrooms: 1,
  maxGuests: 6,
  areaSqm: 200,
  floors: 2,
  extraBedAvailable: false,
  hasPool: true,
  breakfastAvailable: true,
  beachDistanceM: 300,
  featureKeys: [],
  checkInTime: 14,
  checkOutTime: 11,
  smokingAllowed: false,
  petsAllowed: false,
  partyAllowed: false,
  parkingSlots: 1,
  description: null,
  photos: [],
  videos: [],
  updatedAt: new Date(),
  publicListedAt: new Date(),
} as unknown as PublicVilla;

const place = {
  id: "p1",
  name: "메오키친",
  nameLocal: null,
  category: "restaurant",
  area: "즈엉동",
  oneLiner: "반세오가 특히 인상 깊었다",
  tips: null,
  photos: [],
} as unknown as PlaceRow;

const villaInfo: VillaPublicInfo = {
  complex: "Sonasea",
  areaNameKo: "쏘나씨",
  bedrooms: 3,
  maxGuests: 6,
  beachDistanceM: 300,
  hasPool: true,
  breakfastAvailable: true,
  featureKeys: [],
};

describe("JSON 파싱 생성기 — 응답 JSON 모드 강제", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("① 가이드 글 (generateArticleBody)", async () => {
    const { fn, bodies } = capturingFetch();
    await generateArticleBody(topic, ["힌트"], fn);
    expect(lastMime(bodies)).toBe("application/json");
  });

  it("② 빌라 글 (generateVillaArticleBody)", async () => {
    const { fn, bodies } = capturingFetch();
    await generateVillaArticleBody(villa, fn);
    expect(lastMime(bodies)).toBe("application/json");
  });

  it("③ 장소 글 (generatePlaceArticleBody)", async () => {
    const { fn, bodies } = capturingFetch();
    await generatePlaceArticleBody(PLACE_CATEGORIES[0], [place], fn);
    expect(lastMime(bodies)).toBe("application/json");
  });

  it("④ 서비스 글 (generateServiceArticleBody)", async () => {
    const items = [
      { id: "c1", type: ServiceType.MASSAGE, nameKo: "아로마 마사지", descKo: "빌라 방문 마사지입니다", unitLabelKo: "1인", options: null, photoUrl: null },
    ] as unknown as ServiceItemRow[];
    const svcTopic = serviceTopicByType(ServiceType.MASSAGE)!;
    const { fn, bodies } = capturingFetch();
    await generateServiceArticleBody(svcTopic, buildServiceFacts(items), fn);
    expect(lastMime(bodies)).toBe("application/json");
  });

  it("⑤ 유튜브 쇼츠 제목·설명 (generateShortMeta)", async () => {
    const { fn, bodies } = capturingFetch();
    await generateShortMeta(villaInfo, fn);
    expect(lastMime(bodies)).toBe("application/json");
  });
});
