// tests/seo-place-article.test.ts — 푸꾸옥 장소 소개 글 (T-seo-place-article)
//
// 여기서 지키는 것:
//  1) ★ 지어내기 방지 — 등록된 장소만 프롬프트에 들어가고, 인상(oneLiner)이 없으면 글을 만들지 않는다
//  2) ★ 변하는 정보 배제 — 영업시간·가격·전화 필드가 재료에 **존재하지 않는다**
//  3) 3곳 미만이면 만들지 않는다(얇은 글 방지) · 이미 소개한 장소는 다시 나오지 않는다
//  4) 회차가 이어진다(1편·2편…) — 유일하게 고갈되지 않는 글감
import { describe, it, expect } from "vitest";
import {
  PLACE_CATEGORIES,
  MIN_PLACES_PER_ARTICLE,
  MAX_PLACES_PER_ARTICLE,
  placeCategory,
  placeTopicKey,
  hasEnoughPlaceFacts,
  buildPlaceArticlePrompt,
  buildPlaceArticleTitle,
  pickPlacePhotos,
  tidyHeadings,
  orderSinglePlacePhotos,
  spreadImages,
  getPlaceCandidates,
  type PlaceRow,
} from "@/lib/seo/place-article";
import type { DbClient } from "@/lib/availability";

const place = (over: Partial<PlaceRow> & { id: string; category: string }): PlaceRow =>
  ({
    name: over.name ?? "쭈옌 반쎄오",
    nameLocal: over.nameLocal ?? null,
    area: over.area ?? "즈엉동 시내",
    oneLiner: over.oneLiner ?? "현지인이 많고 반쎄오가 바삭하다. 자리가 좁아 4명까지가 편하다",
    tips: over.tips ?? null,
    photos: over.photos ?? [],
    ...over,
  }) as PlaceRow;

const threePlaces = [
  place({ id: "p1", category: "cafe", name: "카페 A" }),
  place({ id: "p2", category: "cafe", name: "카페 B" }),
  place({ id: "p3", category: "cafe", name: "카페 C" }),
];

function makeDb(rows: PlaceRow[], articleCounts: Record<string, number> = {}) {
  return {
    seoPlace: {
      findMany: async () => rows,
    },
    seoArticle: {
      count: async (args: { where: { topicKey: { startsWith: string } } }) =>
        articleCounts[args.where.topicKey.startsWith] ?? 0,
    },
  } as unknown as DbClient;
}

describe("생성 조건", () => {
  it("장소가 없으면 후보 0 — 장소 글 단계는 no-op다", async () => {
    expect(await getPlaceCandidates(makeDb([]))).toEqual([]);
  });

  it("같은 종류 3곳 미만이면 만들지 않는다", async () => {
    const db = makeDb([place({ id: "p1", category: "cafe" }), place({ id: "p2", category: "cafe" })]);
    expect(await getPlaceCandidates(db)).toEqual([]);
  });

  it("3곳이 모이면 후보가 된다", async () => {
    const out = await getPlaceCandidates(makeDb(threePlaces));
    expect(out).toHaveLength(1);
    expect(out[0].category.key).toBe("cafe");
    expect(out[0].seq).toBe(1);
    expect(out[0].places.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("★ 인상(oneLiner)이 빈 장소가 섞이면 만들지 않는다 — 그 자리를 AI가 채우면 지어내기가 된다", () => {
    const withEmpty = [...threePlaces.slice(0, 2), place({ id: "p3", category: "cafe", oneLiner: "   " })];
    expect(hasEnoughPlaceFacts(withEmpty)).toBe(false);
  });

  it("재료가 얇으면(합계 120자 미만) 만들지 않는다", () => {
    const thin = ["a", "b", "c"].map((id) =>
      place({ id, category: "shop", name: "샵", area: null, oneLiner: "좋다" })
    );
    expect(hasEnoughPlaceFacts(thin)).toBe(false);
  });

  it("한 편에 최대 5곳까지만 묶는다", async () => {
    const many = Array.from({ length: 8 }, (_, i) => place({ id: `p${i}`, category: "restaurant" }));
    const out = await getPlaceCandidates(makeDb(many));
    expect(out[0].places).toHaveLength(MAX_PLACES_PER_ARTICLE);
  });

  it("회차가 이어진다 — 이미 2편 나갔으면 다음은 3편", async () => {
    const out = await getPlaceCandidates(makeDb(threePlaces, { "place-cafe-": 2 }));
    expect(out[0].seq).toBe(3);
    expect(placeTopicKey("cafe", 3)).toBe("place-cafe-3");
    expect(buildPlaceArticleTitle(placeCategory("cafe")!, threePlaces, 3)).toBe("푸꾸옥 카페 3곳 — 직접 가본 곳만 (3편)");
  });

  it("1편 제목에는 회차 표기가 없다", () => {
    expect(buildPlaceArticleTitle(placeCategory("restaurant")!, threePlaces, 1)).toBe("푸꾸옥 맛집 3곳 — 직접 가본 곳만");
  });

  it("★ 한 곳만 다루는 글은 가게 이름이 제목에 온다 — '맛집 1곳'은 아무도 검색하지 않는다", () => {
    const one = [place({ id: "p1", category: "restaurant", name: "메오키친", area: "즈엉동" })];
    // 꼬리말은 가게 이름 씨앗으로 결정적으로 골라진다("메오키친" → "먹어보고 정리했습니다").
    expect(buildPlaceArticleTitle(placeCategory("restaurant")!, one, 1)).toBe(
      "메오키친 — 푸꾸옥 즈엉동 맛집, 먹어보고 정리했습니다"
    );
  });

  it("★ 꼬리말이 글마다 달라진다 — 전부 '직접 가보고 적는다'로 끝나면 자동 생성 티가 난다(테오 지적 2026-07-24)", () => {
    const names = ["메오키친", "카페 A", "카페 B", "카페 C", "가든 비스트로"];
    const suffixes = names.map((name) => {
      const t = buildPlaceArticleTitle(placeCategory("restaurant")!, [place({ id: name, category: "restaurant", name })], 1);
      return t.split(", ").pop()!;
    });
    // 최소 3종류 이상으로 갈린다(5개 후보 풀에서 이름 해시로 분산).
    expect(new Set(suffixes).size).toBeGreaterThanOrEqual(3);
  });

  it("★ 카테고리에 따라 동사가 바뀐다 — 맛집은 먹어보고, 쇼핑은 둘러보고, 명소는 가보고", () => {
    const seedName = "테스트 장소"; // 같은 씨앗이라 풀 선택만 카테고리로 갈린다
    const suffixOf = (categoryKey: string) => {
      const t = buildPlaceArticleTitle(placeCategory(categoryKey)!, [place({ id: "x", category: categoryKey, name: seedName })], 1);
      return t.split(", ").pop()!;
    };
    expect(suffixOf("restaurant")).toMatch(/먹|맛|후기|정리/);
    expect(suffixOf("shop")).toMatch(/둘러|발품|후기|정리/);
    expect(suffixOf("spot")).toMatch(/가|다녀|보고|후기|정리/);
  });

  it("★ 같은 가게는 언제나 같은 꼬리말 — 재생성해도 제목이 흔들리지 않는다", () => {
    const one = [place({ id: "p1", category: "cafe", name: "안정성 카페", area: "즈엉동" })];
    const a = buildPlaceArticleTitle(placeCategory("cafe")!, one, 1);
    const b = buildPlaceArticleTitle(placeCategory("cafe")!, one, 1);
    expect(a).toBe(b);
  });
});

describe("★ 지어내기·변하는 정보 방지", () => {
  it("프롬프트에 등록된 장소만 들어가고 목록 밖 언급을 금지한다", () => {
    const prompt = buildPlaceArticlePrompt(placeCategory("cafe")!, threePlaces);
    expect(prompt).toContain("카페 A");
    expect(prompt).toContain("이 목록 밖의 가게는 절대 언급하지 마라");
    expect(prompt).toContain("위에 없는 사실을 추가하지 마라");
  });

  it("영업시간·가격·전화 금지가 프롬프트에 명시된다", () => {
    const prompt = buildPlaceArticlePrompt(placeCategory("cafe")!, threePlaces);
    expect(prompt).toContain("영업시간·휴무일·가격·예산·전화번호를 쓰지 마라");
  });

  it("장소 재료에 영업시간·가격·전화 필드 자체가 없다", () => {
    const keys = Object.keys(threePlaces[0]);
    for (const forbidden of ["openHours", "price", "phone", "budget", "closedDay"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("지도 링크는 프롬프트에 들어가지 않는다(본문 미노출)", () => {
    const withMap = threePlaces.map((p) => ({ ...p, mapUrl: "https://maps.app.goo.gl/xxx" }) as PlaceRow);
    expect(buildPlaceArticlePrompt(placeCategory("cafe")!, withMap)).not.toContain("maps.app.goo.gl");
  });
});

describe("사진·카테고리", () => {
  it("장소당 1장씩, 중복 URL은 건너뛴다", () => {
    const photos = pickPlacePhotos([
      place({
        id: "p1",
        category: "cafe",
        name: "카페 A",
        photos: [{ id: "m1", url: "https://cdn.r2.dev/a.jpg", alt: "카페 A 내부", caption: null }],
      } as Partial<PlaceRow> & { id: string; category: string }),
      place({
        id: "p2",
        category: "cafe",
        name: "카페 B",
        photos: [{ id: "m2", url: "https://cdn.r2.dev/a.jpg", alt: "중복", caption: null }],
      } as Partial<PlaceRow> & { id: string; category: string }),
      place({ id: "p3", category: "cafe", name: "카페 C", photos: [] } as Partial<PlaceRow> & {
        id: string;
        category: string;
      }),
    ]);
    // pickPlacePhotos는 워터마크 파생본 캐시 갱신을 위해 mediaId·watermarkedUrl을 함께 싣는다
    // (place-article: cover/워터마크 경로가 사진 id를 필요로 함). caption은 없으면 가게명으로 채운다.
    expect(photos).toEqual([
      { url: "https://cdn.r2.dev/a.jpg", alt: "카페 A 내부", caption: "카페 A", mediaId: "m1", watermarkedUrl: null },
    ]);
  });

  it("카테고리 키는 slug로 쓸 수 있고 중복이 없다", () => {
    for (const c of PLACE_CATEGORIES) expect(c.key).toMatch(/^[a-z]+$/);
    expect(new Set(PLACE_CATEGORIES.map((c) => c.key)).size).toBe(PLACE_CATEGORIES.length);
    expect(MIN_PLACES_PER_ARTICLE).toBeLessThanOrEqual(MAX_PLACES_PER_ARTICLE);
  });
});

describe("소제목 다듬기 (T-seo-ux-fix 실측 교훈)", () => {
  it("★ 프롬프트 뼈대가 소제목에 그대로 나온 것을 지운다", () => {
    const out = tidyHeadings([
      { type: "h2", text: "① 어떤 곳인가요?" },
      { type: "h2", text: "2) 무엇을 먹으러 가나" },
      { type: "p", text: "① 이 문단의 번호는 건드리지 않는다" },
    ]);
    expect(out).toEqual([
      { type: "h2", text: "어떤 곳인가요" },
      { type: "h2", text: "무엇을 먹으러 가나" },
      { type: "p", text: "① 이 문단의 번호는 건드리지 않는다" },
    ]);
  });

  it("정상 소제목은 그대로 둔다", () => {
    expect(tidyHeadings([{ type: "h2", text: "반세오와 할아버지 맥주" }])).toEqual([
      { type: "h2", text: "반세오와 할아버지 맥주" },
    ]);
  });
});

describe("사진 역할 기반 선택 (메오키친 실측 교훈)", () => {
  const ph = (id: string, kind: string | null, alt = id) => ({ id, url: `https://cdn.r2.dev/${id}.jpg`, alt, caption: null, kind });

  it("★ 등록 순서가 입구·입구2·주방·메뉴판이어도 음식 사진이 먼저 들어간다", () => {
    const photos = [
      ph("입구", "exterior"), ph("입구2", "exterior"), ph("주방", "interior"),
      ph("메뉴1", "menu"), ph("메뉴3", "menu"), ph("메뉴4", "menu"),
      ph("꼬치", "food"), ph("반세오", "food"), ph("반미", "food"),
    ];
    const out = orderSinglePlacePhotos(photos, 6).map((p) => p.id);
    expect(out[0]).toBe("입구"); // 커버는 외관
    expect(out).toContain("반세오");
    expect(out).toContain("반미");
    expect(out).toContain("꼬치");
    expect(out.filter((x) => x.startsWith("메뉴")).length).toBeLessThanOrEqual(1); // 메뉴판 도배 방지
  });

  it("역할 미지정 사진만 있어도 등록 순서대로 동작한다", () => {
    const photos = [ph("a", null), ph("b", null), ph("c", null)];
    expect(orderSinglePlacePhotos(photos, 2).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("사진을 문단 사이에 고르게 흩뿌린다 — 소제목 수가 사진 상한이 되지 않는다", () => {
    const blocks = [
      { type: "p", text: "리드" }, { type: "h2", text: "가" }, { type: "p", text: "1" }, { type: "p", text: "2" },
      { type: "h2", text: "나" }, { type: "p", text: "3" }, { type: "p", text: "4" },
    ];
    const imgs = [
      { url: "https://cdn.r2.dev/1.jpg", alt: "a" },
      { url: "https://cdn.r2.dev/2.jpg", alt: "b" },
      { url: "https://cdn.r2.dev/3.jpg", alt: "c" },
      { url: "https://cdn.r2.dev/4.jpg", alt: "d" },
    ];
    const out = spreadImages(blocks, imgs);
    expect(out.filter((b) => b.type === "img")).toHaveLength(4); // 한 장도 버리지 않는다
    expect(out.filter((b) => b.type !== "img")).toEqual(blocks); // 본문은 그대로
  });
});
