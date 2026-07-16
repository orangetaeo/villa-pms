// lib/youtube/stats.ts — 유튜브 쇼츠 성과 수집 (marketing-s2 §B)
//
// Data API videos.list?part=statistics&id=...(50개 배치, 1유닛/콜) — 추가 OAuth scope 불요.
//   getYoutubeAccessToken(lib/youtube/auth) 재사용. Analytics API(시청시간)는 scope 재동의 필요라 범위 제외.
//
// 정본 = InstagramInsightSnapshot(scope=YT_MEDIA, igMediaId=ytVideoId — 컬럼명 wart 승인·일별 추이),
//   캐시 = YoutubeShort.latest*(뱃지·정렬 전용). 인스타 insights.ts와 대칭 구조.
//
// ★ 누수: 조회수·좋아요·댓글수엔 가격/원가/마진 개념이 없다. 공개 지표만 저장.
import { IgInsightScope, YtShortStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { getYoutubeAccessToken } from "@/lib/youtube/auth";

const YT_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const HTTP_TIMEOUT_MS = 20_000;
const BATCH_SIZE = 50; // videos.list id= 파라미터 상한
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface YoutubeVideoStats {
  views: number | null;
  likes: number | null; // 좋아요 비공개 영상은 null(필드 부재)
  comments: number | null; // 댓글 비공개 영상은 null
}

/** statistics 값(문자열/숫자) → number|null. 음수·비정상은 null. */
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.trunc(v);
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type YoutubeStatsResult =
  | { ok: true; stats: Map<string, YoutubeVideoStats> }
  | { ok: false; reason: string };

/**
 * videos.list statistics 조회 — videoId 배열 → {videoId: {views,likes,comments}} 맵.
 *  - 50개씩 배치. 응답에 없는 id(삭제·비공개)는 맵에서 누락(호출부가 스킵).
 *  - 토큰 미연결/갱신 실패·API 오류는 { ok:false, reason }(throw 안 함).
 */
export async function fetchYoutubeVideoStats(
  videoIds: string[],
  db: DbClient = prisma
): Promise<YoutubeStatsResult> {
  const ids = [...new Set(videoIds.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (ids.length === 0) return { ok: true, stats: new Map() };

  const token = await getYoutubeAccessToken(db);
  if (!token.ok) return { ok: false, reason: token.reason };

  const stats = new Map<string, YoutubeVideoStats>();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const qs = new URLSearchParams({ part: "statistics", id: batch.join(","), maxResults: String(batch.length) });
    let json: Record<string, unknown>;
    try {
      const res = await fetch(`${YT_VIDEOS_ENDPOINT}?${qs}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const msg = (json.error as { message?: string } | undefined)?.message;
        return { ok: false, reason: `videos.list HTTP ${res.status}: ${msg ?? "unknown"}`.slice(0, 300) };
      }
    } catch (e) {
      return { ok: false, reason: `videos.list 오류: ${e instanceof Error ? e.name : "error"}` };
    }
    const items = Array.isArray(json.items) ? json.items : [];
    for (const raw of items) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id : null;
      if (!id) continue;
      const s = (item.statistics ?? {}) as Record<string, unknown>;
      stats.set(id, { views: toNum(s.viewCount), likes: toNum(s.likeCount), comments: toNum(s.commentCount) });
    }
  }
  return { ok: true, stats };
}

export interface YoutubeStatsSyncSummary {
  /** 수집 대상(게이트 통과 PUBLISHED 쇼츠) 수. */
  targeted: number;
  /** 캐시·스냅샷 갱신 성공 수. */
  ok: number;
  /** 전체 실패(토큰·API 오류) 사유 — 있으면 대상>0인데 ok=0. */
  reason?: string;
}

/**
 * PUBLISHED 쇼츠 성과 수집 → YoutubeShort 캐시 + InstagramInsightSnapshot(YT_MEDIA) upsert.
 *   인스타 insights와 동일한 게이트: 최근 30일 발행분 매일 + 그 이전은 미수집/7일 경과분만(주 1회).
 *   ★ 멱등: 스냅샷 upsert 키 = @@unique([scope, igMediaId, capturedOn]).
 */
export async function syncYoutubeShortStats(
  capturedOn: Date,
  db: DbClient = prisma
): Promise<YoutubeStatsSyncSummary> {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS);
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS);

  const shorts = await db.youtubeShort.findMany({
    where: {
      status: YtShortStatus.PUBLISHED,
      ytVideoId: { not: null },
      OR: [
        { publishedAt: { gte: thirtyDaysAgo } },
        { publishedAt: null },
        { statsSyncedAt: null },
        { statsSyncedAt: { lt: sevenDaysAgo } },
      ],
    },
    orderBy: { publishedAt: "desc" },
    select: { id: true, ytVideoId: true },
  });

  if (shorts.length === 0) return { targeted: 0, ok: 0 };

  // ytVideoId → shortId (같은 영상이 두 행에 없다는 가정 — ytVideoId는 발행 1건당 고유).
  const idToShort = new Map<string, string>();
  for (const s of shorts) if (s.ytVideoId) idToShort.set(s.ytVideoId, s.id);

  const res = await fetchYoutubeVideoStats([...idToShort.keys()], db);
  if (!res.ok) return { targeted: shorts.length, ok: 0, reason: res.reason };

  let ok = 0;
  const syncedAt = new Date();
  for (const [videoId, shortId] of idToShort) {
    const st = res.stats.get(videoId);
    if (!st) continue; // 응답에 없음(삭제·비공개) — 스킵(다음 실행 재시도)

    const metrics: Record<string, number> = {};
    if (st.views != null) metrics.views = st.views;
    if (st.likes != null) metrics.likes = st.likes;
    if (st.comments != null) metrics.comments = st.comments;
    if (Object.keys(metrics).length === 0) continue; // 전 지표 부재 — 쓰기 없음(주간 게이트 유지)

    await db.youtubeShort.update({
      where: { id: shortId },
      data: {
        latestViews: st.views,
        latestLikes: st.likes,
        latestComments: st.comments,
        statsSyncedAt: syncedAt,
      },
    });
    await db.instagramInsightSnapshot.upsert({
      where: {
        scope_igMediaId_capturedOn: {
          scope: IgInsightScope.YT_MEDIA,
          igMediaId: videoId, // YT_MEDIA 스코프는 igMediaId 자리에 ytVideoId 저장(컬럼명 wart 승인)
          capturedOn,
        },
      },
      create: {
        scope: IgInsightScope.YT_MEDIA,
        igMediaId: videoId,
        postId: null, // YT_MEDIA는 InstagramPost 연결 없음
        capturedOn,
        metricsJson: metrics,
      },
      update: { metricsJson: metrics },
    });
    ok++;
  }

  return { targeted: shorts.length, ok };
}
