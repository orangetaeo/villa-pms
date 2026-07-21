// /marketing/instagram/dm — 인스타그램 DM 인박스 (운영자 다크, ko)
// RSC: 인증 게이트(레이아웃 isOperator 위 2차 방어) + 헤더. 목록·대화·답장은 클라이언트가
//   /api/instagram/dm* 을 직접 소비(서버 페이지네이션 그대로 — 클라 slice 금지).
// ★ 누수 없음: InstagramMessage 모델·직렬화에 원가·판매가 필드 자체가 부재.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isSystemAdmin } from "@/lib/permissions";
import DmInbox from "./dm-inbox";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminInstagram");
  return { title: `${t("dm.title")} — Villa Go` };
}

export const dynamic = "force-dynamic";

export default async function InstagramDmPage() {
  // 마케팅 전용 게이트 — 운영자(테오) 전용(isSystemAdmin=OWNER). MANAGER/STAFF는 /login 바운스.
  const session = await auth();
  if (!session?.user?.id || !isSystemAdmin(session.user.role)) {
    redirect("/login");
  }

  const t = await getTranslations("adminInstagram");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("dm.title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("dm.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Link
            href="/marketing/instagram"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            {t("dm.backToQueue")}
          </Link>
          <nav className="hidden sm:flex text-xs text-slate-500 gap-2 whitespace-nowrap">
            <span>{t("breadcrumbAdmin")}</span>
            <span>/</span>
            <span>{t("breadcrumbCurrent")}</span>
            <span>/</span>
            <span className="text-slate-300">{t("dm.breadcrumbCurrent")}</span>
          </nav>
        </div>
      </div>

      <DmInbox />
    </div>
  );
}
