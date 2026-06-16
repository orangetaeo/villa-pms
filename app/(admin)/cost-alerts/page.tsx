// /cost-alerts — 견적 중 원가 변경 경보 (b15 변환, F) — 운영자(ADMIN) 전용
// RSC: (admin) 레이아웃 role 가드 아래에서만 렌더. 마진·판매가·KRW 노출은 운영자 화면에서만 정당.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadCostAlerts } from "@/lib/cost-alerts";
import CostAlertsView from "./cost-alerts-view";

export const metadata: Metadata = { title: "견적 중 원가 변경 — Villa PMS" };

export default async function CostAlertsPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("adminCostAlerts"),
  ]);
  // 레이아웃 가드로 ADMIN 보장 — 방어적으로 한 번 더
  const adminId = session?.user?.id;
  const groups = adminId ? await loadCostAlerts(prisma, adminId) : [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">{t("pageTitle")}</h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </div>
      <CostAlertsView groups={groups} />
    </div>
  );
}
