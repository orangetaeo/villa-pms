import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
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
  const serialized = serializeBigInt(partners) as SerializedPartnerAggregate[];

  return <PartnersManager partners={serialized} />;
}
