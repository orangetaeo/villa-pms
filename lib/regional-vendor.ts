// lib/regional-vendor.ts — 빌라별 지역 지정 업체 해석 (ADR-0037)
//   마사지·이발은 섬 전역이 아니라 "지역 분포" 업체라, 발주가 들어온 빌라에서 가까운 샵으로 자동 지정해야 한다(테오 지시).
//   그 외 타입(BBQ·티켓·가이드·차량·조식·오토바이·과일)은 푸꾸옥 전체를 커버하므로 카탈로그 기본 벤더를 그대로 쓴다.
//   주문 생성 3경로(운영자·파트너·게스트)가 이 해석기를 공유해 vendorId 스냅샷을 결정한다.
import { prisma } from "@/lib/prisma";
import type { ServiceType } from "@prisma/client";

/**
 * 지역 분포 업체 타입 — 이 타입만 빌라별 지정(VillaServiceVendor) 매핑을 조회·오버라이드한다.
 * 그 외 타입은 조회 자체를 생략하고 카탈로그 기본(item.vendorId)을 그대로 쓴다.
 */
export const REGIONAL_VENDOR_TYPES = ["MASSAGE", "BARBER"] as const;
export type RegionalVendorType = (typeof REGIONAL_VENDOR_TYPES)[number];

/** 순수 판정 — 이 ServiceType이 지역 분포 타입(마사지·이발)인가. */
export function isRegionalType(type: ServiceType): type is RegionalVendorType {
  return (REGIONAL_VENDOR_TYPES as readonly ServiceType[]).includes(type);
}

/** 해석기가 쓰는 최소 DB 인터페이스 — prisma·tx·테스트 스텁 모두 주입 가능. */
interface RegionalVendorDb {
  villaServiceVendor: {
    findUnique: (args: {
      where: { villaId_serviceType: { villaId: string; serviceType: ServiceType } };
      select: { vendorId: true };
    }) => Promise<{ vendorId: string } | null>;
  };
}

/**
 * 주문 생성 시 원천 벤더 해석 (ADR-0037).
 *   - 지역 타입이 아니거나 villaId가 없으면: 조회 없이 카탈로그 기본(itemVendorId) 그대로.
 *   - 지역 타입이면: 빌라별 지정 업체(VillaServiceVendor) 조회 → 있으면 그 vendorId, 없으면 itemVendorId 폴백.
 * ★ 스냅샷 원칙: 반환값을 ServiceOrder.vendorId로 저장한다(기존 주문 소급 없음).
 */
export async function resolveOrderVendorId(
  args: { itemType: ServiceType; itemVendorId: string | null; villaId: string | null | undefined },
  db: RegionalVendorDb = prisma,
): Promise<string | null> {
  const { itemType, itemVendorId, villaId } = args;
  if (!villaId || !isRegionalType(itemType)) return itemVendorId;
  const mapping = await db.villaServiceVendor.findUnique({
    where: { villaId_serviceType: { villaId, serviceType: itemType } },
    select: { vendorId: true },
  });
  return mapping?.vendorId ?? itemVendorId;
}
