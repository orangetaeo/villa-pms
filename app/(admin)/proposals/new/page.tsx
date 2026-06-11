// /proposals/new — 제안 만들기 (T2.1, Stitch b2-proposal-create 변환)
// 후보 조회·요약 계산이 전부 인터랙티브 — 클라이언트 컴포넌트에 위임
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ProposalCreate from "./proposal-create";

export const metadata: Metadata = {
  title: "제안 만들기 — Villa PMS",
};

export default async function ProposalNewPage() {
  // ADMIN 가드는 (admin)/layout에 있으나 페이지에서도 재검사 (프로젝트 규칙 — 권한 이중화)
  const session = await auth();
  if (!session || session.user?.role !== "ADMIN") redirect("/login");

  return <ProposalCreate />;
}
