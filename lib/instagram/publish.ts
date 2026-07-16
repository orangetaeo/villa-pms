// lib/instagram/publish.ts — Instagram Graph API 발행 클라이언트 (Content Publishing)
//
// 기준: "Instagram API with Instagram Login". base = https://graph.instagram.com/v23.0
//   (AppSetting IG_GRAPH_BASE로 오버라이드 가능 — 버전 상승 대비).
// 흐름(캐러셀): 자식 컨테이너 N개 생성(is_carousel_item=true, image_url) → 각 FINISHED 폴링
//   → CAROUSEL 부모 컨테이너(children, caption) → FINISHED 폴링 → /media_publish → permalink 조회.
// 단일 이미지(1장): IMAGE 컨테이너 하나 → 폴링 → publish.
//
// ★ 게이트: ① IG_AUTOPOST_PAUSED="1" → skip(발행 안 함) ② 토큰/IG_USER_ID 미설정 → 실패 반환(throw 아님).
//   토큰은 AppSetting에서 복호화(lib/instagram/settings). 에러는 Graph API error.message 보존.
// ★ 이미지 URL: Meta 서버가 직접 fetch하므로 **공개 절대 URL 필수**. 상대(/uploads/…)면 앱 origin으로 절대화.
import {
  getIgAccessToken,
  getIgUserId,
  getIgGraphBase,
  isAutopostPaused,
} from "@/lib/instagram/settings";

const CONTAINER_POLL_INTERVAL_MS = 2_000;
const CONTAINER_POLL_TIMEOUT_MS = 60_000;
// 릴스(동영상)는 서버 트랜스코딩에 수 분이 걸릴 수 있어 폴링 상한·간격을 별도로 상향(§B).
const REEL_POLL_INTERVAL_MS = 5_000;
const REEL_POLL_TIMEOUT_MS = 300_000; // 최대 5분
const HTTP_TIMEOUT_MS = 30_000;

export type PublishResult =
  | { ok: true; mediaId: string; permalink: string | null }
  | { ok: false; skipped: true; reason: "AUTOPOST_PAUSED" }
  | { ok: false; skipped?: false; reason: string };

export interface PublishInput {
  /** 렌더된 이미지 URL 배열(1~10장). 첫 장이 커버. 공개 접근 가능해야 함. */
  imageUrls: string[];
  caption: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 상대 URL(/uploads/…)이면 공개 base로 절대화. R2 공개 URL(http…)은 그대로. */
export function toAbsoluteMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (
    process.env.IG_PUBLIC_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.PUBLIC_BASE_URL ??
    ""
  ).replace(/\/$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; type?: string };
}

/** Graph API POST(form-urlencoded) — 실패 시 error.message를 담아 throw. */
async function graphPost(
  base: string,
  pathSeg: string,
  params: Record<string, string>,
  token: string
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${base}/${pathSeg}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphErrorBody;
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `Graph API HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/** Graph API GET — 실패 시 error.message throw. */
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
    const msg = json.error?.message ?? `Graph API HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * 컨테이너가 FINISHED 될 때까지 폴링. ERROR/EXPIRED면 throw, 타임아웃도 throw.
 * @param opts 폴링 상한·간격 오버라이드(기본=이미지 컨테이너: 60s/2s, 릴스는 300s/5s).
 */
async function waitForContainer(
  base: string,
  containerId: string,
  token: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? CONTAINER_POLL_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? CONTAINER_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await graphGet(base, containerId, { fields: "status_code,status" }, token);
    const code = String(status.status_code ?? "");
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`컨테이너 처리 실패(status=${code}): ${String(status.status ?? "")}`.trim());
    }
    if (Date.now() > deadline) {
      throw new Error(`컨테이너 FINISHED 대기 타임아웃(마지막 status=${code || "IN_PROGRESS"})`);
    }
    await sleep(intervalMs);
  }
}

/**
 * 캐러셀/단일 이미지 발행. 게이트 통과 시 media id·permalink 반환.
 * @throws Graph API 오류(error.message) — 호출부가 catch해 FAILED 기록.
 */
export async function publishInstagramPost(input: PublishInput): Promise<PublishResult> {
  // ① 킬스위치.
  if (await isAutopostPaused()) {
    return { ok: false, skipped: true, reason: "AUTOPOST_PAUSED" };
  }
  // ② 자격 게이트 (throw 아님 — 명확한 사유 반환).
  const [token, userId, base] = await Promise.all([
    getIgAccessToken(),
    getIgUserId(),
    getIgGraphBase(),
  ]);
  if (!token) return { ok: false, reason: "IG_ACCESS_TOKEN 미설정" };
  if (!userId) return { ok: false, reason: "IG_USER_ID 미설정" };

  const urls = input.imageUrls.map(toAbsoluteMediaUrl);
  if (urls.length === 0) return { ok: false, reason: "발행할 이미지가 없습니다" };
  if (urls.length > 10) return { ok: false, reason: "캐러셀은 최대 10장입니다" };

  try {
    let creationId: string;

    if (urls.length === 1) {
      // 단일 이미지 컨테이너.
      const c = await graphPost(base, `${userId}/media`, { image_url: urls[0], caption: input.caption }, token);
      creationId = String(c.id);
      await waitForContainer(base, creationId, token);
    } else {
      // 자식 컨테이너 N개 → 각 FINISHED → 부모 CAROUSEL.
      const childIds: string[] = [];
      for (const url of urls) {
        const child = await graphPost(base, `${userId}/media`, { image_url: url, is_carousel_item: "true" }, token);
        childIds.push(String(child.id));
      }
      for (const id of childIds) {
        await waitForContainer(base, id, token);
      }
      const parent = await graphPost(
        base,
        `${userId}/media`,
        { media_type: "CAROUSEL", children: childIds.join(","), caption: input.caption },
        token
      );
      creationId = String(parent.id);
      await waitForContainer(base, creationId, token);
    }

    // 발행.
    const published = await graphPost(base, `${userId}/media_publish`, { creation_id: creationId }, token);
    const mediaId = String(published.id);

    // permalink 조회(실패해도 발행 자체는 성공 — permalink만 null).
    let permalink: string | null = null;
    try {
      const meta = await graphGet(base, mediaId, { fields: "permalink" }, token);
      permalink = typeof meta.permalink === "string" ? meta.permalink : null;
    } catch {
      permalink = null;
    }

    return { ok: true, mediaId, permalink };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface PublishReelInput {
  /** 발행할 MP4 공개 URL(Meta 서버가 직접 fetch). 상대 URL이면 앱 origin으로 절대화. */
  videoUrl: string;
  caption: string;
}

/**
 * 릴스(동영상) 발행 — media_type=REELS, video_url 컨테이너. 이미지 캐러셀 경로(publishInstagramPost)와
 * 독립(기존 경로 무변경). 게이트(킬스위치·토큰·userId)는 동일. 동영상 트랜스코딩이 수 분 걸릴 수 있어
 * 폴링 상한을 5분/5s로 상향.
 * @throws Graph API 오류(error.message) — 호출부가 catch해 FAILED 기록.
 */
export async function publishInstagramReel(input: PublishReelInput): Promise<PublishResult> {
  // ① 킬스위치.
  if (await isAutopostPaused()) {
    return { ok: false, skipped: true, reason: "AUTOPOST_PAUSED" };
  }
  // ② 자격 게이트.
  const [token, userId, base] = await Promise.all([getIgAccessToken(), getIgUserId(), getIgGraphBase()]);
  if (!token) return { ok: false, reason: "IG_ACCESS_TOKEN 미설정" };
  if (!userId) return { ok: false, reason: "IG_USER_ID 미설정" };

  const videoUrl = toAbsoluteMediaUrl(input.videoUrl);
  if (!videoUrl) return { ok: false, reason: "발행할 동영상 URL이 없습니다" };

  try {
    // REELS 컨테이너 생성 → 트랜스코딩 폴링(수 분) → 발행.
    const container = await graphPost(
      base,
      `${userId}/media`,
      { media_type: "REELS", video_url: videoUrl, caption: input.caption },
      token
    );
    const creationId = String(container.id);
    await waitForContainer(base, creationId, token, {
      timeoutMs: REEL_POLL_TIMEOUT_MS,
      intervalMs: REEL_POLL_INTERVAL_MS,
    });

    const published = await graphPost(base, `${userId}/media_publish`, { creation_id: creationId }, token);
    const mediaId = String(published.id);

    let permalink: string | null = null;
    try {
      const meta = await graphGet(base, mediaId, { fields: "permalink" }, token);
      permalink = typeof meta.permalink === "string" ? meta.permalink : null;
    } catch {
      permalink = null;
    }

    return { ok: true, mediaId, permalink };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
