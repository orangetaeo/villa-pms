// lib/vendor-auth.ts — 로그인 User → ServiceVendor 매핑 (ADR-0023 S2)
//   엔티티(ServiceVendor)와 계정(User, Role=VENDOR)은 분리(선택적 1:1, userId @unique).
//   공급자 API는 세션 userId로 이 함수를 거쳐 자기 vendorId를 얻고, 그 스코프만 강제한다.
import { prisma } from "@/lib/prisma";
import type { VendorApprovalStatus } from "@prisma/client";
import { isTicketOnlyFromCounts } from "@/lib/vendor-order";

/**
 * 세션 사용자에 연결된 활성 ServiceVendor의 id 반환. 없거나 비활성이면 null.
 * (null이면 라우트가 403 NOT_A_VENDOR로 차단.)
 */
export async function getVendorIdForUser(userId: string): Promise<string | null> {
  const vendor = await prisma.serviceVendor.findUnique({
    where: { userId },
    select: { id: true, active: true },
  });
  if (!vendor || !vendor.active) return null;
  return vendor.id;
}

/**
 * 세션 사용자에 연결된 활성 ServiceVendor의 {id, approvalStatus} 반환. 없거나 비활성이면 null.
 * FE 공급자 대시보드가 승인대기(PENDING_APPROVAL)·반려(REJECTED) 게이트 화면을 띄우는 용도.
 * (getVendorIdForUser 시그니처는 그대로 두고 별도 함수로 추가 — ADR-0023 S5.)
 */
export async function getVendorForUser(
  userId: string
): Promise<{
  id: string;
  approvalStatus: VendorApprovalStatus;
  rejectionReason: string | null;
} | null> {
  const vendor = await prisma.serviceVendor.findUnique({
    where: { userId },
    select: { id: true, active: true, approvalStatus: true, rejectionReason: true },
  });
  if (!vendor || !vendor.active) return null;
  return {
    id: vendor.id,
    approvalStatus: vendor.approvalStatus,
    rejectionReason: vendor.rejectionReason,
  };
}

/**
 * 티켓 전용 벤더인가 — 보유 활성(active) 카탈로그 품목이 1개 이상이고 전부 type=TICKET.
 * 파생 판정(스키마 변경 없음): 티켓 업체가 늘어도 자동 적용, 혼합 판매 업체는 일반 보드 유지.
 * count 2쿼리(전체 활성 / 활성 TICKET)만 사용 — 순수 판정부는 isTicketOnlyFromCounts(단위 테스트 대상).
 */
export async function isTicketOnlyVendor(vendorId: string): Promise<boolean> {
  const [activeTotal, activeTicket] = await Promise.all([
    prisma.serviceCatalogItem.count({ where: { vendorId, active: true } }),
    prisma.serviceCatalogItem.count({ where: { vendorId, active: true, type: "TICKET" } }),
  ]);
  return isTicketOnlyFromCounts(activeTotal, activeTicket);
}
