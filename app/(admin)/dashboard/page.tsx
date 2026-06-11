// /dashboard — 운영자 대시보드 (T1.5 타임라인 + T2.6 스탯·피드·충돌 배너·모바일, Stitch b1/b1-mobile)
// RSC: prisma 직접 조회 — (admin) 레이아웃 role 가드 + 미들웨어 이중 보호 아래에서만 렌더
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadTimeline } from "@/lib/timeline";
import {
  loadDashboardStats,
  loadActivityFeed,
  relativeTimeParts,
  type FeedDot,
  type TodayBookingItem,
} from "@/lib/dashboard";
import { findUnresolvedIcalConflicts } from "@/lib/ical";
import { getFxVndPerKrw, suggestSalePriceKrw } from "@/lib/pricing";
import { formatThousands, formatDateTime } from "@/lib/format";
import TimelineMatrix from "@/components/admin/timeline-matrix";

export const metadata: Metadata = {
  title: "대시보드 — Villa PMS",
};

const DOT_CLASS: Record<FeedDot, string> = {
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-400",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  slate: "bg-slate-500",
};

const TODAY_STATUS_BADGE: Record<string, string> = {
  CONFIRMED: "bg-blue-600/20 text-blue-400",
  CHECKED_IN: "bg-indigo-600/20 text-indigo-400",
  CHECKED_OUT: "bg-slate-700/60 text-slate-300",
};

export default async function DashboardPage() {
  const now = new Date();
  const [session, t, timeline, stats, feed, conflicts, fx, lastSync] = await Promise.all([
    auth(),
    getTranslations("adminDashboard"),
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
  ]);

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

  const TodayCard = ({ item, sub }: { item: TodayBookingItem; sub: string }) => (
    <Link
      href={`/bookings/${item.id}`}
      className="bg-admin-card border border-slate-700/50 rounded-xl px-4 py-3 flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">{item.villaName}</p>
        <p className="text-[11px] text-slate-400 truncate">{sub}</p>
      </div>
      <span
        className={`${TODAY_STATUS_BADGE[item.status] ?? "bg-slate-700/60 text-slate-300"} text-[10px] font-bold px-2 py-0.5 rounded shrink-0`}
      >
        {t(`status.${item.status}`)}
      </span>
      <span className="material-symbols-outlined text-slate-600 text-sm shrink-0">
        chevron_right
      </span>
    </Link>
  );

  return (
    <div className="space-y-6">
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

      <div>
        <h1 className="text-2xl font-bold text-white mb-2">{t("title")}</h1>
        <p className="text-gray-400">{t("greeting", { name: session?.user?.name ?? "" })}</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* 좌측 9: 스탯 + 타임라인/오늘 리스트 */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          {/* 스탯 카드 4종 (b1) */}
          {/* b1-mobile: <xl 콤팩트 2×2 그리드 */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4">
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

          {/* 모바일 <lg: 오늘 중심 리스트 (b1-mobile — 2차 회의 결정) */}
          <div className="lg:hidden space-y-6">
            <section>
              <div className="flex items-center justify-between mb-2.5 px-1">
                <h2 className="text-sm font-bold text-white">{t("today.checkinTitle")}</h2>
                <span className="text-[11px] text-slate-500 tabular-nums">{stats.todayLabel}</span>
              </div>
              <div className="space-y-2">
                {stats.checkinToday.length === 0 ? (
                  <p className="text-xs text-slate-500 px-1">{t("today.empty")}</p>
                ) : (
                  stats.checkinToday.map((b) => (
                    <TodayCard
                      key={b.id}
                      item={b}
                      sub={`${b.guestName} · ${t("today.nights", { n: b.nights })}`}
                    />
                  ))
                )}
              </div>
            </section>
            <section>
              <h2 className="text-sm font-bold text-white mb-2.5 px-1">
                {t("today.checkoutTitle")}
              </h2>
              <div className="space-y-2">
                {stats.checkoutToday.length === 0 ? (
                  <p className="text-xs text-slate-500 px-1">{t("today.empty")}</p>
                ) : (
                  stats.checkoutToday.map((b) => <TodayCard key={b.id} item={b} sub={b.guestName} />)
                )}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between mb-2.5 px-1">
                <h2 className="text-sm font-bold text-white">{t("today.cleaningTitle")}</h2>
                <Link href="/inspections" className="text-[11px] text-blue-500 font-semibold">
                  {t("today.viewAll")}
                </Link>
              </div>
              <div className="space-y-2">
                {stats.cleaningPending.length === 0 ? (
                  <p className="text-xs text-slate-500 px-1">{t("today.empty")}</p>
                ) : (
                  stats.cleaningPending.map((c) => (
                    <Link
                      key={c.id}
                      href={`/inspections?task=${c.id}`}
                      className="bg-admin-card border border-slate-700/50 rounded-xl px-4 py-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white">{c.villaName}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                          <span className="tabular-nums">{c.submittedDate}</span> ·{" "}
                          {t("today.photos", { n: c.photoCount })}
                        </p>
                      </div>
                      <span className="bg-amber-500/20 text-amber-500 text-[10px] font-bold px-2 py-0.5 rounded shrink-0">
                        {t("today.awaitingApproval")}
                      </span>
                      <span className="material-symbols-outlined text-slate-600 text-sm shrink-0">
                        chevron_right
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 우측 3: 최근 활동 피드 (b1) */}
        <div className="col-span-12 lg:col-span-3">
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
        {fxKrw !== null && (
          <div className="flex items-center px-2 py-0.5 rounded border border-slate-700 bg-slate-800/50 text-white text-[10px] font-medium tabular-nums">
            {t("footer.fxChip", { krw: formatThousands(fxKrw) })}
          </div>
        )}
      </footer>
    </div>
  );
}
