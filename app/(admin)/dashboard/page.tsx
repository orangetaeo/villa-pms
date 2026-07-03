// /dashboard — 운영자 대시보드 (T1.5 타임라인 + T2.6 스탯·피드·충돌 배너·모바일, Stitch b1/b1-mobile)
// RSC: prisma 직접 조회 — (admin) 레이아웃 role 가드 + 미들웨어 이중 보호 아래에서만 렌더
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadTimeline } from "@/lib/timeline";
import {
  loadDashboardStats,
  loadActivityFeed,
  relativeTimeParts,
  type FeedDot,
} from "@/lib/dashboard";
import { findUnresolvedIcalConflicts } from "@/lib/ical";
import { countCostAlertGroups } from "@/lib/cost-alerts";
import { loadInventoryShortageSummary } from "@/lib/minibar-inventory-load";
import { getFxVndPerKrw, suggestSalePriceKrw } from "@/lib/pricing";
import { formatThousands, formatDateTime } from "@/lib/format";
import TimelineMatrix from "@/components/admin/timeline-matrix";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("dashboard")} — Villa Go` };
}

const DOT_CLASS: Record<FeedDot, string> = {
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-400",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  slate: "bg-slate-500",
};

export default async function DashboardPage() {
  const now = new Date();
  const [session, t, tInv, timeline, stats, feed, conflicts, fx, lastSync, inventory] =
    await Promise.all([
      auth(),
      getTranslations("adminDashboard"),
      getTranslations("inventory"),
      loadTimeline(prisma),
      loadDashboardStats(prisma, now),
      loadActivityFeed(prisma),
      findUnresolvedIcalConflicts(prisma), // ADMIN 전용 전제 — 레이아웃 가드 아래
      getFxVndPerKrw(prisma),
      prisma.calendarBlock.findFirst({
        where: { source: "ICAL" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      // 미니바 부족 집계(원가 무관 — 현재고 vs par만, 전 운영자 노출 가능)
      loadInventoryShortageSummary(prisma),
    ]);

  // S-RBAC-3: STAFF는 정산·매출·원가경보 등 재무 위젯 비표시 (canViewFinance 게이트)
  const showFinance = canViewFinance(session?.user?.role);

  // 견적 중 원가 변경 경보 개수 (b15, F) — 본인 ADMIN PENDING 그룹 수.
  // 원가경보(/cost-alerts)는 재무 영역(미들웨어 차단 대상)이므로 STAFF에는 0 처리(배너 미표시)
  const tCost = await getTranslations("adminCostAlerts");
  const costAlertCount =
    showFinance && session?.user?.id
      ? await countCostAlertGroups(prisma, session.user.id)
      : 0;

  const firstConflict = conflicts[0];
  const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  // 환율 칩: 1,000,000₫ ≈ X원 (FX 미설정 시 숨김 — 2차 회의: USD 표기 폐기)
  const fxKrw = fx ? suggestSalePriceKrw(1_000_000n, fx) : null;

  const relTime = (at: Date) => {
    const r = relativeTimeParts(now, at);
    if (r.key === "justNow") return t("feed.justNow");
    if (r.key === "minutesAgo") return t("feed.minutesAgo", { n: r.n });
    if (r.key === "hoursAgo") return t("feed.hoursAgo", { n: r.n });
    return r.date;
  };

  // 모바일 박스 카드 (b1-mobile 박스 그리드 — 3차 회의). 숫자 + 클릭 시 리스트 이동
  const BoxCard = ({
    href,
    label,
    count,
    unit,
    icon,
    iconClass,
    badge,
  }: {
    href: string;
    label: string;
    count: number;
    unit: string;
    icon: string;
    iconClass: string;
    badge?: string | null;
  }) => (
    <Link
      href={href}
      className="bg-admin-card p-4 rounded-xl border border-slate-700/50 active:scale-[0.98] hover:ring-1 hover:ring-blue-500 transition-all group"
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        <span className={`material-symbols-outlined ${iconClass} group-hover:scale-110 transition-transform`}>
          {icon}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xl font-bold text-white tabular-nums">{count}</span>
        <span className="text-xs text-slate-500">{unit}</span>
        {badge && (
          <span className="bg-amber-500/20 text-amber-500 text-[10px] px-2 py-0.5 rounded font-bold">
            {badge}
          </span>
        )}
      </div>
    </Link>
  );

  return (
    <div className="space-y-6">
      {/* 승인 대기 빌라 배너 (T-admin-supplier-visibility) — 공급자 신규 등록·재제출, 있을 때만 */}
      {stats.villaPendingReviewCount > 0 && (
        <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-sky-400 shrink-0">villa</span>
            <p className="text-sm font-medium text-sky-100 [word-break:keep-all]">
              <span className="font-bold text-sky-300">{t("villaPending.bannerTitle")}</span>
              {" — "}
              {t("villaPending.bannerBody", { count: stats.villaPendingReviewCount })}
            </p>
          </div>
          <Link
            href="/villas?status=pending"
            className="shrink-0 text-xs font-bold text-sky-300 hover:text-sky-200 border border-sky-500/40 rounded-lg px-3 py-1.5 transition-colors"
          >
            {t("villaPending.bannerCta")}
          </Link>
        </div>
      )}

      {/* 소비자 확인 필요 배너 (A1·A4) — 입금통보·옵션요청·취소 미환불, 있을 때만 */}
      {(stats.paymentNoticePendingCount > 0 ||
        stats.serviceOrderRequestedCount > 0 ||
        stats.cancelledUnrefundedCount > 0) && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-6 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-rose-400 shrink-0">notifications_active</span>
            <p className="text-sm font-bold text-rose-300 [word-break:keep-all]">
              {t("consumerSignals.bannerTitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pl-9">
            {stats.paymentNoticePendingCount > 0 && (
              <Link
                href="/bookings?status=hold"
                className="text-xs font-bold text-rose-200 hover:text-white border border-rose-500/40 rounded-lg px-3 py-1.5 transition-colors"
              >
                {t("consumerSignals.paymentNotice", { count: stats.paymentNoticePendingCount })}
              </Link>
            )}
            {stats.serviceOrderRequestedCount > 0 && (
              <Link
                href="/service-orders/requests"
                className="text-xs font-bold text-rose-200 hover:text-white border border-rose-500/40 rounded-lg px-3 py-1.5 transition-colors"
              >
                {t("consumerSignals.serviceRequests", { count: stats.serviceOrderRequestedCount })}
              </Link>
            )}
            {stats.cancelledUnrefundedCount > 0 && (
              <Link
                href="/bookings?status=closed"
                className="text-xs font-bold text-rose-200 hover:text-white border border-rose-500/40 rounded-lg px-3 py-1.5 transition-colors"
              >
                {t("consumerSignals.cancelledUnrefunded", { count: stats.cancelledUnrefundedCount })}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* 견적 중 원가 변경 경보 배너 (b15, F) — 본인 PENDING 알림 있을 때만 */}
      {costAlertCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-amber-500 shrink-0">warning</span>
            <p className="text-sm font-medium text-amber-100 [word-break:keep-all]">
              <span className="font-bold text-amber-400">{tCost("bannerTitle")}</span>
              {" — "}
              {costAlertCount > 1
                ? tCost("bannerBody", { count: costAlertCount })
                : tCost("bannerBodyOne")}
            </p>
          </div>
          <Link
            href="/cost-alerts"
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold px-3 py-1.5 rounded shadow-lg transition-colors whitespace-nowrap shrink-0"
          >
            {tCost("review")}
          </Link>
        </div>
      )}

      {/* iCal 충돌 경보 배너 (b1) — 미해결 충돌 있을 때만 */}
      {firstConflict && (
        <div className="bg-red-900/40 border border-red-800/50 rounded-xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-red-500 shrink-0">warning</span>
            <p className="text-sm font-medium text-red-100 truncate">
              <span className="font-bold">{t("banner.title")}:</span>{" "}
              {t("banner.message", {
                villa: firstConflict.villaName,
                range: `${md(firstConflict.blockStart)}~${md(firstConflict.blockEnd)}`,
              })}
              {conflicts.length > 1 && (
                <span className="ml-2 text-red-300">
                  {t("banner.more", { n: conflicts.length - 1 })}
                </span>
              )}
            </p>
          </div>
          <Link
            href={`/bookings/${firstConflict.bookingId}`}
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg transition-colors whitespace-nowrap shrink-0"
          >
            {t("banner.resolve")}
          </Link>
        </div>
      )}

      {/* 미니바 재고 부족 배너 (ADR-0019 S1) — 부족 품목 있을 때만. 원가 무관(전 운영자) */}
      {inventory.lowItemCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-red-400 shrink-0">inventory_2</span>
            <p className="text-sm font-medium text-red-200 [word-break:keep-all]">
              <span className="font-bold text-red-300">{tInv("banner.title")}</span>
              {" — "}
              {inventory.lowItemCount > 1
                ? tInv("banner.body", {
                    items: inventory.lowItemCount,
                    villas: inventory.lowVillaCount,
                  })
                : tInv("banner.bodyOne")}
            </p>
          </div>
          <Link
            href="/inventory"
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg transition-colors whitespace-nowrap shrink-0"
          >
            {tInv("banner.review")}
          </Link>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-white mb-2">{t("title")}</h1>
        <p className="text-gray-400">{t("greeting", { name: session?.user?.name ?? "" })}</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* 좌측 9: 스탯 + 타임라인/오늘 리스트 */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          {/* 스탯 카드 4종 (b1) — 데스크톱 전용. 모바일은 아래 박스 그리드(3차 회의) */}
          <div className="hidden lg:grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4">
            <Link
              href="/bookings?filter=today-checkin"
              className="bg-admin-card p-4 rounded-xl border border-slate-700/50 hover:ring-1 hover:ring-blue-500 transition-all group"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[11px] xl:text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t("stats.checkinToday")}
                </span>
                <span className="material-symbols-outlined text-blue-500 group-hover:scale-110 transition-transform">
                  login
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl xl:text-3xl font-bold text-white tabular-nums">
                  {stats.checkinToday.length}
                </span>
                <span className="text-xs text-slate-500">{t("stats.unitCase")}</span>
              </div>
            </Link>
            <Link
              href="/bookings?filter=today-checkout"
              className="bg-admin-card p-4 rounded-xl border border-slate-700/50 hover:ring-1 hover:ring-blue-500 transition-all group"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[11px] xl:text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t("stats.checkoutToday")}
                </span>
                <span className="material-symbols-outlined text-indigo-400 group-hover:scale-110 transition-transform">
                  logout
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl xl:text-3xl font-bold text-white tabular-nums">
                  {stats.checkoutToday.length}
                </span>
                <span className="text-xs text-slate-500">{t("stats.unitCase")}</span>
              </div>
            </Link>
            <Link
              href="/bookings?status=hold"
              className="bg-admin-card p-4 rounded-xl border border-slate-700/50 hover:ring-1 hover:ring-blue-500 transition-all group"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[11px] xl:text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t("stats.holdsActive")}
                </span>
                <span className="material-symbols-outlined text-amber-500 group-hover:scale-110 transition-transform">
                  hourglass_top
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl xl:text-3xl font-bold text-white tabular-nums">{stats.holdCount}</span>
                {stats.nextHoldExpiryHours !== null && (
                  <span className="bg-amber-500/20 text-amber-500 text-[10px] px-2 py-0.5 rounded font-bold">
                    {t("stats.expiresIn", { h: stats.nextHoldExpiryHours })}
                  </span>
                )}
              </div>
            </Link>
            <Link
              href="/inspections"
              className="bg-admin-card p-4 rounded-xl border border-slate-700/50 hover:ring-1 hover:ring-blue-500 transition-all group"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[11px] xl:text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t("stats.cleaningPending")}
                </span>
                <span className="material-symbols-outlined text-emerald-500 group-hover:scale-110 transition-transform">
                  cleaning_services
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl xl:text-3xl font-bold text-white tabular-nums">
                  {stats.cleaningPendingCount}
                </span>
                <span className="text-xs text-slate-500">{t("stats.unitSpot")}</span>
              </div>
            </Link>
          </div>

          {/* 데스크톱: 타임라인 (T1.5) */}
          <div className="hidden lg:block">
            <TimelineMatrix data={timeline} />
          </div>

          {/* 모바일 <lg: 박스 그리드 (b1-mobile — 3차 회의). 인라인 리스트 폐기, 박스 클릭 → 리스트 */}
          <div className="lg:hidden space-y-5">
            {/* 현황 박스: 오늘 체크인·체크아웃·청소 검수 대기·최근 활동 */}
            <section>
              <div className="flex items-center justify-between mb-2.5 px-1">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {t("boxes.statusTitle")}
                </h2>
                <span className="text-[11px] text-slate-500 tabular-nums">{stats.todayLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <BoxCard
                  href="/bookings?filter=today-checkin"
                  label={t("stats.checkinToday")}
                  count={stats.checkinToday.length}
                  unit={t("stats.unitCase")}
                  icon="login"
                  iconClass="text-blue-500"
                />
                <BoxCard
                  href="/bookings?filter=today-checkout"
                  label={t("stats.checkoutToday")}
                  count={stats.checkoutToday.length}
                  unit={t("stats.unitCase")}
                  icon="logout"
                  iconClass="text-indigo-400"
                />
                <BoxCard
                  href="/inspections"
                  label={t("stats.cleaningPending")}
                  count={stats.cleaningPendingCount}
                  unit={t("stats.unitSpot")}
                  icon="cleaning_services"
                  iconClass="text-emerald-500"
                />
                <BoxCard
                  href="/activity"
                  label={t("boxes.activity")}
                  count={stats.activityRecentCount}
                  unit={t("stats.unitCase")}
                  icon="history"
                  iconClass="text-slate-400"
                />
              </div>
            </section>

            {/* 바로가기 박스: 예약(전 운영자) + 제안·정산(canViewFinance만) */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 px-1">
                {t("boxes.shortcutTitle")}
              </h2>
              <div className={`grid gap-3 ${showFinance ? "grid-cols-3" : "grid-cols-1"}`}>
                <BoxCard
                  href="/bookings"
                  label={t("boxes.bookings")}
                  count={stats.bookingActiveCount}
                  unit={t("stats.unitCase")}
                  icon="calendar_month"
                  iconClass="text-blue-500"
                />
                {/* 제안·정산 = 재무/가격 영역. STAFF는 미들웨어 차단 대상이므로 박스도 비표시 */}
                {showFinance && (
                  <>
                    <BoxCard
                      href="/proposals"
                      label={t("boxes.proposals")}
                      count={stats.proposalActiveCount}
                      unit={t("stats.unitCase")}
                      icon="rate_review"
                      iconClass="text-amber-500"
                    />
                    <BoxCard
                      href="/settlements"
                      label={t("boxes.settlements")}
                      count={stats.settlementPendingCount}
                      unit={t("stats.unitCase")}
                      icon="payments"
                      iconClass="text-emerald-500"
                    />
                  </>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 우측 3: 최근 활동 피드 (b1) — 데스크톱 전용. 모바일은 활동 박스→/activity (3차 회의) */}
        <div className="hidden lg:block col-span-12 lg:col-span-3">
          <div className="bg-admin-card rounded-xl border border-slate-700/50 flex flex-col h-full">
            <div className="p-4 border-b border-slate-700/50">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-slate-400 text-lg">history</span>
                {t("feed.title")}
              </h3>
            </div>
            <div className="p-4 space-y-6">
              {feed.length === 0 ? (
                <p className="text-xs text-slate-500">{t("feed.empty")}</p>
              ) : (
                feed.map((item, i) => (
                  <div
                    key={item.id}
                    className={`relative pl-6 ${
                      i < feed.length - 1
                        ? "before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-[-24px] before:w-px before:bg-slate-700"
                        : ""
                    }`}
                  >
                    <div
                      className={`absolute left-[-4px] top-1.5 w-2 h-2 rounded-full ${DOT_CLASS[item.dot]} ring-4 ring-admin-card`}
                    />
                    <div className="flex justify-between items-start mb-1 gap-2">
                      <p className="text-xs font-bold text-white">
                        {t(`feed.labels.${item.labelKey}`)}
                      </p>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap">
                        {relTime(item.at)}
                      </span>
                    </div>
                    {item.detail && (
                      <p className="text-[11px] text-slate-400 leading-relaxed">{item.detail}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 푸터 글로벌 스탯 (b1 — USD 표기 폐기, 2차 회의) */}
      <footer className="bg-slate-900 border border-slate-800 rounded-xl px-6 py-3 flex flex-wrap justify-between items-center gap-3 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {t("footer.systemOk")}
          </div>
          {lastSync && (
            <div>{t("footer.lastSync", { at: formatDateTime(lastSync.createdAt) })}</div>
          )}
        </div>
        {/* 환율 칩(₫→원 환산) = 재무 신호 → canViewFinance만 */}
        {showFinance && fxKrw !== null && (
          <div className="flex items-center px-2 py-0.5 rounded border border-slate-700 bg-slate-800/50 text-white text-[10px] font-medium tabular-nums">
            {t("footer.fxChip", { krw: formatThousands(fxKrw) })}
          </div>
        )}
      </footer>
    </div>
  );
}
