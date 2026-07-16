// /contract — 공급자(SUPPLIER) 자기 사업 계약서 열람·서명 (T-business-contract-esign)
//   라이트·vi 기본·모바일 우선. (supplier) 레이아웃이 헤더·탭바·locale(vi)·세션을 제공.
//   ★ mine API만 사용 — 내부 초안·타 계약 접근 경로 없음(재고·마진 비공개 원칙).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CounterpartContractView from "@/components/business-contract/counterpart-contract-view";

export const metadata: Metadata = { title: "Hợp đồng — Villa Go" };

export default async function SupplierContractPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/logout");
  // 계약 서명 대상은 SUPPLIER만(CLEANER 제외 — 미들웨어에서도 차단). 그 외는 홈으로.
  if (session.user.role !== "SUPPLIER") redirect("/my-villas");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <CounterpartContractView defaultSignName={session.user.name ?? ""} />
    </div>
  );
}
