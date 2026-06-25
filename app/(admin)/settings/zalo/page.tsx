// /settings/zalo — Zalo 봇 연결 (ADR-0006 S1, 운영자 다크)
// RSC: 초기 상태는 getStatusForAdmin(본인)로 서버에서 1회 조회 → 클라이언트가 폴링으로 갱신 (ADR-0007).
// a0-zalo-connect 디자인 의미 참고하되 이건 ADMIN 다크(운영자 봇 로그인 화면).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isSystemAdmin } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { getStatusForAdmin } from "@/lib/zalo-runtime";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import ZaloConnectClient from "./zalo-connect-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("zalo")} — Villa Go` };
}

// 봇 런타임 상태는 매 요청 조회 (캐시 금지)
export const dynamic = "force-dynamic";

export default async function ZaloSettingsPage() {
  // 시스템 관리자(OWNER) 가드 — Zalo 봇 연결=시스템 설정(ADR-0013). MANAGER/STAFF 차단.
  const session = await auth();
  if (!session || !isSystemAdmin(session.user?.role)) {
    redirect("/login");
  }

  const t = await getTranslations("adminZalo");
  // 본인 계정 상태만 (ADR-0007) — credential 미포함 상태 객체만 클라이언트로 전달 (D6.2)
  const initialStatus = await getStatusForAdmin(session.user!.id);
  // 통합 모드(D1): 시스템봇 소유자(테오)는 이 계정이 시스템 알림 발송도 겸함.
  // 최초 연결자(시스템봇 미존재)도 시스템봇이 되므로 안내 노출.
  const systemOwnerId = await getSystemBotOwnerId();
  const isSystemBotAccount =
    systemOwnerId === null || systemOwnerId === session.user!.id;

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

      <ZaloConnectClient
        initialStatus={initialStatus}
        isSystemBotAccount={isSystemBotAccount}
      />
    </div>
  );
}
