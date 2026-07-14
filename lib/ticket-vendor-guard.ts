// lib/ticket-vendor-guard.ts — TICKET 판매가능 벤더 판정 (단일 원천, ruleHasAny 패턴)
//   규칙: TICKET 품목은 해석된 벤더(resolveOrderVendorId 결과)가 존재하고 approvalStatus=APPROVED && active=true일
//     때만 판매(주문 생성) 가능. 티켓은 벤더의 QR 발행 없이는 이행이 불가능하므로 판매 시점에 벤더를 확보한다
//     (계약 ticket-vendor-required-sale-block — 퀸테센스 콤보 vendorId=NONE 판매 사고 재발 방지).
//   ★다른 타입(FOOD/BBQ/MASSAGE 등)의 "미지정=직접 제공" 모드는 불변 — 비TICKET은 항상 판매 허용.
//   ★마진 비공개(원칙2): 판정에 필요한 벤더 필드는 approvalStatus·active뿐 — bankInfo·원가·마진 미참조.
//   UI(게스트 메뉴 숨김·운영자 폼 비활성)와 서버 가드가 이 함수를 공유한다(재구현 금지).
import { prisma } from "@/lib/prisma";
import type { ServiceType } from "@prisma/client";

/** 판매가능 판정에 필요한 벤더 최소 필드 — 승인·활성만(누수 0). */
export interface VendorSellability {
  approvalStatus: string | null | undefined;
  active: boolean | null | undefined;
}

/** 순수 — 벤더가 판매가능(승인 APPROVED + 활성)인가. null/미조회면 false. */
export function isVendorSellable(v: VendorSellability | null | undefined): boolean {
  return !!v && v.approvalStatus === "APPROVED" && v.active === true;
}

/**
 * 순수 판정 — 이 품목으로 주문(판매)을 생성해도 되는가.
 *   - 비TICKET: 항상 true(미지정=직접 제공 모드 불변).
 *   - TICKET: 해석된 벤더(resolvedVendorId)가 있고 그 벤더가 판매가능(승인+활성)이어야 true.
 * 무료 티켓(판매가 0)도 이 규칙을 그대로 적용 — 부분 허용 없음(품목 단위 차단).
 */
export function canSellItem(args: {
  itemType: ServiceType | string;
  resolvedVendorId: string | null;
  vendor: VendorSellability | null | undefined;
}): boolean {
  if (args.itemType !== "TICKET") return true;
  return !!args.resolvedVendorId && isVendorSellable(args.vendor);
}

/** 해석기가 쓰는 최소 DB 인터페이스 — prisma·tx·테스트 스텁 주입 가능(regional-vendor.ts 패턴). */
interface VendorSellabilityDb {
  serviceVendor: {
    findUnique: (args: {
      where: { id: string };
      select: { approvalStatus: true; active: true };
    }) => Promise<VendorSellability | null>;
  };
}

/**
 * 서버 조회 래퍼 — resolvedVendorId로 벤더 승인·활성만 조회해 canSellItem 판정.
 *   - 비TICKET: 조회 없이 true(불필요 쿼리 회피).
 *   - TICKET + 벤더 미지정(resolvedVendorId null): 조회 없이 false.
 *   - TICKET + 벤더 지정: 승인·활성 조회 후 판정.
 * ★벤더 엔티티를 이미 로드한 호출부(게스트 라우트의 dispatchVendor)는 이 래퍼 대신 순수 canSellItem을
 *   써서 중복 쿼리를 피한다.
 */
export async function loadCanSellItem(
  args: { itemType: ServiceType | string; resolvedVendorId: string | null },
  db: VendorSellabilityDb = prisma
): Promise<boolean> {
  if (args.itemType !== "TICKET") return true;
  if (!args.resolvedVendorId) return false;
  const vendor = await db.serviceVendor.findUnique({
    where: { id: args.resolvedVendorId },
    select: { approvalStatus: true, active: true },
  });
  return isVendorSellable(vendor);
}
