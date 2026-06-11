// /dashboard — 운영자 대시보드 (T1.5: 타임라인 매트릭스 / 스탯 카드·활동 피드·경보 배너는 T2.6)
// RSC: prisma 직접 조회 — (admin) 레이아웃 role 가드 + 미들웨어 이중 보호 아래에서만 렌더
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadTimeline } from "@/lib/timeline";
import TimelineMatrix from "@/components/admin/timeline-matrix";

export const metadata: Metadata = {
  title: "대시보드 — Villa PMS",
};

export default async function DashboardPage() {
  const [session, t, timeline] = await Promise.all([
    auth(),
    getTranslations("adminDashboard"),
    loadTimeline(prisma),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">{t("title")}</h1>
        <p className="text-gray-400">
          {t("greeting", { name: session?.user?.name ?? "" })}
        </p>
      </div>
      <TimelineMatrix data={timeline} />
      <p className="text-gray-500 text-sm">{t("comingSoon")}</p>
    </div>
  );
}
