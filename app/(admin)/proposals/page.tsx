// /proposals — 운영자 제안 목록 (T2.1, Stitch b12-proposals-list 변환)
// 데이터는 GET /api/proposals(effectiveStatus 서버 판정값)를 클라이언트에서 소비 —
// 카운트다운·회수·복사 등 실시간 인터랙션이 많아 클라이언트 fetch 구조 (계약 T2.1 §2)
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { redirect } from "next/navigation";
import ProposalsList from "./proposals-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("proposals")} — Villa PMS` };
}

export default async function ProposalsPage() {
  // 재무 권한자(OWNER/MANAGER) 가드 — 제안=판매가(ADR-0013 finance). STAFF 차단. layout과 이중화.
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  return <ProposalsList />;
}
