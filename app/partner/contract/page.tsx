// /partner/contract — 파트너(여행사·랜드사, PARTNER) 자기 사업 계약서 열람·서명 (T-business-contract-esign)
//   라이트·ko 기본. partner 레이아웃이 헤더·탭바·locale(ko)·세션·PARTNER 승인 게이트를 제공.
//   파트너 계약은 신분/주소 선택 입력(정본에 해당 토큰 없음 — BE sign 라우트와 대칭).
//   ★ mine API만 사용 — 내부 초안·타 계약 접근 경로 없음.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPartnerForUser } from "@/lib/partner-auth";
import CounterpartContractView from "@/components/business-contract/counterpart-contract-view";

export const metadata: Metadata = { title: "계약서 — Villa Go" };

export default async function PartnerContractPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/logout");
  if (session.user.role !== "PARTNER") redirect("/login");
  // 승인 게이트(레이아웃과 동일) — 미승인 파트너는 포털 홈의 안내 화면으로.
  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  return <CounterpartContractView defaultSignName={session.user.name ?? ""} />;
}
