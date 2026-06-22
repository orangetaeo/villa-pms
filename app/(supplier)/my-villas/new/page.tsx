import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import VillaWizard from "./villa-wizard";

export default async function NewVillaPage() {
  // 권한 검사 — SUPPLIER(자기 빌라) + ADMIN(테오 직접등록). CLEANER 등은 차단
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user.role;
  if (role !== "SUPPLIER" && role !== "ADMIN") redirect("/");

  // ADMIN 직접등록 — 귀속할 공급자 목록(이름·전화). SUPPLIER는 불필요(세션 강제)
  const suppliers =
    role === "ADMIN"
      ? await prisma.user.findMany({
          where: { role: "SUPPLIER" },
          select: { id: true, name: true, phone: true },
          orderBy: { name: "asc" },
        })
      : [];

  return <VillaWizard isAdmin={role === "ADMIN"} suppliers={suppliers} />;
}
