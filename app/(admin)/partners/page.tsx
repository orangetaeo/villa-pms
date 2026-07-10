import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance, canSetPrice } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { getPartnersWithAggregates } from "@/lib/partner-server";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";
import PartnersManager, { type SerializedPartnerAggregate } from "./partners-manager";

// 파트너 관리 (ADR-0022 PARTNER-2) — 미수·신용한도는 재무(canViewFinance) 전용
export default async function PartnersPage() {
  const session = await auth();
  if (!session?.user?.id || !canViewFinance(session.user.role)) {
    redirect("/login");
  }

  const partners = await getPartnersWithAggregates(prisma, new Date());

  // 연결된 로그인 계정의 활성 여부 — 목록에서 "계정 활성/비활성" 표시(엔티티≠계정 상호연결)
  const linkedUserIds = partners
    .map((p) => p.partner.userId)
    .filter((v): v is string => v != null);
  const accountActiveByUserId: Record<string, boolean> = {};
  if (linkedUserIds.length > 0) {
    const accounts = await prisma.user.findMany({
      where: { id: { in: linkedUserIds }, deletedAt: null },
      select: { id: true, isActive: true },
    });
    for (const a of accounts) accountActiveByUserId[a.id] = a.isActive;
  }
  // 자가가입 승인대기(PENDING_APPROVAL)를 최상단으로 — 운영자가 먼저 처리하도록(vendors page 패턴).
  // 그 외에는 lib 기본 정렬(createdAt desc) 유지.
  const PENDING_RANK = (s: string) => (s === "PENDING_APPROVAL" ? 0 : 1);
  const sorted = [...partners].sort(
    (a, b) => PENDING_RANK(a.partner.approvalStatus) - PENDING_RANK(b.partner.approvalStatus)
  );
  const serialized = serializeBigInt(sorted) as SerializedPartnerAggregate[];

  // 승인/거절은 canSetPrice(OWNER/MANAGER/ADMIN)만 — API와 동일 게이트(vendors의 canEdit 패턴).
  const canApprove = canSetPrice(session.user.role);

  const tTour = await getTranslations("tour");

  return (
    <>
      <PartnersManager
        partners={serialized}
        canApprove={canApprove}
        accountActiveByUserId={accountActiveByUserId}
      />

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-6) */}
      <CoachMark
        tourId="adminPartners"
        steps={buildTourSteps(tTour, "adminPartners")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
