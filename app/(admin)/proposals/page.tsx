// /proposals — 운영자 제안 목록 (T2.1, Stitch b12-proposals-list 변환)
// 데이터는 GET /api/proposals(effectiveStatus 서버 판정값)를 클라이언트에서 소비 —
// 카운트다운·회수·복사 등 실시간 인터랙션이 많아 클라이언트 fetch 구조 (계약 T2.1 §2)
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { redirect } from "next/navigation";
import ProposalsList from "./proposals-list";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("proposals")} — Villa Go` };
}

export default async function ProposalsPage() {
  // 재무 권한자(OWNER/MANAGER) 가드 — 제안=판매가(ADR-0013 finance). STAFF 차단. layout과 이중화.
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  // 코치마크 문구 — RSC 번역 → props (ADMIN_CLIENT_NAMESPACES 무변경)
  const tTour = await getTranslations("tour");
  return (
    <>
      <ProposalsList />
      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-5) */}
      <CoachMark
        tourId="adminProposals"
        steps={buildTourSteps(tTour, "adminProposals")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
