// /vendor — 원천 공급자 발주함 메인 (ADR-0023 S3 §6). vi 기본·모바일·라이트.
//   layout이 Role=VENDOR 보장. 발주함/예약현황/정산내역은 클라(VendorBoard)에서
//   /api/vendor/orders를 fetch — 수락/거절 후 즉시 재조회가 필요해 RSC가 아닌 클라 로드.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import VendorBoard from "@/components/vendor/vendor-board";

export const metadata: Metadata = {
  title: "Đơn đặt hàng — Villa Go",
};

export default async function VendorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "VENDOR") redirect("/login");

  // 임시 비번 사용자는 먼저 비번 변경(미들웨어가 /vendor/profile로 보냄). 여기 도달 시 변경 완료.
  return <VendorBoard />;
}
