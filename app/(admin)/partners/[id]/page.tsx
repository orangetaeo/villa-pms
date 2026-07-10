import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { getPartnerDetail } from "@/lib/partner-server";
import PartnerDetailView, { type SerializedPartnerDetail } from "./partner-detail";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

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
  // tTour — 코치마크 문구(RSC 번역 → props, ADMIN_CLIENT_NAMESPACES 무변경)
  const tTour = await getTranslations("tour");
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
    <>
      <PartnerDetailView
        detail={serializeBigInt(detail) as SerializedPartnerDetail}
        account={account}
        tourHelpLabel={tTour("help")}
      />
      {/* 코치마크 투어 — B2B 여신·미수 업무 규칙 안내. 편집 모드 스텝은 자동 스킵(T-8) */}
      <CoachMark
        tourId="partnerDetail"
        steps={buildTourSteps(tTour, "partnerDetail")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
