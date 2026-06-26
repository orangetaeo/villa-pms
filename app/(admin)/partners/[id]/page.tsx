import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { getPartnerDetail } from "@/lib/partner-server";
import PartnerDetailView, { type SerializedPartnerDetail } from "./partner-detail";

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !canViewFinance(session.user.role)) {
    redirect("/login");
  }

  const { id } = await params;
  const detail = await getPartnerDetail(prisma, id, new Date());
  if (!detail) notFound();

  // 연결된 로그인 계정(있으면) — 상세 "로그인 계정" 패널용 (엔티티≠계정 상호연결)
  const account = detail.partner.userId
    ? await prisma.user.findFirst({
        where: { id: detail.partner.userId, deletedAt: null },
        select: { id: true, name: true, phone: true, isActive: true },
      })
    : null;

  return (
    <PartnerDetailView
      detail={serializeBigInt(detail) as SerializedPartnerDetail}
      account={account}
    />
  );
}
