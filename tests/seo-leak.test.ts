// tests/seo-leak.test.ts — 공개 SEO 경계 누수 방지 (T-seo-s1 §4.1 강제)
//
// 이 테스트가 실패하면 공개 페이지에 가격·공실·주소·공급자·출입정보가 샐 수 있다는 뜻이다.
// 실패를 "테스트 수정"으로 해결하지 말 것 — 화이트리스트(PUBLIC_VILLA_SELECT)를 되돌려야 한다.
import { describe, it, expect } from "vitest";
import {
  PUBLIC_VILLA_SELECT,
  toPublicVilla,
  isPublishable,
  buildPublicSlug,
  getPublicVillas,
  getPublicVillaBySlug,
  MIN_PUBLIC_PHOTOS,
  MIN_PUBLIC_BODY_CHARS,
  type PublicVillaRow,
} from "@/lib/seo/public-villa";
import type { DbClient } from "@/lib/availability";

// ── 금지 키 사전 — 계약 §4.1 ────────────────────────────────────────────────
/** 이 이름이 select·직렬화 결과 어디에도 등장해선 안 된다(대소문자 무시 부분일치). */
const FORBIDDEN_KEY_PATTERNS = [
  "price", "krw", "vnd", "cost", "margin", "deposit", "rent", "rate",
  "supplier", "cleaner",
  "address", "googlemap", "lat", "lng",
  "wifi", "access",
  // ⚠ "available" 통짜 금지는 breakfastAvailable·extraBedAvailable(정당한 공개 필드)를 오탐한다.
  //    공실(availability)만 정확히 막는다.
  "availability", "block", "booking", "calendar", "ical",
  "status", "sellable", "quality", "rejection",
];

/**
 * 객체 트리에서 **출력 키** 이름을 수집(중첩 select 포함).
 * ★ where·orderBy·take 같은 **조회 조건 절은 건너뛴다** — 필터에 status를 쓰는 것은 누수가 아니라
 *   오히려 게이트다(예: youtubeShorts where status=PUBLISHED). 우리가 막으려는 건 밖으로 나가는 필드다.
 */
const QUERY_CLAUSE_KEYS = new Set(["where", "orderBy", "take", "skip", "cursor", "distinct"]);

function collectKeys(obj: unknown, out: string[] = []): string[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out.push(k);
      if (QUERY_CLAUSE_KEYS.has(k)) continue; // 조건 절 내부는 출력이 아니다
      collectKeys(v, out);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v) => collectKeys(v, out));
  }
  return out;
}

function findForbidden(keys: string[]): string[] {
  return keys.filter((k) => FORBIDDEN_KEY_PATTERNS.some((p) => k.toLowerCase().includes(p)));
}

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
    publicSlug: "sonasea-v12",
    publicListedAt: new Date("2026-07-22T00:00:00Z"),
    updatedAt: new Date("2026-07-22T00:00:00Z"),
    name: "쏘나씨 V12",
    nameVi: "Sonasea V12",
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
    features: [{ featureKey: "privatePool" }, { featureKey: "viewSea" }],
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

/** where·select 인자를 포착하는 가짜 DbClient */
function makeSpyDb(rows: PublicVillaRow[]) {
  const calls: { where: unknown; select: unknown }[] = [];
  const db = {
    villa: {
      findMany: async (args: { where: unknown; select: unknown }) => {
        calls.push(args);
        return rows;
      },
      findFirst: async (args: { where: unknown; select: unknown }) => {
        calls.push(args);
        return rows[0] ?? null;
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

describe("공개 SEO 누수 방지 — PUBLIC_VILLA_SELECT 화이트리스트", () => {
  it("select에 금지 키가 하나도 없다", () => {
    const forbidden = findForbidden(collectKeys(PUBLIC_VILLA_SELECT));
    expect(forbidden).toEqual([]);
  });

  it("직렬화 결과(JSON)에 금지 키가 하나도 없다", () => {
    const dto = toPublicVilla(makeRow());
    expect(dto).not.toBeNull();
    const forbidden = findForbidden(collectKeys(JSON.parse(JSON.stringify(dto))));
    expect(forbidden).toEqual([]);
  });

  it("직렬화 결과에 금액으로 보이는 값이 없다 (VND/KRW 자릿수 스캔)", () => {
    const json = JSON.stringify(toPublicVilla(makeRow()));
    // 6자리 이상 연속 숫자 = 동/원 단위 금액 의심. 공개 DTO에는 존재할 이유가 없다.
    expect(json).not.toMatch(/\d{6,}/);
  });
});

describe("공개 조회 게이트", () => {
  it("getPublicVillas는 publicListed·ACTIVE·isSellable·슬러그 존재를 모두 강제한다", async () => {
    const { db, calls } = makeSpyDb([makeRow()]);
    await getPublicVillas(db);
    const where = calls[0].where as Record<string, unknown>;
    expect(where.publicListed).toBe(true);
    expect(where.status).toBe("ACTIVE");
    expect(where.isSellable).toBe(true);
    expect(where.publicSlug).toEqual({ not: null });
  });

  it("★ 날짜(공실) 조건은 공개 조회 where에 절대 들어가지 않는다", async () => {
    const { db, calls } = makeSpyDb([makeRow()]);
    await getPublicVillas(db);
    const keys = collectKeys(calls[0].where).map((k) => k.toLowerCase());
    for (const banned of ["checkin", "checkout", "bookings", "blocks", "availability"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("슬러그 조회도 동일 게이트를 상속한다", async () => {
    const { db, calls } = makeSpyDb([makeRow()]);
    await getPublicVillaBySlug("sonasea-v12", db);
    const where = calls[0].where as Record<string, unknown>;
    expect(where.publicListed).toBe(true);
    expect(where.publicSlug).toBe("sonasea-v12");
  });

  it("슬러그 없는 빌라는 공개 DTO로 변환되지 않는다", () => {
    expect(toPublicVilla(makeRow({ publicSlug: null }))).toBeNull();
  });
});

describe("발행 품질 하한 (얇은 콘텐츠·대량 자동생성 방지)", () => {
  it("사진이 하한 미만이면 발행하지 않는다", () => {
    const v = toPublicVilla(makeRow({ photos: [] as never }))!;
    expect(isPublishable(v)).toBe(false);
  });

  it("본문이 하한 미만이면 발행하지 않는다", () => {
    const v = toPublicVilla(makeRow({ description: "짧은 소개" }))!;
    expect(isPublishable(v)).toBe(false);
  });

  it("하한을 모두 충족하면 발행한다", () => {
    expect(isPublishable(toPublicVilla(makeRow())!)).toBe(true);
  });

  it("자격 미달 빌라는 목록에서 제외된다", async () => {
    const { db } = makeSpyDb([makeRow({ description: "짧음" })]);
    expect(await getPublicVillas(db)).toEqual([]);
  });
});

describe("슬러그 생성", () => {
  it("베트남어 성조·특수문자를 제거한 라틴 슬러그를 만든다", () => {
    expect(buildPublicSlug({ id: "abc12345xyz", name: "쏘나씨 V12", nameVi: "Sonasea V12" })).toBe("sonasea-v12");
    expect(buildPublicSlug({ id: "abc12345xyz", name: "x", nameVi: "Biệt thự Đảo Ngọc" })).toBe("biet-thu-dao-ngoc");
  });

  it("라틴 문자가 없으면 id 폴백을 쓴다", () => {
    expect(buildPublicSlug({ id: "abc12345xyz", name: "쏘나씨", nameVi: null })).toBe("villa-abc12345");
  });
});
