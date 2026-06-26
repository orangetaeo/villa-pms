// /activity — 운영자 활동 내역 전체 (b1-mobile 활동 박스 → 리스트, 3차 회의)
// RSC: prisma 직접 조회. (admin) 레이아웃 role 가드 아래에서만 렌더.
// 피드에는 여권·판매가·마진·원가를 절대 싣지 않는다 (loadActivityFeed가 빌라·고객·기간만 합성).
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { loadActivityFeed, relativeTimeParts, type FeedDot } from "@/lib/dashboard";
import { quickRangeWhere } from "@/lib/date-vn";
import QuickDateFilter from "@/components/admin/quick-date-filter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("activity")} — Villa Go` };
}

// 과거 전용 로그 → nextMonth 제외
const ACTIVITY_PRESETS = [
  "all",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
] as const;

const DOT_CLASS: Record<FeedDot, string> = {
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-400",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  slate: "bg-slate-500",
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const now = new Date();
  const { range } = await searchParams;
  const [t, feedAll] = await Promise.all([
    getTranslations("adminDashboard"),
    loadActivityFeed(prisma, 50),
  ]);

  // 빠른 날짜 필터 — createdAt(at) 기준 [gte, lt). undefined=전체
  const window = quickRangeWhere(range, "timestamp", now);
  const feed = window
    ? feedAll.filter((item) => item.at >= window.gte && item.at < window.lt)
    : feedAll;

  const relTime = (at: Date) => {
    const r = relativeTimeParts(now, at);
    if (r.key === "justNow") return t("feed.justNow");
    if (r.key === "minutesAgo") return t("feed.minutesAgo", { n: r.n });
    if (r.key === "hoursAgo") return t("feed.hoursAgo", { n: r.n });
    return r.date;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 헤더 + 브레드크럼 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("activityPage.title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("activityPage.subtitle")}</p>
        </div>
        <Link
          href="/dashboard"
          className="text-xs text-blue-500 font-semibold whitespace-nowrap hover:underline"
        >
          {t("activityPage.backToDashboard")}
        </Link>
      </div>

      {/* 빠른 날짜 필터 바 (다크 톤, 목록 상단) */}
      <QuickDateFilter presets={[...ACTIVITY_PRESETS]} />

      <div className="bg-admin-card rounded-xl border border-slate-700/50 p-6">
        {feed.length === 0 ? (
          <p className="text-sm text-slate-500">{t("feed.empty")}</p>
        ) : (
          <div className="space-y-6">
            {feed.map((item, i) => (
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
                  <p className="text-sm font-bold text-white">{t(`feed.labels.${item.labelKey}`)}</p>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">
                    {relTime(item.at)}
                  </span>
                </div>
                {item.detail && (
                  <p className="text-xs text-slate-400 leading-relaxed">{item.detail}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
