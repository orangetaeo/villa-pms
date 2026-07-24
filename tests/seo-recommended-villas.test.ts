// tests/seo-recommended-villas.test.ts — 블로그 글 하단 "추천 빌라" 선정 로직
//
// 검증 축 2가지:
//   1) getPublicVillasByIds — 공개 게이트 상속 + 발행 자격 하한 + 입력 순서 보존
//   2) getRecommendedVillas — 글 성격별(place·villa·guide) 출처 우선순위 + 억지 추천 금지(빈 배열)
// ★ 카드 렌더 필드에 가격·공급자·정확주소가 없음을 함께 확인한다(공개 경계 승계).
import { describe, it, expect } from "vitest";
import {
  getPublicVillasByIds,
  MIN_PUBLIC_PHOTOS,
  MIN_PUBLIC_BODY_CHARS,
  type PublicVillaRow,
} from "@/lib/seo/public-villa";
import { getRecommendedVillas } from "@/lib/seo/recommended-villas";
import type { DbClient } from "@/lib/availability";

// ── 픽스처 ──────────────────────────────────────────────────────────────────
function makeRow(over: Partial<PublicVillaRow> = {}): PublicVillaRow {
  const photos = Array.from({ length: MIN_PUBLIC_PHOTOS }, (_, i) => ({
    id: `p${i}`,
    url: `https://cdn.example/p${i}.jpg`,
    space: "BEDROOM" as never,
    spaceLabel: null,
    sortOrder: i,
  }));
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
    description: "가".repeat(MIN_PUBLIC_BODY_CHARS),
    photos,
    youtubeShorts: [],
    ...over,
  } as PublicVillaRow;
}

/**
 * DB 근사 스파이 — 실제 where를 존중한다.
 *   · villa.findMany: where.id.in 이 있으면 그 id만, 없으면 전체 rows(= getPublicVillas 경로)
 *   · seoPlace.findFirst: usedInArticleId 매칭 첫 장소
 * 모든 findMany 인자를 calls에 기록(게이트 검증용).
 */
function makeDb(rows: PublicVillaRow[], places: { usedInArticleId: string; area: string | null }[] = []) {
  const calls: { where: Record<string, unknown> }[] = [];
  const db = {
    villa: {
      findMany: async (args: { where: Record<string, unknown>; select: unknown }) => {
        calls.push({ where: args.where });
        const idClause = args.where.id as { in?: string[] } | undefined;
        if (idClause?.in) return rows.filter((r) => idClause.in!.includes(r.id));
        return rows;
      },
    },
    seoPlace: {
      findFirst: async (args: { where: { usedInArticleId?: string } }) => {
        const p = places.find((x) => x.usedInArticleId === args.where.usedInArticleId);
        return p ? { area: p.area } : null;
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

const FORBIDDEN = ["price", "krw", "vnd", "cost", "margin", "deposit", "rent", "supplier", "cleaner", "address", "googlemap", "wifi", "access"];
function hasForbiddenField(obj: unknown): string[] {
  const json = JSON.stringify(obj).toLowerCase();
  return FORBIDDEN.filter((f) => json.includes(`"${f}`)); // 키 이름으로만 판정(값 우연일치 배제)
}

describe("getPublicVillasByIds — 공개 게이트 + 입력 순서", () => {
  it("입력 id 순서를 보존한다", async () => {
    const rows = [
      makeRow({ id: "A", publicSlug: "a" }),
      makeRow({ id: "B", publicSlug: "b" }),
      makeRow({ id: "C", publicSlug: "c" }),
    ];
    const { db } = makeDb(rows);
    const out = await getPublicVillasByIds(["C", "A", "B"], db);
    expect(out.map((v) => v.id)).toEqual(["C", "A", "B"]);
  });

  it("발행 자격 미달(본문 하한 미만)은 제외한다", async () => {
    const rows = [
      makeRow({ id: "A", publicSlug: "a" }),
      makeRow({ id: "BAD", publicSlug: "bad", description: "짧음" }),
    ];
    const { db } = makeDb(rows);
    const out = await getPublicVillasByIds(["A", "BAD"], db);
    expect(out.map((v) => v.id)).toEqual(["A"]);
  });

  it("where에 공개 게이트(PUBLIC_WHERE) + id in 을 강제한다", async () => {
    const { db, calls } = makeDb([makeRow({ id: "A", publicSlug: "a" })]);
    await getPublicVillasByIds(["A"], db);
    const w = calls[0].where;
    expect(w.publicListed).toBe(true);
    expect(w.status).toBe("ACTIVE");
    expect(w.isSellable).toBe(true);
    expect(w.publicSlug).toEqual({ not: null });
    expect(w.id).toEqual({ in: ["A"] });
  });

  it("빈 id 목록이면 DB를 조회하지 않고 빈 배열", async () => {
    const { db, calls } = makeDb([makeRow()]);
    expect(await getPublicVillasByIds([], db)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("카드 DTO에 가격·공급자·정확주소 필드가 없다", async () => {
    const { db } = makeDb([makeRow({ id: "A", publicSlug: "a" })]);
    const out = await getPublicVillasByIds(["A"], db);
    expect(hasForbiddenField(out)).toEqual([]);
  });
});

describe("getRecommendedVillas — 글 성격별 출처", () => {
  it("villa 글: 같은 지역의 다른 빌라를 추천하고 자기 자신은 제외", async () => {
    const rows = [
      makeRow({ id: "SELF", publicSlug: "self", complexArea: { code: "sonasea", name: "Sonasea", nameKo: "쏘나씨" } }),
      makeRow({ id: "SIB1", publicSlug: "sib1", complexArea: { code: "sonasea", name: "Sonasea", nameKo: "쏘나씨" } }),
      makeRow({ id: "OTHER", publicSlug: "other", complexArea: { code: "sunset", name: "Sunset", nameKo: "선셋" } }),
    ];
    const { db } = makeDb(rows);
    const out = await getRecommendedVillas({ id: "art1", category: "villa", relatedVillaIds: ["SELF"] }, db);
    expect(out.map((v) => v.id)).toEqual(["SIB1"]);
  });

  it("place 글: 장소 area와 매칭되는 지역 빌라를 추천(자유텍스트 best-effort)", async () => {
    const rows = [
      makeRow({ id: "DD", publicSlug: "dd", complex: "Grand", complexArea: { code: "duong-dong", name: "Duong Dong", nameKo: "즈엉동" } }),
      makeRow({ id: "AT", publicSlug: "at", complex: "Palm", complexArea: { code: "an-thoi", name: "An Thoi", nameKo: "안터이" } }),
    ];
    const { db } = makeDb(rows, [{ usedInArticleId: "artPlace", area: "즈엉동" }]);
    const out = await getRecommendedVillas({ id: "artPlace", category: "place", relatedVillaIds: [] }, db);
    expect(out.map((v) => v.id)).toEqual(["DD"]);
  });

  it("guide 글: relatedVillaIds로 공개 빌라를 뽑는다", async () => {
    const rows = [
      makeRow({ id: "G1", publicSlug: "g1" }),
      makeRow({ id: "G2", publicSlug: "g2" }),
      makeRow({ id: "G3", publicSlug: "g3" }),
    ];
    const { db } = makeDb(rows);
    const out = await getRecommendedVillas({ id: "artGuide", category: "guide", relatedVillaIds: ["G2", "G1"] }, db);
    expect(out.map((v) => v.id)).toEqual(["G2", "G1"]);
  });

  it("최대 3장으로 자른다", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({ id: `X${i}`, publicSlug: `x${i}` }));
    const { db } = makeDb(rows);
    const out = await getRecommendedVillas(
      { id: "artGuide", category: "guide", relatedVillaIds: ["X0", "X1", "X2", "X3", "X4"] },
      db,
    );
    expect(out).toHaveLength(3);
  });

  it("아무것도 못 뽑으면 빈 배열(섹션 숨김) — 억지 추천 금지", async () => {
    const { db } = makeDb([]);
    // place인데 매칭 area 없음 + relatedVillaIds 없음
    const out = await getRecommendedVillas({ id: "artX", category: "place", relatedVillaIds: [] }, db);
    expect(out).toEqual([]);
  });

  it("villa 글: 같은 지역이 없으면 relatedVillaIds 폴백(자기 자신 제외)", async () => {
    const rows = [
      makeRow({ id: "SELF", publicSlug: "self", complexArea: { code: "sonasea", name: "Sonasea", nameKo: "쏘나씨" } }),
      makeRow({ id: "REL", publicSlug: "rel", complexArea: { code: "sunset", name: "Sunset", nameKo: "선셋" } }),
    ];
    const { db } = makeDb(rows);
    // SELF만 sonasea라 동일지역 없음 → 폴백에서 relatedVillaIds(SELF,REL) 중 SELF 제외 → [REL]
    const out = await getRecommendedVillas({ id: "art1", category: "villa", relatedVillaIds: ["SELF", "REL"] }, db);
    expect(out.map((v) => v.id)).toEqual(["REL"]);
  });
});
