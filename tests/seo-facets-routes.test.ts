// tests/seo-facets-routes.test.ts — 패싯 생성 가드·공개 경로 정책 (T-seo-s1)
//
// 여기서 지키는 것 2가지:
//  1) 얇은 콘텐츠 방지 — 매칭 3개 미만 패싯은 생성되지 않는다(신규 도메인 저품질 판정 차단)
//  2) 경로 정책 — 운영자·토큰·개인정보 경로가 크롤러에게 열리지 않는다
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  allFacetPages,
  areaFacets,
  featureFacets,
  guestFacets,
  bedroomFacets,
  areaFeatureFacets,
  filterByFacet,
  MIN_FACET_VILLAS,
  ALL_FEATURE_KEYS,
} from "@/lib/seo/facets";
import {
  PUBLIC_ALLOW_PATHS,
  PUBLIC_DISALLOW_PATHS,
  isPublicSeoPath,
  blogPaths,
  BLOG_ROOT,
} from "@/lib/seo/routes";
import { indexNowKey, pingIndexNow, DAILY_PING_LIMIT } from "@/lib/seo/indexnow";
import type { PublicVilla } from "@/lib/seo/public-villa";

// ── 픽스처 ──────────────────────────────────────────────────────────────────
let seq = 0;
function villa(over: Partial<PublicVilla> = {}): PublicVilla {
  seq += 1;
  return {
    id: `v${seq}`,
    slug: `villa-${seq}`,
    name: `빌라 ${seq}`,
    nameVi: null,
    complex: "Sonasea",
    areaCode: "sonasea",
    areaName: "Sonasea",
    areaNameKo: "쏘나씨",
    bedrooms: 4,
    bathrooms: 4,
    commonBathrooms: 1,
    maxGuests: 10,
    areaSqm: 300,
    floors: 2,
    extraBedAvailable: false,
    hasPool: true,
    breakfastAvailable: true,
    beachDistanceM: 300,
    featureKeys: ["privatePool"],
    checkInTime: 840,
    checkOutTime: 660,
    smokingAllowed: false,
    petsAllowed: false,
    partyAllowed: false,
    parkingSlots: 2,
    description: "설명",
    photos: [],
    updatedAt: new Date("2026-07-22T00:00:00Z"),
    publicListedAt: new Date("2026-07-22T00:00:00Z"),
    ...over,
  };
}

describe("패싯 생성 가드 — 얇은 콘텐츠 방지", () => {
  it(`매칭 ${MIN_FACET_VILLAS}개 미만이면 지역 패싯을 만들지 않는다`, () => {
    const few = [villa(), villa()]; // 2개
    expect(areaFacets(few)).toEqual([]);
  });

  it(`매칭 ${MIN_FACET_VILLAS}개 이상이면 지역 패싯을 만든다`, () => {
    const enough = [villa(), villa(), villa()];
    const facets = areaFacets(enough);
    expect(facets).toHaveLength(1);
    expect(facets[0].path).toBe(blogPaths.area("sonasea"));
    expect(facets[0].count).toBe(3);
  });

  it("빌라 0개여도 안전하게 빈 배열을 반환한다 (현 운영 상태)", () => {
    expect(allFacetPages([])).toEqual([]);
  });

  it("빌라 2개 시점에는 패싯이 하나도 생성되지 않는다 — 의도된 동작", () => {
    expect(allFacetPages([villa(), villa()])).toEqual([]);
  });

  it("사전에 없는 임의 featureKey는 패싯이 되지 않는다 (URL 주입 차단)", () => {
    const evil = [
      villa({ featureKeys: ["../../etc/passwd"] }),
      villa({ featureKeys: ["../../etc/passwd"] }),
      villa({ featureKeys: ["../../etc/passwd"] }),
    ];
    expect(featureFacets(evil)).toEqual([]);
  });

  it("사전에 있는 featureKey만 패싯이 된다", () => {
    expect(ALL_FEATURE_KEYS).toContain("privatePool");
    const three = [villa(), villa(), villa()];
    const paths = featureFacets(three).map((f) => f.path);
    expect(paths).toContain(blogPaths.feature("privatePool"));
  });

  it("인원·침실 패싯은 '이상' 의미로 매칭된다", () => {
    const villas = [villa({ maxGuests: 12, bedrooms: 5 }), villa({ maxGuests: 10, bedrooms: 4 }), villa({ maxGuests: 8, bedrooms: 4 })];
    const guests = guestFacets(villas).map((f) => f.params.guests);
    expect(guests).toContain(4); // 3곳 모두 4인 이상
    expect(guests).not.toContain(12); // 12인 이상은 1곳뿐 → 미생성
    const beds = bedroomFacets(villas).map((f) => f.params.bedrooms);
    expect(beds).toContain(4);
    expect(beds).not.toContain(5);
  });

  it("2단 조합은 두 패싯이 모두 살아있고 교집합도 하한을 넘을 때만 생성된다", () => {
    const villas = [villa(), villa(), villa()];
    const combos = areaFeatureFacets(villas);
    expect(combos.map((c) => c.path)).toContain(blogPaths.areaFeature("sonasea", "privatePool"));
  });

  it("★ 날짜(공실) 패싯은 존재하지 않는다 — 원칙 1", () => {
    const villas = [villa(), villa(), villa()];
    const kinds = new Set(allFacetPages(villas).map((f) => f.kind));
    for (const banned of ["date", "checkIn", "checkOut", "availability"]) {
      expect(kinds.has(banned as never)).toBe(false);
    }
    const paths = allFacetPages(villas).map((f) => f.path).join(" ");
    expect(paths).not.toMatch(/date|check-?in|check-?out|availab/i);
  });

  it("filterByFacet은 패싯 조건대로 정확히 거른다", () => {
    const villas = [villa({ maxGuests: 12 }), villa({ maxGuests: 6, featureKeys: [] })];
    expect(filterByFacet(villas, { guests: 10 })).toHaveLength(1);
    expect(filterByFacet(villas, { feature: "privatePool" })).toHaveLength(1);
    expect(filterByFacet(villas, { area: "vinpearl" })).toHaveLength(0);
  });
});

describe("공개 경로 정책", () => {
  it("운영자 빌라 목록(/villas)은 색인 금지 — 공개 빌라는 /blog/villa/*", () => {
    expect(PUBLIC_DISALLOW_PATHS).toContain("/villas");
    expect(blogPaths.villa("x")).toBe("/blog/villa/x");
  });

  it("토큰 경로(/p·/g)와 명함(/card)은 색인 금지", () => {
    for (const p of ["/p/", "/g/", "/card/"]) expect(PUBLIC_DISALLOW_PATHS).toContain(p);
  });

  it("허용 경로와 금지 경로가 겹치지 않는다", () => {
    for (const allow of PUBLIC_ALLOW_PATHS) {
      if (allow === "/") continue; // 루트는 allow, 하위는 개별 disallow — 정상
      expect(PUBLIC_DISALLOW_PATHS).not.toContain(allow);
    }
  });

  it("공개 트리 판정은 루트와 /blog 하위만 true", () => {
    expect(isPublicSeoPath("/")).toBe(true);
    expect(isPublicSeoPath(BLOG_ROOT)).toBe(true);
    expect(isPublicSeoPath("/blog/villa/abc")).toBe(true);
    expect(isPublicSeoPath("/dashboard")).toBe(false);
    expect(isPublicSeoPath("/my-villas")).toBe(false);
  });
});

describe("IndexNow", () => {
  const origKey = process.env.INDEXNOW_KEY;
  const origBase = process.env.SEO_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.SEO_PUBLIC_BASE_URL = "https://villa-go.net";
  });
  afterEach(() => {
    process.env.INDEXNOW_KEY = origKey;
    process.env.SEO_PUBLIC_BASE_URL = origBase;
    vi.restoreAllMocks();
  });

  it("키 미설정이면 아무 요청도 보내지 않는다", async () => {
    delete process.env.INDEXNOW_KEY;
    const spy = vi.spyOn(globalThis, "fetch");
    expect(indexNowKey()).toBeNull();
    expect(await pingIndexNow(["/blog/villa/a"])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("네이버·Bing 두 엔드포인트에 같은 페이로드를 보낸다", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const res = await pingIndexNow(["/blog/villa/a"]);
    expect(res.map((r) => r.endpoint).sort()).toEqual(["bing", "naver"]);
    expect(spy).toHaveBeenCalledTimes(2);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.host).toBe("villa-go.net");
    expect(body.urlList).toEqual(["https://villa-go.net/blog/villa/a"]);
    expect(body.keyLocation).toBe("https://villa-go.net/indexnow-key.txt");
  });

  it("다른 호스트 URL은 제출 목록에서 제거한다 (요청 전체 거부 방지)", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await pingIndexNow(["https://evil.example/x", "/blog/ok"]);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.urlList).toEqual(["https://villa-go.net/blog/ok"]);
  });

  it("네트워크 실패해도 throw하지 않는다 (발행 트랜잭션 보호)", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const res = await pingIndexNow(["/blog/ok"]);
    expect(res.every((r) => r.ok === false)).toBe(true);
  });

  it("일 핑 상한이 점진 발행 정책값으로 정의돼 있다", () => {
    expect(DAILY_PING_LIMIT).toBe(5);
  });
});

describe("절대 URL 해석 — 빌드타임 env 구움 방지 회귀", () => {
  const orig = { seo: process.env.SEO_PUBLIC_BASE_URL, villa: process.env.VILLA_PUBLIC_BASE_URL, na: process.env.NEXTAUTH_URL };
  afterEach(() => {
    process.env.SEO_PUBLIC_BASE_URL = orig.seo;
    process.env.VILLA_PUBLIC_BASE_URL = orig.villa;
    process.env.NEXTAUTH_URL = orig.na;
  });

  it("SEO_PUBLIC_BASE_URL이 최우선이고 후행 슬래시를 제거한다", async () => {
    const { seoBaseUrl, absoluteUrl } = await import("@/lib/seo/base-url");
    process.env.SEO_PUBLIC_BASE_URL = "https://villa-go.net/";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    expect(seoBaseUrl()).toBe("https://villa-go.net");
    expect(absoluteUrl("/sitemap.xml")).toBe("https://villa-go.net/sitemap.xml");
  });

  it("★ robots는 요청 시점 env로 sitemap 링크를 만든다 (localhost 구움 회귀 방지)", async () => {
    const robots = (await import("@/app/robots")).default;
    process.env.SEO_PUBLIC_BASE_URL = "https://villa-go.net";
    const r = robots();
    expect(r.sitemap).toBe("https://villa-go.net/sitemap.xml");
    expect(r.host).toBe("villa-go.net"); // 스킴·슬래시 없는 호스트명
  });

  it("robots.ts는 force-dynamic으로 선언돼 있다", async () => {
    const mod = await import("@/app/robots");
    expect((mod as { dynamic?: string }).dynamic).toBe("force-dynamic");
  });
});

describe("IndexNow — 네이버 루트 URL 거부 대응 (프로덕션 실측 2026-07-22)", () => {
  const origKey = process.env.INDEXNOW_KEY;
  const origBase = process.env.SEO_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.SEO_PUBLIC_BASE_URL = "https://villa-go.net";
    process.env.INDEXNOW_KEY = "a".repeat(32);
  });
  afterEach(() => {
    process.env.INDEXNOW_KEY = origKey;
    process.env.SEO_PUBLIC_BASE_URL = origBase;
    vi.restoreAllMocks();
  });

  function bodiesByEndpoint(spy: ReturnType<typeof vi.spyOn>) {
    const out: Record<string, string[]> = {};
    for (const call of spy.mock.calls) {
      const url = String(call[0]);
      const name = url.includes("naver") ? "naver" : "bing";
      out[name] = JSON.parse((call[1] as RequestInit).body as string).urlList;
    }
    return out;
  }

  it("★ 루트가 섞여도 네이버 제출분에서만 제거하고, Bing에는 그대로 보낸다", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await pingIndexNow(["/", "/blog/villa/a"]);
    const bodies = bodiesByEndpoint(spy);
    expect(bodies.naver).toEqual(["https://villa-go.net/blog/villa/a"]); // 루트 제거
    expect(bodies.bing).toEqual(["https://villa-go.net/", "https://villa-go.net/blog/villa/a"]);
  });

  it("루트만 제출하려 하면 네이버 호출 자체를 건너뛴다(배치 전체 422 방지)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const res = await pingIndexNow(["/"]);
    expect(spy).toHaveBeenCalledTimes(1); // bing만
    const naver = res.find((r) => r.endpoint === "naver");
    expect(naver?.skipped).toBe(true);
    expect(naver?.ok).toBe(true); // 스킵은 실패가 아니다
  });
});

describe("빌라 공개 준비 (T-seo-s2)", () => {
  it("슬러그 충돌 시 접미 번호를 붙인다", async () => {
    const taken = new Set(["sonasea-v3b", "sonasea-v3b-2"]);
    const db = {
      villa: {
        findFirst: async (args: { where: { publicSlug: string } }) =>
          taken.has(args.where.publicSlug) ? { id: "other" } : null,
      },
    } as never;
    const { ensureUniquePublicSlug } = await import("@/lib/seo/villa-prep");
    expect(await ensureUniquePublicSlug({ id: "abc123", name: "쏘나씨 V3B", nameVi: "Sonasea V3B" }, db)).toBe(
      "sonasea-v3b-3"
    );
  });

  it("공개 조건은 4가지를 모두 충족해야 한다", async () => {
    const { evaluatePrep } = await import("@/lib/seo/villa-prep");
    const base = {
      status: "ACTIVE",
      isSellable: true,
      publicSlug: "s",
      description: "가".repeat(600),
      photoCount: 8,
    };
    expect(evaluatePrep(base).eligible).toBe(true);
    expect(evaluatePrep({ ...base, publicSlug: null }).eligible).toBe(false);
    expect(evaluatePrep({ ...base, description: "짧음" }).eligible).toBe(false);
    expect(evaluatePrep({ ...base, photoCount: 7 }).eligible).toBe(false);
    expect(evaluatePrep({ ...base, isSellable: false }).eligible).toBe(false);
    expect(evaluatePrep({ ...base, status: "DRAFT" }).eligible).toBe(false);
  });

  it("★ 소개문 프롬프트에 가격·주소·공급자 지시가 금지로 들어간다", async () => {
    const { buildVillaDescriptionPrompt } = await import("@/lib/seo/villa-prep");
    const p = buildVillaDescriptionPrompt({
      name: "V1", complex: "Sonasea", areaNameKo: "쏘나씨", bedrooms: 4, bathrooms: 4,
      maxGuests: 10, areaSqm: null, floors: null, hasPool: true, breakfastAvailable: false,
      beachDistanceM: 300, parkingSlots: 2, petsAllowed: false, smokingAllowed: false,
      partyAllowed: false, extraBedAvailable: false, featureKeys: ["privatePool"], photoSpaces: ["외관"],
    });
    expect(p).toContain("가격·요금·금액을 절대 쓰지 마라");
    expect(p).toContain("상세 주소·소유자·관리인 정보를 쓰지 마라");
    expect(p).toContain("위에 없는 사실을 지어내지 마라");
    // 사실 목록에 원가·판매가가 섞여 들어가지 않는다
    expect(p).not.toMatch(/원가|판매가|마진|VND|KRW/);
  });

  it("자동 공개 스위치는 기본 off (조회 실패·미설정 모두 false)", async () => {
    const { isAutoListEnabled } = await import("@/lib/seo/villa-prep");
    expect(await isAutoListEnabled({ appSetting: { findUnique: async () => null } } as never)).toBe(false);
    expect(
      await isAutoListEnabled({ appSetting: { findUnique: async () => ({ value: "0" }) } } as never)
    ).toBe(false);
    expect(
      await isAutoListEnabled({ appSetting: { findUnique: async () => ({ value: "1" }) } } as never)
    ).toBe(true);
  });
});
