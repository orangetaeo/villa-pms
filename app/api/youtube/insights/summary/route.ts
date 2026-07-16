// GET /api/youtube/insights/summary?range=7|30&top=N — 유튜브 쇼츠 성과 요약 (admin, ko/다크)
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403. (인스타 summary와 대칭)
//
// 응답:
//   {
//     range: 7 | 30,
//     totals: { publishedCount, totalViews, postsInRange },
//     series: [{ capturedOn, views, likes, comments }]   // YT_MEDIA 스냅샷 일별 합계(capturedOn asc)
//     topShorts: [{ id, villaName, title, publishedAt, ytVideoId, watchUrl, latestViews, latestLikes, latestComments, statsSyncedAt }]  // latestViews desc
//   }
// ★ 누수: 조회수·좋아요·댓글수엔 가격/원가/마진 개념 없음. villa는 name만 select.
import { NextResponse } from "next/server";
import { IgInsightScope, YtShortStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { parseUtcDateOnly, todayVnDateString, addDateOnlyDays, toDateOnlyString } from "@/lib/date-vn";

const DEFAULT_TOP = 10;
const MAX_TOP = 50;

function asObj(json: unknown): Record<string, unknown> {
  return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

/** obj에서 첫 숫자값 반환(별칭 폴백). */
function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") === "7" ? 7 : 30;
  const top = Math.min(MAX_TOP, Math.max(1, Number(searchParams.get("top") ?? DEFAULT_TOP) || DEFAULT_TOP));

  const vnToday = todayVnDateString();
  const fromStr = addDateOnlyDays(vnToday, -(range - 1));
  const fromDate = parseUtcDateOnly(fromStr) ?? undefined;

  const [mediaSnaps, publishedCount, viewsAgg, postsInRange, topShortRows] = await Promise.all([
    // YT_MEDIA 스냅샷(기간 내, 오름차순) — 일별 합계 시계열 재료.
    prisma.instagramInsightSnapshot.findMany({
      where: { scope: IgInsightScope.YT_MEDIA, capturedOn: { gte: fromDate } },
      orderBy: { capturedOn: "asc" },
      select: { capturedOn: true, metricsJson: true },
    }),
    prisma.youtubeShort.count({ where: { status: YtShortStatus.PUBLISHED } }),
    prisma.youtubeShort.aggregate({
      where: { status: YtShortStatus.PUBLISHED },
      _sum: { latestViews: true },
    }),
    prisma.youtubeShort.count({
      where: { status: YtShortStatus.PUBLISHED, publishedAt: { gte: fromDate } },
    }),
    prisma.youtubeShort.findMany({
      where: { status: YtShortStatus.PUBLISHED },
      orderBy: [{ latestViews: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }],
      take: top,
      select: {
        id: true,
        title: true,
        publishedAt: true,
        ytVideoId: true,
        latestViews: true,
        latestLikes: true,
        latestComments: true,
        statsSyncedAt: true,
        villa: { select: { name: true } },
      },
    }),
  ]);

  // 일별 합계 — 같은 capturedOn의 모든 YT_MEDIA 스냅샷 views/likes/comments 합산(누적값 총합 추이).
  const byDay = new Map<string, { views: number; likes: number; comments: number }>();
  for (const s of mediaSnaps) {
    const key = toDateOnlyString(s.capturedOn);
    const m = asObj(s.metricsJson);
    const cur = byDay.get(key) ?? { views: 0, likes: 0, comments: 0 };
    cur.views += pickNum(m, "views") ?? 0;
    cur.likes += pickNum(m, "likes") ?? 0;
    cur.comments += pickNum(m, "comments") ?? 0;
    byDay.set(key, cur);
  }
  const series = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([capturedOn, v]) => ({ capturedOn, ...v }));

  const topShorts = topShortRows.map((s) => ({
    id: s.id,
    villaName: s.villa?.name ?? null,
    title: s.title,
    publishedAt: s.publishedAt?.toISOString() ?? null,
    ytVideoId: s.ytVideoId,
    watchUrl: s.ytVideoId ? `https://www.youtube.com/shorts/${s.ytVideoId}` : null,
    latestViews: s.latestViews ?? null,
    latestLikes: s.latestLikes ?? null,
    latestComments: s.latestComments ?? null,
    statsSyncedAt: s.statsSyncedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    range,
    totals: {
      publishedCount,
      totalViews: viewsAgg._sum.latestViews ?? 0,
      postsInRange,
    },
    series,
    topShorts,
  });
}
