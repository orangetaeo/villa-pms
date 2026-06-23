import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isOperator } from "@/lib/permissions";

// 루트: 세션 role별 홈으로 분기
// [S-RBAC] 운영자(OWNER/MANAGER/STAFF/ADMIN)는 /dashboard. CLEANER=/cleaning, SUPPLIER=/my-villas.
// (구버전은 ADMIN만 /dashboard라 OWNER/MANAGER/STAFF가 /my-villas로 떨어져 무한 리다이렉트 루프 발생)
export default async function Home() {
  const session = await auth();

  if (!session) redirect("/login");

  const role = session.user.role;
  if (isOperator(role)) redirect("/dashboard");
  if (role === "CLEANER") redirect("/cleaning");
  redirect("/my-villas"); // SUPPLIER
}
