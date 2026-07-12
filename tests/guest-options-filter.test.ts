import { describe, expect, it } from "vitest";
import {
  ALL_TYPES,
  buildGuestTypeTabs,
  filterGuestCatalogByType,
} from "@/app/g/_components/guest-options-filter";
import type { GuestCatalogView } from "@/app/g/_components/types";

// 게스트 옵션 카테고리 탭 순수 로직 — 타입별 필터·전체·빈 타입 미노출·건수·정의 순서.

function item(id: string, type: string): GuestCatalogView {
  return {
    id,
    type,
    name: id,
    desc: null,
    unitLabel: null,
    priceVnd: null,
    photoUrl: null,
    variants: [],
    addons: [],
    modifiers: [],
    pickupAvailable: null,
    pickupNote: null,
  };
}

const catalog: GuestCatalogView[] = [
  item("a", "BBQ"),
  item("b", "MASSAGE"),
  item("c", "BBQ"),
  item("d", "TICKET"),
];

describe("buildGuestTypeTabs — 전체 + 실존 타입만·건수·정의 순서", () => {
  const tabs = buildGuestTypeTabs(catalog);

  it("맨 앞은 전체(ALL), count=전체 품목 수", () => {
    expect(tabs[0]).toEqual({ key: ALL_TYPES, count: 4 });
  });

  it("실존 타입만 노출(빈 타입 GUIDE·CAR_RENTAL 등 제외)", () => {
    const keys = tabs.map((t) => t.key);
    expect(keys).toEqual([ALL_TYPES, "BBQ", "TICKET", "MASSAGE"]); // SERVICE_TYPE_VALUES 정의 순서
    expect(keys).not.toContain("GUIDE");
    expect(keys).not.toContain("FRUIT");
  });

  it("타입별 건수 뱃지", () => {
    const byKey = Object.fromEntries(tabs.map((t) => [t.key, t.count]));
    expect(byKey.BBQ).toBe(2);
    expect(byKey.TICKET).toBe(1);
    expect(byKey.MASSAGE).toBe(1);
  });

  it("빈 카탈로그면 전체 탭만(count 0)", () => {
    expect(buildGuestTypeTabs([])).toEqual([{ key: ALL_TYPES, count: 0 }]);
  });
});

describe("filterGuestCatalogByType — 표시 필터(선택 상태 무관)", () => {
  it("ALL이면 전량 그대로", () => {
    expect(filterGuestCatalogByType(catalog, ALL_TYPES)).toBe(catalog);
  });

  it("특정 타입이면 해당 품목만", () => {
    const bbq = filterGuestCatalogByType(catalog, "BBQ");
    expect(bbq.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("카탈로그에 없는 타입이면 빈 목록", () => {
    expect(filterGuestCatalogByType(catalog, "FRUIT")).toEqual([]);
  });
});
