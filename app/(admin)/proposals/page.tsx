// /proposals — 운영자 제안 목록 (T2.1, Stitch b12-proposals-list 변환)
// 데이터는 GET /api/proposals(effectiveStatus 서버 판정값)를 클라이언트에서 소비 —
// 카운트다운·회수·복사 등 실시간 인터랙션이 많아 클라이언트 fetch 구조 (계약 T2.1 §2)
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ProposalsList from "./proposals-list";

export const metadata: Metadata = {
  title: "제안 관리 — Villa PMS",
};

export default async function ProposalsPage() {
  // ADMIN 가드는 (admin)/layout에 있으나 페이지에서도 재검사 (프로젝트 규칙 — 권한 이중화)
  const session = await auth();
  if (!session || session.user?.role !== "ADMIN") redirect("/login");

  return <ProposalsList />;
}
