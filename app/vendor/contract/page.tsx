// /vendor/contract — 부가서비스 업체(VENDOR) 자기 사업 계약서 열람·서명 (T-business-contract-esign)
//   라이트·vi 기본·모바일. vendor 레이아웃이 헤더·locale(vi)·세션·VENDOR 가드를 제공.
//   ★ mine API만 사용 — 내부 초안·타 계약 접근 경로 없음.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CounterpartContractView from "@/components/business-contract/counterpart-contract-view";

export const metadata: Metadata = { title: "Hợp đồng — Villa Go" };

export default async function VendorContractPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/logout");
  if (session.user.role !== "VENDOR") redirect("/login");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <CounterpartContractView defaultSignName={session.user.name ?? ""} />
    </div>
  );
}
