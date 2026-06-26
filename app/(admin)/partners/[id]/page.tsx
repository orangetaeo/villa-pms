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

  return <PartnerDetailView detail={serializeBigInt(detail) as SerializedPartnerDetail} />;
}
