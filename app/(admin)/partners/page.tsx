import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance, canSetPrice } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { getPartnersWithAggregates } from "@/lib/partner-server";
import PartnersManager, { type SerializedPartnerAggregate } from "./partners-manager";

// 파트너 관리 (ADR-0022 PARTNER-2) — 미수·신용한도는 재무(canViewFinance) 전용
export default async function PartnersPage() {
  const session = await auth();
  if (!session?.user?.id || !canViewFinance(session.user.role)) {
    redirect("/login");
  }

  const partners = await getPartnersWithAggregates(prisma, new Date());
  // 자가가입 승인대기(PENDING_APPROVAL)를 최상단으로 — 운영자가 먼저 처리하도록(vendors page 패턴).
  // 그 외에는 lib 기본 정렬(createdAt desc) 유지.
  const PENDING_RANK = (s: string) => (s === "PENDING_APPROVAL" ? 0 : 1);
  const sorted = [...partners].sort(
    (a, b) => PENDING_RANK(a.partner.approvalStatus) - PENDING_RANK(b.partner.approvalStatus)
  );
  const serialized = serializeBigInt(sorted) as SerializedPartnerAggregate[];

  // 승인/거절은 canSetPrice(OWNER/MANAGER/ADMIN)만 — API와 동일 게이트(vendors의 canEdit 패턴).
  const canApprove = canSetPrice(session.user.role);

  return <PartnersManager partners={serialized} canApprove={canApprove} />;
}
