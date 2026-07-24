// tests/public-name-leak.test.ts — 공개 마케팅에서 빌라 고유 실명 제거 회귀 (원칙 1, 2026-07-24)
//
// 이 테스트가 실패하면 YT 쇼츠·IG 캡션·SEO 블로그·slug 중 하나에 빌라 **고유 실명**이 다시 새고 있다는 뜻이다.
// 실명이 공개되면 한국 여행객이 검색으로 직접 예약 페이지·공급자를 찾아 **직거래 우회**가 가능하다.
// "테스트를 고쳐" 통과시키지 말 것 — 실명을 넣은 코드를 되돌려야 한다.
import { describe, it, expect } from "vitest";
import { publicVillaLabel } from "@/lib/marketing/public-name";
import { buildMetaPrompt } from "@/lib/youtube/meta";
import { buildCaptionPrompt, type VillaPublicInfo } from "@/lib/instagram/caption";
import { buildNarrationPrompt, type NarrationVillaContext } from "@/lib/youtube/narration";
import { buildPublicSlug, toPublicVilla, type PublicVillaRow, type PublicVilla } from "@/lib/seo/public-villa";
import { buildVillaDescriptionPrompt, type VillaDescriptionFacts } from "@/lib/seo/villa-prep";
import { buildArticleSlug } from "@/lib/seo/article-draft";
import {
  buildVideoArticlePrompt,
  buildVideoArticleTitle,
  videoTopicKey,
  toVideoArticleVillaContext,
  type VideoArticleInput,
} from "@/lib/seo/video-article-draft";

// 실제 빌라 고유 실명(공개에 절대 나오면 안 되는 문자열).
const REAL_NAMES = ["M villa M1", "Sonasea V12", "쏘나씨 V12"];
// 실명에서 파생되는 토큰(단지명 "Sonasea"는 노출 OK지만 고유 식별자 "V12"는 금지).
const REAL_NAME_TOKENS = ["v12", "sonasea-v12", "m villa m1", "m-villa-m1"];

function assertNoRealName(text: string) {
  const lower = text.toLowerCase();
  for (const n of REAL_NAMES) expect(lower).not.toContain(n.toLowerCase());
  for (const t of REAL_NAME_TOKENS) expect(lower).not.toContain(t);
}

const V: VillaPublicInfo = {
  complex: "Sonasea",
  areaNameKo: "쏘나씨",
  bedrooms: 3,
  maxGuests: 8,
  beachDistanceM: 300,
  hasPool: true,
  breakfastAvailable: true,
  featureKeys: ["privatePool", "viewSea"],
};

describe("publicVillaLabel — 결정형 지역·특징 표시명", () => {
  it("계약 예시와 정확히 일치한다", () => {
    expect(
      publicVillaLabel({ complex: "Sonasea", areaNameKo: "쏘나씨", bedrooms: 3, hasPool: true })
    ).toBe("푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라");
  });

  it("같은 입력은 항상 같은 라벨(결정형)", () => {
    const a = publicVillaLabel({ complex: "Sonasea", areaNameKo: "쏘나씨", bedrooms: 3, hasPool: true });
    const b = publicVillaLabel({ complex: "Sonasea", areaNameKo: "쏘나씨", bedrooms: 3, hasPool: true });
    expect(a).toBe(b);
  });

  it("areaNameKo가 complex보다 우선한다", () => {
    expect(publicVillaLabel({ complex: "Sonasea", areaNameKo: "쏘나씨", bedrooms: 4, hasPool: true })).toBe(
      "푸꾸옥 쏘나씨 4베드 프라이빗 풀빌라"
    );
  });

  it("단지가 없으면 지역 토큰을 생략한다", () => {
    expect(publicVillaLabel({ bedrooms: 3, hasPool: true })).toBe("푸꾸옥 3베드 프라이빗 풀빌라");
  });

  it("풀이 없으면 '빌라'로 낮춘다", () => {
    expect(publicVillaLabel({ complex: "Sonasea", bedrooms: 3, hasPool: false })).toBe(
      "푸꾸옥 Sonasea 3베드 빌라"
    );
  });

  it("고유 실명은 라벨에 절대 등장하지 않는다", () => {
    assertNoRealName(publicVillaLabel({ complex: "Sonasea", areaNameKo: "쏘나씨", bedrooms: 3, hasPool: true }));
  });
});

describe("생성기 프롬프트 빌더 — 고유 실명 미포함", () => {
  it("유튜브 메타 프롬프트에 실명이 없다", () => {
    assertNoRealName(buildMetaPrompt(V));
  });

  it("인스타 캡션 프롬프트에 실명이 없다", () => {
    assertNoRealName(buildCaptionPrompt(V, "VILLA_SHOWCASE"));
    assertNoRealName(buildCaptionPrompt(V, "SERVICE"));
  });

  it("SEO 소개문 생성 프롬프트에 실명이 없다 (공개 description으로 렌더됨)", () => {
    const facts: VillaDescriptionFacts = {
      complex: "Sonasea",
      areaNameKo: "쏘나씨",
      bedrooms: 3,
      bathrooms: 4,
      maxGuests: 8,
      areaSqm: 320,
      floors: 2,
      hasPool: true,
      breakfastAvailable: true,
      beachDistanceM: 300,
      parkingSlots: 2,
      petsAllowed: false,
      smokingAllowed: false,
      partyAllowed: false,
      extraBedAvailable: true,
      featureKeys: ["privatePool", "viewSea"],
      photoSpaces: ["침실", "수영장", "거실"],
    };
    const prompt = buildVillaDescriptionPrompt(facts);
    assertNoRealName(prompt);
    // 지역·특징 표시명은 들어간다 — 실명만 없다.
    expect(prompt).toContain("빌라: 푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라");
  });

  it("나레이션 프롬프트에 실명이 없다", () => {
    const ctx: NarrationVillaContext = {
      complex: "Sonasea",
      areaNameKo: "쏘나씨",
      bedrooms: 3,
      hasPool: true,
      beachDistanceM: 300,
      clips: [
        { space: "POOL", note: null },
        { space: "BEDROOM", note: "마스터 침실" },
      ],
    };
    assertNoRealName(buildNarrationPrompt(ctx));
  });

  it("영문 단지만 있어도 나레이션 프롬프트는 실명을 만들지 않는다(TTS 한글 읽기 적용)", () => {
    const ctx: NarrationVillaContext = {
      complex: "Sonasea",
      bedrooms: 3,
      hasPool: true,
      clips: [{ space: "POOL", note: null }],
    };
    const prompt = buildNarrationPrompt(ctx);
    assertNoRealName(prompt);
    // 영문 단지는 소리 나는 대로(소나시)로 들어간다 — 고유 실명은 여전히 없다.
    expect(prompt).toContain("단지: 소나시");
  });
});

describe("영상 글(category=video) 생성 경로 — 고유 실명 미포함 (ADR-0049 §9)", () => {
  // 원천 쇼츠 제목에는 고유 실명이 없다(PR #440 산출물)지만, 실명이 섞인 오염 입력이 들어와도
  // 프롬프트·title·slug 어디에도 새지 않는지 방어적으로 검증한다.
  const villaCtx = {
    publicLabel: "푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라",
    complex: "Sonasea",
    areaName: "Sonasea",
    areaNameKo: "쏘나씨",
    bedrooms: 3,
    bathrooms: 4,
    maxGuests: 8,
    hasPool: true,
    breakfastAvailable: true,
    beachDistanceM: 300,
    featureKeys: ["privatePool", "viewSea"],
    photos: [{ id: "1", url: "u", space: "POOL", spaceLabel: "수영장" }],
  };
  const input: VideoArticleInput = {
    villa: villaCtx,
    short: {
      shortId: "cmrxnllra0001ukng3tqiwj5v",
      ytVideoId: "dKxCN6DzMq4",
      title: "영상 제목",
      posterUrl: null,
      durationSec: 88,
      publishedAt: new Date("2026-07-23T00:00:00Z"),
      clipSpaces: ["POOL", "BEDROOM"],
    },
  };

  it("영상 글 생성 프롬프트에 실명이 없다 (지역·특징 표시명만)", () => {
    const prompt = buildVideoArticlePrompt(input);
    assertNoRealName(prompt);
    expect(prompt).toContain("빌라: 푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라");
  });

  it("영상 글 title에 실명이 없다 (publicLabel 기반)", () => {
    assertNoRealName(buildVideoArticleTitle(input.villa));
    expect(buildVideoArticleTitle(input.villa)).toContain("푸꾸옥 쏘나씨 3베드 프라이빗 풀빌라");
  });

  it("영상 글 slug(topicKey=video-<shortId>)에 실명 토큰이 없다", () => {
    const slug = buildArticleSlug(videoTopicKey(input.short.shortId));
    expect(slug).toBe("video-cmrxnllra0001ukng3tqiwj5v");
    for (const t of REAL_NAME_TOKENS) expect(slug.toLowerCase()).not.toContain(t);
  });

  it("입력 컨텍스트 타입(VideoArticleVillaContext)에 name/nameVi 키가 구조적으로 없다 (DTO 봉인)", () => {
    // PublicVilla에서 name/nameVi가 이미 제거된 상태 — toVideoArticleVillaContext는 그 부분집합만 통과시킨다.
    const pub = {
      ...villaCtx,
      id: "villa_1",
      slug: "sonasea-3br-villa-x",
      publicListedAt: new Date(),
      updatedAt: new Date(),
      commonBathrooms: 1,
      areaSqm: 320,
      floors: 2,
      extraBedAvailable: true,
      checkInTime: 840,
      checkOutTime: 660,
      smokingAllowed: false,
      petsAllowed: false,
      partyAllowed: false,
      parkingSlots: 2,
      description: "설명",
      features: [],
      videos: [],
    } as unknown as PublicVilla;
    const ctx = toVideoArticleVillaContext(pub);
    const obj = JSON.parse(JSON.stringify(ctx));
    expect("name" in obj).toBe(false);
    expect("nameVi" in obj).toBe(false);
    expect(typeof obj.publicLabel).toBe("string");
  });
});

describe("buildPublicSlug — 실명 토큰 미포함", () => {
  it("단지+침실수+id 형식이며 고유 실명 토큰이 없다", () => {
    const slug = buildPublicSlug({ id: "abc12345xyz", complex: "Sonasea", bedrooms: 3 });
    expect(slug).toBe("sonasea-3br-villa-abc12345");
    for (const t of REAL_NAME_TOKENS) expect(slug).not.toContain(t);
  });

  it("단지가 없으면 id 폴백", () => {
    expect(buildPublicSlug({ id: "abc12345xyz", complex: null, bedrooms: 3 })).toBe("villa-abc12345");
  });
});

describe("toPublicVilla DTO — name/nameVi 부재, publicLabel 존재", () => {
  function makeRow(): PublicVillaRow {
    return {
      id: "villa_1",
      publicSlug: "sonasea-4br-villa-villa_1",
      publicListedAt: new Date("2026-07-22T00:00:00Z"),
      updatedAt: new Date("2026-07-22T00:00:00Z"),
      complex: "Sonasea",
      complexArea: { code: "sonasea", name: "Sonasea", nameKo: "쏘나씨" },
      bedrooms: 4,
      bathrooms: 5,
      commonBathrooms: 1,
      maxGuests: 10,
      areaSqm: 320,
      floors: 2,
      extraBedAvailable: true,
      hasPool: true,
      breakfastAvailable: true,
      beachDistanceM: 300,
      features: [{ featureKey: "privatePool" }],
      checkInTime: 840,
      checkOutTime: 660,
      smokingAllowed: false,
      petsAllowed: false,
      partyAllowed: false,
      parkingSlots: 2,
      description: "설명".repeat(50),
      photos: [],
      youtubeShorts: [],
    } as unknown as PublicVillaRow;
  }

  it("직렬화 DTO에 name·nameVi 키가 없고 publicLabel이 있다", () => {
    const dto = toPublicVilla(makeRow());
    expect(dto).not.toBeNull();
    const obj = JSON.parse(JSON.stringify(dto));
    expect("name" in obj).toBe(false);
    expect("nameVi" in obj).toBe(false);
    expect(typeof obj.publicLabel).toBe("string");
    expect(obj.publicLabel).toBe("푸꾸옥 쏘나씨 4베드 프라이빗 풀빌라");
  });
});
