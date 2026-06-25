// /proposals/new — 제안 만들기 (T2.1, Stitch b2-proposal-create 변환)
// 후보 조회·요약 계산이 전부 인터랙티브 — 클라이언트 컴포넌트에 위임
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { redirect } from "next/navigation";
import ProposalCreate from "./proposal-create";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("proposalNew")} — Villa Go` };
}

export default async function ProposalNewPage() {
  // 재무 권한자(OWNER/MANAGER) 가드 — 제안 생성=가격 설정(ADR-0013). STAFF 차단. layout과 이중화.
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  return <ProposalCreate />;
}
