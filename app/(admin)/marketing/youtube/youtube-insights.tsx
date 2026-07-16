"use client";

// 유튜브 성과(인사이트) 섹션 — /marketing/youtube "발행됨" 탭 상단.
//   GET /api/youtube/insights/summary?range=7|30&top=N 소비. 요약 스트립 + 조회수 시계열 스파크라인(인라인 SVG) +
//   조회 상위 쇼츠(watchUrl 새 탭). 스냅샷 0 상태를 기본으로 가정한 빈 상태 우선 설계.
//   ★ 외부 차트 라이브러리 금지 — polyline 만. ★ 누수 없음: 지표는 조회·반응만(가격/원가 개념 부재).
//   instagram-insights.tsx 패턴 복제(대칭).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

interface Series {
  capturedOn: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

interface TopShort {
  id: string;
  villaName: string | null;
  title: string;
  publishedAt: string | null;
  ytVideoId: string | null;
  watchUrl: string | null;
  latestViews: number | null;
  latestLikes: number | null;
  latestComments: number | null;
  statsSyncedAt: string | null;
}

interface Summary {
  range: 7 | 30;
  totals: { publishedCount: number; totalViews: number; postsInRange: number };
  series: Series[];
  topShorts: TopShort[];
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ko-KR"));

/** series 값 → polyline points (값 2개 이상 필요). 없으면 null. */
function buildSpark(values: (number | null)[], w: number, h: number): string | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const n = values.length;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v == null) continue;
    const x = n === 1 ? 0 : (i / (n - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.length >= 2 ? pts.join(" ") : null;
}

export default function YoutubeInsights() {
  const t = useTranslations("adminYoutube");
  const [range, setRange] = useState<7 | 30>(7);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/youtube/insights/summary?range=${range}&top=8`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("load failed");
      setData((await res.json()) as Summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const spark = useMemo(() => {
    if (!data) return null;
    return buildSpark(
      data.series.map((s) => s.views),
      240,
      48
    );
  }, [data]);

  // 데이터 전무(시계열 0 + 발행 0) 판정.
  const isEmpty =
    !!data &&
    data.series.length === 0 &&
    data.topShorts.length === 0 &&
    data.totals.publishedCount === 0;

  const rangeToggle = (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
      {([7, 30] as const).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRange(r)}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            range === r
              ? "bg-admin-primary text-white"
              : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          {t(`insights.rangeToggle.${r}`)}
        </button>
      ))}
    </div>
  );

  return (
    <section className="rounded-xl border border-slate-800/50 bg-admin-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
          <span className="material-symbols-outlined text-[20px] text-slate-400">insights</span>
          {t("insights.title")}
        </h2>
        {rangeToggle}
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-red-400">{t("insights.loadError")}</p>
      ) : isEmpty ? (
        <div className="mt-4 flex flex-col items-center rounded-lg border border-dashed border-slate-700 px-6 py-12 text-center">
          <span className="material-symbols-outlined text-[36px] text-slate-600">query_stats</span>
          <p className="mt-2 text-sm font-bold text-slate-300">{t("insights.emptyTitle")}</p>
          <p className="mt-1 max-w-md text-[12px] text-slate-500">{t("insights.emptyHint")}</p>
        </div>
      ) : data ? (
        <>
          {/* 요약 스트립 */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label={t("insights.stat.totalViews")} value={fmt(data.totals.totalViews)} />
            <Stat label={t("insights.stat.published")} value={fmt(data.totals.publishedCount)} />
            <Stat label={t("insights.stat.postsInRange")} value={fmt(data.totals.postsInRange)} />
          </div>

          {/* 조회수 추이 스파크라인 */}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("insights.viewsTrend")}
            </p>
            {spark ? (
              <svg
                viewBox="0 0 240 48"
                preserveAspectRatio="none"
                className="mt-2 h-12 w-full"
                role="img"
                aria-label={t("insights.viewsTrend")}
              >
                <polyline
                  points={spark}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-admin-primary"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : (
              <p className="mt-2 text-[12px] text-slate-500">{t("insights.collecting")}</p>
            )}
          </div>

          {/* 조회 상위 쇼츠 */}
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("insights.topTitle")}
            </p>
            {data.topShorts.length === 0 ? (
              <p className="mt-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-6 text-center text-[12px] text-slate-500">
                {t("insights.topEmpty")}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {data.topShorts.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-100">
                        {s.villaName ?? t("insights.noVilla")}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">{s.title}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-slate-400">
                      <Metric icon="visibility" label={t("insights.metric.views")} value={fmt(s.latestViews)} />
                      <Metric icon="thumb_up" label={t("insights.metric.likes")} value={fmt(s.latestLikes)} />
                      <Metric icon="chat_bubble" label={t("insights.metric.comments")} value={fmt(s.latestComments)} />
                    </div>
                    {s.watchUrl && (
                      <a
                        href={s.watchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
                      >
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        {t("insights.viewShort")}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <span className="material-symbols-outlined text-[14px] text-slate-500">{icon}</span>
      {value}
    </span>
  );
}
