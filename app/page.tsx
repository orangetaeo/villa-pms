import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isOperator } from "@/lib/permissions";

// 루트: 세션 role별 홈으로 분기
// [S-RBAC] 운영자(OWNER/MANAGER/STAFF/ADMIN)는 /dashboard. CLEANER=/cleaning, SUPPLIER=/my-villas.
// (구버전은 ADMIN만 /dashboard라 OWNER/MANAGER/STAFF가 /my-villas로 떨어져 무한 리다이렉트 루프 발생)
export default async function Home() {
  const session = await auth();

  // 무효 세션(비번 변경 후 stale 토큰 포함)은 /logout으로 — 쿠키를 지워 루프 차단.
  if (!session) redirect("/logout");

  const role = session.user.role;
  if (isOperator(role)) redirect("/dashboard");
  if (role === "CLEANER") redirect("/cleaning");
  if (role === "VENDOR") redirect("/vendor");
  if (role === "PARTNER") redirect("/partner"); // 여행사·랜드사 포털 (ADR-0028)
  redirect("/my-villas"); // SUPPLIER
}
