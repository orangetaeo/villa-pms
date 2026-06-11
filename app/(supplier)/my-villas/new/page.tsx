import { auth } from "@/auth";
import { redirect } from "next/navigation";
import VillaWizard from "./villa-wizard";

export default async function NewVillaPage() {
  // 권한 검사 — SUPPLIER 전용 (CLEANER·ADMIN은 마법사 접근 불가)
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  return <VillaWizard />;
}
