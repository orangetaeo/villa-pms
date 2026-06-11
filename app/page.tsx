import { auth } from "@/auth";
import { redirect } from "next/navigation";

// 루트: 세션 role별 홈으로 분기
export default async function Home() {
  const session = await auth();

  if (!session) redirect("/login");

  switch (session.user.role) {
    case "ADMIN":
      redirect("/dashboard");
    case "CLEANER":
      redirect("/cleaning");
    default:
      redirect("/my-villas");
  }
}
