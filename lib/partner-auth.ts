// lib/partner-auth.ts — 로그인 User → Partner 매핑 (ADR-0028 PP3)
//   엔티티(Partner, 여행사·랜드사)와 계정(User, Role=PARTNER)은 분리(선택적 1:1, userId @unique).
//   파트너 포털은 세션 userId로 이 함수를 거쳐 자기 partnerId·승인상태를 얻고, 그 스코프만 강제한다.
//   ★ 누수: select에 creditLimitVnd·creditTier·memo·contractUrl 등 운영 전용 필드 비포함.
import { prisma } from "@/lib/prisma";
import type { PartnerType, PartnerApprovalStatus } from "@prisma/client";

/**
 * 세션 사용자에 연결된 Partner의 안전 필드 반환. 없으면 null.
 * (null이면 레이아웃이 포털 비노출·안내. approvalStatus로 승인 게이트 분기.)
 * 운영 전용(신용한도·여신등급·메모·계약서)은 select하지 않는다 — 파트너 화면 누수 차단.
 */
export async function getPartnerForUser(userId: string): Promise<{
  id: string;
  name: string;
  nameVi: string | null;
  type: PartnerType;
  approvalStatus: PartnerApprovalStatus;
  rejectionReason: string | null;
  country: string | null;
} | null> {
  const partner = await prisma.partner.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      nameVi: true,
      type: true,
      approvalStatus: true,
      rejectionReason: true,
      country: true,
    },
  });
  return partner;
}
