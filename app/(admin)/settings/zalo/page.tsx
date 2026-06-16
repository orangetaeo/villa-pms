// /settings/zalo — Zalo 봇 연결 (ADR-0006 S1, 운영자 다크)
// RSC: 초기 상태는 getBotStatus()로 서버에서 1회 조회 → 클라이언트가 폴링으로 갱신.
// a0-zalo-connect 디자인 의미 참고하되 이건 ADMIN 다크(운영자 봇 로그인 화면).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getBotStatus } from "@/lib/zalo-runtime";
import ZaloConnectClient from "./zalo-connect-client";

export const metadata: Metadata = {
  title: "Zalo 봇 연결 — Villa PMS",
};

// 봇 런타임 상태는 매 요청 조회 (캐시 금지)
export const dynamic = "force-dynamic";

export default async function ZaloSettingsPage() {
  const session = await auth();
  if (!session || session.user?.role !== "ADMIN") {
    redirect("/login");
  }

  const t = await getTranslations("adminZalo");
  // credential 미포함 상태 객체만 클라이언트로 전달 (D6.2)
  const initialStatus = getBotStatus();

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
        <nav className="flex text-xs text-slate-500 gap-2 whitespace-nowrap">
          <span>{t("breadcrumbAdmin")}</span>
          <span>/</span>
          <span>{t("breadcrumbSettings")}</span>
          <span>/</span>
          <span className="text-slate-300">{t("breadcrumbCurrent")}</span>
        </nav>
      </div>

      <ZaloConnectClient initialStatus={initialStatus} />
    </div>
  );
}
