// /marketing/youtube/create — 직접 촬영 클립 → 세로 쇼츠 자동 편집 (운영자 다크, ko)
// RSC: 인증 게이트(레이아웃 isOperator 위 2차 방어) + 3스텝 마법사(클라이언트, BE API 소비).
//   업로드는 R2 presigned PUT 직업로드(브라우저→R2), 편집은 edit-jobs 생성→run(동기).
//   ★ 재고/마진 누수 표면 없음 — 편집 입력(클립·헤드라인·자막)에 원가·판매가 개념 부재.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import CreateShortWizard from "./create-short-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminYoutube");
  return { title: `${t("create.title")} — Villa Go` };
}

export const dynamic = "force-dynamic";

export default async function CreateShortPage() {
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) {
    redirect("/login");
  }
  return <CreateShortWizard />;
}
