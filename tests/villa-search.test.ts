import { describe, expect, it } from "vitest";
import {
  parseVillaSearchFilters,
  buildVillaSearchWhere,
  hasAnyVillaSearchFilter,
} from "@/lib/villa-search";

// lib/villa-search 는 /villas 인라인 파싱·where 로직을 추출한 것 — 동작 불변이 회귀 기준.
// 아래 테스트는 (1) 파싱 규칙 (2) where 구성 형태가 기존 page.tsx searchWhere 와 동일함을 고정한다.

describe("parseVillaSearchFilters", () => {
  it("빈 파라미터 → 모든 필터 off", () => {
    const f = parseVillaSearchFilters({});
    expect(f.q).toBeUndefined();
    expect(f.area).toBeUndefined();
    expect(f.supplierId).toBeUndefined();
    expect(f.minBedrooms).toBeUndefined();
    expect(f.minGuests).toBeUndefined();
    expect(f.pool).toBe(false);
    expect(f.breakfast).toBe(false);
    expect(f.sellable).toBe(false);
    expect(f.smoking).toBe(false);
    expect(f.pets).toBe(false);
    expect(f.party).toBe(false);
    expect(f.extraBed).toBe(false);
    expect(f.bedType).toBeUndefined();
    expect(f.beach).toBeUndefined();
    expect(f.tags).toEqual([]);
    expect(f.checkIn).toBeNull();
    expect(f.checkOut).toBeNull();
    expect(f.dateRangeValid).toBe(false);
    expect(hasAnyVillaSearchFilter(f)).toBe(false);
  });

  it('boolean 토글은 값 "1" 일 때만 true', () => {
    expect(parseVillaSearchFilters({ pool: "1" }).pool).toBe(true);
    expect(parseVillaSearchFilters({ pool: "true" }).pool).toBe(false);
    expect(parseVillaSearchFilters({ pool: "0" }).pool).toBe(false);
    const f = parseVillaSearchFilters({
      pool: "1",
      breakfast: "1",
      sellable: "1",
      smoking: "1",
      pets: "1",
      party: "1",
      extraBed: "1",
    });
    expect([f.pool, f.breakfast, f.sellable, f.smoking, f.pets, f.party, f.extraBed]).toEqual([
      true, true, true, true, true, true, true,
    ]);
  });

  it("정수 필터는 양수 정수만, 그 외 무시", () => {
    expect(parseVillaSearchFilters({ minBedrooms: "3" }).minBedrooms).toBe(3);
    expect(parseVillaSearchFilters({ minGuests: "8" }).minGuests).toBe(8);
    expect(parseVillaSearchFilters({ beach: "500" }).beach).toBe(500);
    expect(parseVillaSearchFilters({ minBedrooms: "0" }).minBedrooms).toBeUndefined();
    expect(parseVillaSearchFilters({ minBedrooms: "-2" }).minBedrooms).toBeUndefined();
    expect(parseVillaSearchFilters({ minBedrooms: "abc" }).minBedrooms).toBeUndefined();
  });

  it("bedType 은 BED_TYPES 목록에 있을 때만", () => {
    expect(parseVillaSearchFilters({ bedType: "KING" }).bedType).toBe("KING");
    expect(parseVillaSearchFilters({ bedType: "HAMMOCK" }).bedType).toBeUndefined();
  });

  it("tags 는 쉼표분리 후 화이트리스트 통과 키만", () => {
    expect(parseVillaSearchFilters({ tags: "viewSea, bbq" }).tags).toEqual(["viewSea", "bbq"]);
    // 사전에 없는 키는 주입 차단
    expect(parseVillaSearchFilters({ tags: "viewSea,__evil__" }).tags).toEqual(["viewSea"]);
    expect(parseVillaSearchFilters({ tags: "" }).tags).toEqual([]);
  });

  it("supplier 파라미터 → supplierId, q/area trim", () => {
    const f = parseVillaSearchFilters({ supplier: " sup1 ", q: "  sea  ", area: " Sonasea " });
    expect(f.supplierId).toBe("sup1");
    expect(f.q).toBe("sea");
    expect(f.area).toBe("Sonasea");
  });

  it("ci/co 둘 다 유효하고 ci<co 일 때만 dateRangeValid", () => {
    const ok = parseVillaSearchFilters({ ci: "2026-08-01", co: "2026-08-05" });
    expect(ok.checkIn).toBeInstanceOf(Date);
    expect(ok.checkOut).toBeInstanceOf(Date);
    expect(ok.dateRangeValid).toBe(true);
    // 한쪽만
    expect(parseVillaSearchFilters({ ci: "2026-08-01" }).dateRangeValid).toBe(false);
    // 역전
    expect(
      parseVillaSearchFilters({ ci: "2026-08-05", co: "2026-08-01" }).dateRangeValid
    ).toBe(false);
    // 동일일(0박)
    expect(
      parseVillaSearchFilters({ ci: "2026-08-01", co: "2026-08-01" }).dateRangeValid
    ).toBe(false);
  });
});

describe("buildVillaSearchWhere", () => {
  it("빈 필터 → 빈 where", () => {
    expect(buildVillaSearchWhere(parseVillaSearchFilters({}))).toEqual({});
  });

  it("스칼라 필터 → gte/true 조건 (기존 searchWhere 형태 고정)", () => {
    const where = buildVillaSearchWhere(
      parseVillaSearchFilters({
        supplier: "sup1",
        area: "Sonasea",
        minBedrooms: "3",
        minGuests: "8",
        pool: "1",
        breakfast: "1",
        sellable: "1",
        smoking: "1",
        pets: "1",
        party: "1",
        extraBed: "1",
        bedType: "KING",
        beach: "500",
      })
    );
    expect(where).toEqual({
      supplierId: "sup1",
      complex: "Sonasea",
      bedrooms: { gte: 3 },
      maxGuests: { gte: 8 },
      hasPool: true,
      breakfastAvailable: true,
      isSellable: true,
      smokingAllowed: true,
      petsAllowed: true,
      partyAllowed: true,
      extraBedAvailable: true,
      bedroomDetails: { some: { bedType: "KING" } },
      beachDistanceM: { lte: 500 },
    });
  });

  it("tags 다중 → AND features some (모두 보유)", () => {
    const where = buildVillaSearchWhere(parseVillaSearchFilters({ tags: "viewSea,bbq" }));
    expect(where.AND).toEqual([
      { features: { some: { featureKey: "viewSea" } } },
      { features: { some: { featureKey: "bbq" } } },
    ]);
  });

  it("q → OR 5필드 부분일치(insensitive)", () => {
    const where = buildVillaSearchWhere(parseVillaSearchFilters({ q: "sea" }));
    expect(where.OR).toEqual([
      { name: { contains: "sea", mode: "insensitive" } },
      { nameVi: { contains: "sea", mode: "insensitive" } },
      { complex: { contains: "sea", mode: "insensitive" } },
      { address: { contains: "sea", mode: "insensitive" } },
      { supplier: { is: { name: { contains: "sea", mode: "insensitive" } } } },
    ]);
  });

  it("날짜(ci/co)는 where 에 포함하지 않는다(freeIds 로 별도 결합)", () => {
    const where = buildVillaSearchWhere(
      parseVillaSearchFilters({ ci: "2026-08-01", co: "2026-08-05" })
    );
    expect(where).toEqual({});
  });
});

describe("hasAnyVillaSearchFilter", () => {
  it("날짜 유효 범위만 있어도 true", () => {
    expect(
      hasAnyVillaSearchFilter(parseVillaSearchFilters({ ci: "2026-08-01", co: "2026-08-05" }))
    ).toBe(true);
  });
  it("개별 필터 각각 true 유발", () => {
    expect(hasAnyVillaSearchFilter(parseVillaSearchFilters({ q: "x" }))).toBe(true);
    expect(hasAnyVillaSearchFilter(parseVillaSearchFilters({ pool: "1" }))).toBe(true);
    expect(hasAnyVillaSearchFilter(parseVillaSearchFilters({ tags: "bbq" }))).toBe(true);
  });
});
