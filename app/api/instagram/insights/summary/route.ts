// GET /api/instagram/insights/summary?range=7|30&top=N — 인스타 성과 요약 (admin, ko/다크)
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403.
//
// 응답:
//   {
//     range: 7 | 30,
//     account: {
//       current: { capturedOn, followerCount, reach, profileViews } | null,   // 최신 스냅샷
//       series: [{ capturedOn, followerCount, reach, profileViews }]          // 기간 내 ACCOUNT 스냅샷(capturedOn asc)
//     },
//     totals: { publishedCount, totalReach, postsInRange },
//     topPosts: [{ id, villaName, kind, publishedAt, permalink, latestReach, insightsSyncedAt, metrics }]  // latestReach desc
//   }
// metrics = InstagramPost.latestInsightsJson 원본 {reach,likes,comments,saved,shares,plays?}(숫자만). 가격/원가 개념 없음(누수 불가).
import { NextResponse } from "next/server";
import { IgInsightScope, IgPostStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { parseUtcDateOnly, todayVnDateString, addDateOnlyDays, toDateOnlyString } from "@/lib/date-vn";

const DEFAULT_TOP = 10;
const MAX_TOP = 50;

function asObj(json: unknown): Record<string, unknown> {
  return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

/** obj에서 keys 중 첫 숫자값 반환(별칭 폴백). */
function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

/** latestInsightsJson → 숫자 metric만 추린 객체. */
function numericMetrics(json: unknown): Record<string, number> {
  const src = asObj(json);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") === "7" ? 7 : 30;
  const top = Math.min(MAX_TOP, Math.max(1, Number(searchParams.get("top") ?? DEFAULT_TOP) || DEFAULT_TOP));

  const vnToday = todayVnDateString();
  // 기간 시작(포함) — 오늘 포함 range일.
  const fromStr = addDateOnlyDays(vnToday, -(range - 1));
  const fromDate = parseUtcDateOnly(fromStr) ?? undefined;

  const [accountSnaps, publishedCount, reachAgg, postsInRange, topPostRows] = await Promise.all([
    // 계정 추이(ACCOUNT, 기간 내, 오름차순).
    prisma.instagramInsightSnapshot.findMany({
      where: { scope: IgInsightScope.ACCOUNT, capturedOn: { gte: fromDate } },
      orderBy: { capturedOn: "asc" },
      select: { capturedOn: true, metricsJson: true },
    }),
    prisma.instagramPost.count({ where: { status: IgPostStatus.PUBLISHED } }),
    prisma.instagramPost.aggregate({
      where: { status: IgPostStatus.PUBLISHED },
      _sum: { latestReach: true },
    }),
    prisma.instagramPost.count({
      where: { status: IgPostStatus.PUBLISHED, publishedAt: { gte: fromDate } },
    }),
    prisma.instagramPost.findMany({
      where: { status: IgPostStatus.PUBLISHED },
      orderBy: [{ latestReach: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }],
      take: top,
      select: {
        id: true,
        kind: true,
        publishedAt: true,
        igPermalink: true,
        latestReach: true,
        insightsSyncedAt: true,
        latestInsightsJson: true,
        villa: { select: { name: true } },
      },
    }),
  ]);

  const series = accountSnaps.map((s) => {
    const m = asObj(s.metricsJson);
    return {
      capturedOn: toDateOnlyString(s.capturedOn),
      followerCount: pickNum(m, "followerCount", "followers_count"),
      reach: pickNum(m, "reach"),
      profileViews: pickNum(m, "profileViews", "profile_views"),
    };
  });

  const topPosts = topPostRows.map((p) => ({
    id: p.id,
    villaName: p.villa?.name ?? null,
    kind: p.kind,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    permalink: p.igPermalink,
    latestReach: p.latestReach ?? null,
    insightsSyncedAt: p.insightsSyncedAt?.toISOString() ?? null,
    metrics: numericMetrics(p.latestInsightsJson),
  }));

  return NextResponse.json({
    range,
    account: {
      current: series.length > 0 ? series[series.length - 1] : null,
      series,
    },
    totals: {
      publishedCount,
      totalReach: reachAgg._sum.latestReach ?? 0,
      postsInRange,
    },
    topPosts,
  });
}
