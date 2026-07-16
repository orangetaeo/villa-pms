// lib/instagram/insights.ts — Instagram 인사이트 수집 (Phase 2, instagram-marketing-p2 §C)
//
// 기준: "Instagram API with Instagram Login" (graph.instagram.com). 토큰·base = lib/instagram/settings 재사용.
// 정본 = InstagramInsightSnapshot(일별 추이), 캐시 = InstagramPost.latest*(카드 뱃지·정렬 전용).
//
// ★ 멱등: 스냅샷 upsert 키 = @@unique([scope, igMediaId, capturedOn]) → 당일 재실행=갱신.
//   ACCOUNT 스코프도 igMediaId:"" 센티널을 명시해야 unique/upsert가 성립(NULL 함정 회피).
// ★ 부분 저장: metric 셋 묶음 요청이 실패하면(예: REELS plays 미지원) metric 개별 재시도로 가용분만 저장한다.
// ★ 누수: 인사이트 지표(reach·likes 등)엔 가격/원가/마진 개념이 없다. 캡션·permalink만 발행 이력.
import { prisma } from "@/lib/prisma";
import { IgInsightScope, type IgPostKind } from "@prisma/client";
import type { DbClient } from "@/lib/availability";
import { getIgAccessToken, getIgUserId, getIgGraphBase } from "@/lib/instagram/settings";

const HTTP_TIMEOUT_MS = 20_000;

/** 피드(IMAGE·CAROUSEL) 미디어 인사이트 metric 셋. */
export const MEDIA_METRICS_FEED = ["reach", "likes", "comments", "saved", "shares"] as const;
/** 릴스(REELS) metric 셋 — plays 추가(피드엔 없음). 미지원 시 개별 누락 허용. */
export const MEDIA_METRICS_REELS = [
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "plays",
] as const;
/** 계정 인사이트 metric 셋(가용 시). followers_count는 별도 필드 조회로 확보. */
export const ACCOUNT_METRICS = ["reach", "profile_views"] as const;

/** 포스트 kind별 미디어 metric 셋(REELS만 plays 포함). */
export function mediaMetricsForKind(kind: IgPostKind | string): string[] {
  return kind === "REELS" ? [...MEDIA_METRICS_REELS] : [...MEDIA_METRICS_FEED];
}

export interface IgInsightsContext {
  base: string;
  token: string;
  userId: string;
}

/** 토큰·IG_USER_ID 미설정 시 null(수집 skip). base는 오버라이드/기본값. */
export async function loadInsightsContext(db: DbClient = prisma): Promise<IgInsightsContext | null> {
  const [token, userId, base] = await Promise.all([
    getIgAccessToken(db),
    getIgUserId(db),
    getIgGraphBase(db),
  ]);
  if (!token || !userId) return null;
  return { base, token, userId };
}

interface GraphErrorBody {
  error?: { message?: string };
}

/** Graph API GET — 실패 시 error.message throw(토큰 미포함). */
async function graphGet(
  base: string,
  pathSeg: string,
  params: Record<string, string>,
  token: string
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${base}/${pathSeg}?${qs}`, {
    method: "GET",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphErrorBody;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Graph API HTTP ${res.status}`);
  }
  return json;
}

/** insights 응답 entry에서 수치 추출 — newer(total_value.value) / older(values[]) 양쪽 대응. */
function readInsightValue(entry: unknown): number | null {
  const e = (entry ?? {}) as Record<string, unknown>;
  const tv = e.total_value as { value?: unknown } | undefined;
  if (tv && typeof tv.value === "number") return tv.value;
  const vals = e.values;
  if (Array.isArray(vals) && vals.length > 0) {
    const last = vals[vals.length - 1] as { value?: unknown };
    if (typeof last?.value === "number") return last.value;
  }
  return null;
}

/** insights data[] → {name: value}(숫자만). */
function parseInsightsData(json: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const data = json.data;
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    const v = readInsightValue(e);
    if (v != null) out[name] = v;
  }
  return out;
}

/**
 * 미디어 인사이트 조회: 묶음 1콜 → 실패 시 metric 개별 재시도(누락 허용).
 * REELS의 plays 등 미지원 metric 하나가 묶음 콜 전체를 400으로 떨구므로 개별 폴백이 핵심.
 */
async function fetchMediaMetrics(
  ctx: IgInsightsContext,
  igMediaId: string,
  metrics: string[]
): Promise<Record<string, number>> {
  try {
    const json = await graphGet(ctx.base, `${igMediaId}/insights`, { metric: metrics.join(",") }, ctx.token);
    return parseInsightsData(json);
  } catch {
    // 묶음 실패 → metric 개별 재시도(가용분만 수집).
    const out: Record<string, number> = {};
    for (const m of metrics) {
      try {
        const json = await graphGet(ctx.base, `${igMediaId}/insights`, { metric: m }, ctx.token);
        Object.assign(out, parseInsightsData(json));
      } catch {
        // 개별 metric 누락 허용
      }
    }
    return out;
  }
}

/** 계정 팔로워 수(필드 조회) — 실패 시 null. */
async function fetchAccountFollowers(ctx: IgInsightsContext): Promise<number | null> {
  try {
    const json = await graphGet(ctx.base, ctx.userId, { fields: "followers_count" }, ctx.token);
    const v = json.followers_count;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

/** 계정 인사이트(reach·profile_views) — period=day/metric_type=total_value. 실패 시 개별 폴백·빈 반환 허용. */
async function fetchAccountInsightMetrics(ctx: IgInsightsContext): Promise<Record<string, number>> {
  const common = { period: "day", metric_type: "total_value" };
  try {
    const json = await graphGet(
      ctx.base,
      `${ctx.userId}/insights`,
      { ...common, metric: ACCOUNT_METRICS.join(",") },
      ctx.token
    );
    return parseInsightsData(json);
  } catch {
    const out: Record<string, number> = {};
    for (const m of ACCOUNT_METRICS) {
      try {
        const json = await graphGet(ctx.base, `${ctx.userId}/insights`, { ...common, metric: m }, ctx.token);
        Object.assign(out, parseInsightsData(json));
      } catch {
        // 누락 허용
      }
    }
    return out;
  }
}

export interface MediaSyncResult {
  ok: boolean;
  reason?: string;
  metrics?: Record<string, number>;
}

/**
 * 미디어 1건 인사이트 수집 → 스냅샷 upsert + InstagramPost 캐시 갱신.
 * 전 metric 실패(빈 결과)면 ok:false — 쓰기 없음(주간 게이트 유지, 다음 실행 재시도).
 */
export async function syncMediaInsights(
  ctx: IgInsightsContext,
  post: { id: string; igMediaId: string; kind: IgPostKind | string },
  capturedOn: Date,
  db: DbClient = prisma
): Promise<MediaSyncResult> {
  const metrics = await fetchMediaMetrics(ctx, post.igMediaId, mediaMetricsForKind(post.kind));
  if (Object.keys(metrics).length === 0) {
    return { ok: false, reason: "지표 없음(전 metric 실패)" };
  }
  const reach = typeof metrics.reach === "number" ? Math.trunc(metrics.reach) : null;

  await db.instagramInsightSnapshot.upsert({
    where: {
      scope_igMediaId_capturedOn: {
        scope: IgInsightScope.MEDIA,
        igMediaId: post.igMediaId,
        capturedOn,
      },
    },
    create: {
      scope: IgInsightScope.MEDIA,
      igMediaId: post.igMediaId,
      postId: post.id,
      capturedOn,
      metricsJson: metrics,
    },
    update: { metricsJson: metrics, postId: post.id },
  });

  await db.instagramPost.update({
    where: { id: post.id },
    data: { latestReach: reach, latestInsightsJson: metrics, insightsSyncedAt: new Date() },
  });

  return { ok: true, metrics };
}

export interface AccountSyncResult {
  ok: boolean;
  reason?: string;
  metrics?: Record<string, number>;
}

/**
 * 계정 인사이트 수집 → ACCOUNT 스냅샷 upsert(igMediaId:""). followers_count + reach/profile_views(가용 시).
 * 전부 실패(빈 결과)면 ok:false. 부분(팔로워만 등)이라도 저장.
 */
export async function syncAccountInsights(
  ctx: IgInsightsContext,
  capturedOn: Date,
  db: DbClient = prisma
): Promise<AccountSyncResult> {
  const [followers, insightMetrics] = await Promise.all([
    fetchAccountFollowers(ctx),
    fetchAccountInsightMetrics(ctx),
  ]);
  const metrics: Record<string, number> = { ...insightMetrics };
  if (followers != null) metrics.followerCount = followers;

  if (Object.keys(metrics).length === 0) {
    return { ok: false, reason: "계정 지표 없음" };
  }

  await db.instagramInsightSnapshot.upsert({
    where: {
      scope_igMediaId_capturedOn: {
        scope: IgInsightScope.ACCOUNT,
        igMediaId: "",
        capturedOn,
      },
    },
    create: {
      scope: IgInsightScope.ACCOUNT,
      igMediaId: "",
      postId: null,
      capturedOn,
      metricsJson: metrics,
    },
    update: { metricsJson: metrics },
  });

  return { ok: true, metrics };
}
