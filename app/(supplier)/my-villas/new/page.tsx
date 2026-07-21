import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import VillaWizard from "./villa-wizard";

export default async function NewVillaPage() {
  // 권한 검사 — SUPPLIER(자기 빌라) + 운영자(OWNER/MANAGER/STAFF/ADMIN 직접등록). CLEANER 등은 차단
  // [S-RBAC] 구버전은 role==="ADMIN"만 인정 → 테오(OWNER)·운영자가 등록 못 하던 회귀 수정
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user.role;
  if (role !== "SUPPLIER" && !isOperator(role)) redirect("/");

  // 운영자 직접등록 — 귀속할 공급자 목록(이름·전화). SUPPLIER는 불필요(세션 강제)
  const suppliers = isOperator(role)
    ? await prisma.user.findMany({
        where: { role: "SUPPLIER" },
        select: { id: true, name: true, phone: true },
        orderBy: { name: "asc" },
      })
    : [];

  // 단지 마스터 — active만, sortOrder→name 정렬 (GET /api/complex-areas와 동일 규칙, ADR-0046)
  const complexAreas = await prisma.complexArea.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameKo: true },
  });

  return (
    <VillaWizard
      isAdmin={isOperator(role)}
      suppliers={suppliers}
      complexAreas={complexAreas}
    />
  );
}
