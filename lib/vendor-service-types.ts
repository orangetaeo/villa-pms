// lib/vendor-service-types.ts — 업체 취급 서비스타입(카테고리) 파생 판정 (단일 원천)
//   ServiceVendor에는 타입 컬럼이 없다. 업체가 "어떤 카테고리를 취급하는가"는 세 관계에서 파생한다:
//     ① 활성(active) 카탈로그 품목의 type  ② 지역 커버리지(ServiceVendorRegion)의 serviceType
//     ③ 빌라 지정(VillaServiceVendor)의 serviceType  — 이 셋의 합집합.
//   신호 0(세 관계 모두 비어 있음)인 미분류 업체는 어느 타입도 취급하지 않는 것으로 본다(어느 셀렉터에도 미표시).
//   ★UI(업체 변경 셀렉터 필터)와 서버(PATCH 타입 대칭 가드)가 이 함수를 공유한다 — 재구현 금지.
//   ★누수: 판정에 필요한 필드는 type/serviceType·active뿐. bankInfo·원가·마진 미참조(원칙2).
import { prisma } from "@/lib/prisma";
import type { ServiceType } from "@prisma/client";

/** 파생 판정에 필요한 업체 관계 최소 형태 — 세 관계의 타입 필드만(누수 0). */
export interface VendorServiceTypeRelations {
  catalogItems?: { type: ServiceType | string; active: boolean }[] | null;
  regionCoverage?: { serviceType: ServiceType | string }[] | null;
  villaAssignments?: { serviceType: ServiceType | string }[] | null;
}

/** 순수 — 업체가 취급하는 서비스타입 집합(활성 카탈로그 ∪ 지역 ∪ 빌라 지정). 신호 0이면 빈 Set. */
export function vendorServiceTypes(rel: VendorServiceTypeRelations): Set<string> {
  const set = new Set<string>();
  for (const c of rel.catalogItems ?? []) if (c.active) set.add(c.type);
  for (const r of rel.regionCoverage ?? []) set.add(r.serviceType);
  for (const v of rel.villaAssignments ?? []) set.add(v.serviceType);
  return set;
}

/** 순수 — 업체가 이 서비스타입을 취급하는가. 미분류(신호 0)면 false. */
export function vendorHandlesType(
  rel: VendorServiceTypeRelations,
  type: ServiceType | string
): boolean {
  return vendorServiceTypes(rel).has(type);
}

/** 세 관계를 함께 조회하는 select 조각 — 라우트·페이지가 동일 형태로 로드하도록 공유. */
export const VENDOR_SERVICE_TYPE_SELECT = {
  catalogItems: { select: { type: true, active: true } },
  regionCoverage: { select: { serviceType: true } },
  villaAssignments: { select: { serviceType: true } },
} as const;

/** 조회 래퍼가 쓰는 최소 DB 인터페이스 — prisma·tx·테스트 스텁 주입 가능(ticket-vendor-guard 패턴). */
interface VendorTypeDb {
  serviceVendor: {
    findUnique: (args: {
      where: { id: string };
      select: typeof VENDOR_SERVICE_TYPE_SELECT;
    }) => Promise<VendorServiceTypeRelations | null>;
  };
}

/**
 * 서버 조회 래퍼 — vendorId의 세 관계를 조회해 이 타입을 취급하는지 판정.
 *   미존재·미분류(신호 0)면 false. 이미 관계를 로드한 호출부는 순수 vendorHandlesType를 직접 써 중복 쿼리 회피.
 */
export async function loadVendorHandlesType(
  vendorId: string,
  type: ServiceType | string,
  db: VendorTypeDb = prisma as unknown as VendorTypeDb
): Promise<boolean> {
  const rel = await db.serviceVendor.findUnique({
    where: { id: vendorId },
    select: VENDOR_SERVICE_TYPE_SELECT,
  });
  if (!rel) return false;
  return vendorHandlesType(rel, type);
}
