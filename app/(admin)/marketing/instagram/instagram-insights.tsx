"use client";

// 인스타그램 성과(인사이트) 섹션 — /marketing/instagram "발행됨" 탭 상단.
//   GET /api/instagram/insights/summary?range=7|30 소비. 요약 스트립 + 팔로워 스파크라인(인라인 SVG) +
//   반응 상위 포스트(도달 순). 스냅샷 0 상태를 기본으로 가정한 빈 상태 우선 설계(현재 발행 0건).
//   ★ 외부 차트 라이브러리 금지 — polyline 만. ★ 누수 없음: 지표는 도달·반응만(가격/원가 개념 부재).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

interface Snap {
  capturedOn: string;
  followerCount: number | null;
  reach: number | null;
  profileViews: number | null;
}

interface TopPost {
  id: string;
  villaName: string | null;
  kind: string;
  publishedAt: string | null;
  permalink: string | null;
  latestReach: number | null;
  insightsSyncedAt: string | null;
  metrics: Record<string, number>;
}

interface Summary {
  range: 7 | 30;
  account: { current: Snap | null; series: Snap[] };
  totals: { publishedCount: number; totalReach: number; postsInRange: number };
  topPosts: TopPost[];
}

const KIND_BADGE: Record<string, string> = {
  VILLA_SHOWCASE: "bg-teal-500/15 border-teal-500/30 text-teal-300",
  SERVICE: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300",
  INFO: "bg-slate-600/20 border-slate-600/40 text-slate-300",
  REELS: "bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300",
};

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ko-KR"));

/** 팔로워 series → polyline points (값 2개 이상 필요). 없으면 null. */
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

export default function InstagramInsights() {
  const t = useTranslations("adminInstagram");
  const [range, setRange] = useState<7 | 30>(7);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/instagram/insights/summary?range=${range}&top=8`, {
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
      data.account.series.map((s) => s.followerCount),
      240,
      48
    );
  }, [data]);

  // 데이터 전무(스냅샷 0 + 발행 0) 판정.
  const isEmpty =
    !!data &&
    data.account.current == null &&
    data.topPosts.length === 0 &&
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
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("insights.stat.followers")} value={fmt(data.account.current?.followerCount ?? null)} />
            <Stat label={t("insights.stat.rangeReach")} value={fmt(data.totals.totalReach)} />
            <Stat label={t("insights.stat.published")} value={fmt(data.totals.publishedCount)} />
            <Stat label={t("insights.stat.postsInRange")} value={fmt(data.totals.postsInRange)} />
          </div>

          {/* 팔로워 추이 스파크라인 */}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("insights.followerTrend")}
            </p>
            {spark ? (
              <svg
                viewBox="0 0 240 48"
                preserveAspectRatio="none"
                className="mt-2 h-12 w-full"
                role="img"
                aria-label={t("insights.followerTrend")}
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

          {/* 반응 상위 포스트 */}
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("insights.topTitle")}
            </p>
            {data.topPosts.length === 0 ? (
              <p className="mt-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-6 text-center text-[12px] text-slate-500">
                {t("insights.topEmpty")}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {data.topPosts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
                  >
                    <span
                      className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
                        KIND_BADGE[p.kind] ?? "border-slate-700 text-slate-400"
                      }`}
                    >
                      {t(`kind.${p.kind}`)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100">
                      {p.villaName ?? t("insights.noVilla")}
                    </span>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-slate-400">
                      <Metric icon="visibility" label={t("insights.metric.reach")} value={fmt(p.metrics.reach ?? p.latestReach ?? null)} />
                      <Metric icon="favorite" label={t("insights.metric.likes")} value={fmt(p.metrics.likes ?? null)} />
                      <Metric icon="chat_bubble" label={t("insights.metric.comments")} value={fmt(p.metrics.comments ?? null)} />
                      <Metric icon="bookmark" label={t("insights.metric.saved")} value={fmt(p.metrics.saved ?? null)} />
                    </div>
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
                      >
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        {t("insights.viewPost")}
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
