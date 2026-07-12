// app/g/_components/guest-options-filter.ts — 게스트 옵션 카테고리 탭 순수 로직
//   ★클라 필터 전용: 카탈로그는 이미 전량 로드됨(추가 API 없음). 필터는 "표시"만 바꾸고 선택 상태(selections)엔 무관.
//   ★빈 타입 탭 금지: 카탈로그에 실존하는 ServiceType만 노출(SERVICE_TYPE_VALUES 정의 순서).
import { SERVICE_TYPE_VALUES } from "@/lib/service-catalog";
import type { GuestCatalogView } from "./types";

/** 전체 탭 키(모든 타입 표시). */
export const ALL_TYPES = "ALL";

export interface GuestTypeTab {
  key: string; // "ALL" | ServiceType
  count: number; // 해당 타입 품목 수(ALL은 전체 수)
}

/**
 * 카테고리 탭 구성 — [전체, ...실존 타입(정의 순서)]. 건수 뱃지용 count 포함.
 * 빈 타입은 제외(카탈로그에 1개 이상 있는 ServiceType만). 라벨은 호출부에서 i18n 해석.
 */
export function buildGuestTypeTabs(catalog: GuestCatalogView[]): GuestTypeTab[] {
  const counts: Record<string, number> = {};
  for (const c of catalog) counts[c.type] = (counts[c.type] ?? 0) + 1;
  const present = SERVICE_TYPE_VALUES.filter((tp) => (counts[tp] ?? 0) > 0);
  return [
    { key: ALL_TYPES, count: catalog.length },
    ...present.map((tp) => ({ key: tp as string, count: counts[tp] })),
  ];
}

/**
 * 표시용 필터 — ALL이면 전량, 아니면 해당 타입만. (선택 상태에는 영향 없음: 신청 진행 중 품목이 사라지지 않게 필터는 표시만.)
 */
export function filterGuestCatalogByType(
  catalog: GuestCatalogView[],
  activeType: string
): GuestCatalogView[] {
  if (activeType === ALL_TYPES) return catalog;
  return catalog.filter((c) => c.type === activeType);
}
