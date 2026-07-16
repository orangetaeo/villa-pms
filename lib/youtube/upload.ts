// lib/youtube/upload.ts — YouTube Data API v3 videos.insert 업로드 클라이언트 (youtube-shorts-s1)
//
// resumable 업로드(2단계): ① 세션 시작 POST(part=snippet,status, 메타 JSON) → Location 헤더 획득
//   ② 그 Location에 영상 바이트 PUT → 응답 JSON.id = video id. Shorts는 9:16·≤60s면 자동 판정(별도 플래그 불요).
//
// ★ 게이트 순서(계약 §3): ① 킬스위치 YT_AUTOPOST_PAUSED → ② 토큰(getYoutubeAccessToken, 실패=사유 반환)
//   → ③ 일 업로드 카운터(YT_DAILY_UPLOAD_CAP, 당일 KST PUBLISHED count) 초과=스킵 → ④ R2 영상 fetch → 업로드.
//   토큰 미설정·정지·상한초과는 throw가 아니라 결과 반환(인스타 publish 패턴). 에러 바디 보존.
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { getYoutubeAccessToken } from "@/lib/youtube/auth";
import {
  getYoutubeDailyUploadCap,
  getYoutubePrivacyStatus,
  isYoutubeAutopostPaused,
  type YtPrivacyStatus,
} from "@/lib/youtube/settings";
import { startOfKstDayUtc } from "@/lib/youtube/draft";

const HTTP_TIMEOUT_MS = 120_000; // 영상 업로드 — 넉넉한 상한
const RESUMABLE_START = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CATEGORY_TRAVEL = "19"; // Travel & Events

export type YoutubeUploadResult =
  | { ok: true; ytVideoId: string; url: string; privacyStatus: YtPrivacyStatus }
  | { ok: false; skipped: true; reason: "YT_AUTOPOST_PAUSED" | "YT_DAILY_UPLOAD_CAP_REACHED" }
  | { ok: false; skipped?: false; reason: string };

export interface YoutubeUploadInput {
  videoUrl: string; // R2 공개 MP4 URL(YoutubeShort.videoUrl)
  title: string;
  description: string;
  tags: string[];
  db?: DbClient;
}

/** 쇼츠 공개 URL(video id → shorts 링크). */
export function shortsUrl(ytVideoId: string): string {
  return `https://www.youtube.com/shorts/${ytVideoId}`;
}

/** 당일(KST) 업로드 완료 수 — 쿼터 카운터. status=PUBLISHED & publishedAt이 오늘 0시(KST) 이후. */
async function countPublishedToday(db: DbClient, now: Date): Promise<number> {
  return db.youtubeShort.count({
    where: { status: "PUBLISHED", publishedAt: { gte: startOfKstDayUtc(now) } },
  });
}

interface VideosInsertResponse {
  id?: string;
  error?: { message?: string; errors?: { reason?: string }[] };
}

/**
 * YouTube 쇼츠 1건 업로드 — 게이트 통과 시 videos.insert resumable 실행.
 * @returns ok=true(ytVideoId·url·privacyStatus) / skipped(정지·상한) / 실패(사유).
 */
export async function uploadYoutubeShort(input: YoutubeUploadInput): Promise<YoutubeUploadResult> {
  const db = input.db ?? prisma;
  const now = new Date();

  // ① 킬스위치.
  if (await isYoutubeAutopostPaused(db)) {
    return { ok: false, skipped: true, reason: "YT_AUTOPOST_PAUSED" };
  }

  // ② 토큰(미설정·갱신 실패=사유 반환). auth.ts(INTEG): { ok:true, accessToken } | { ok:false, reason }.
  const tokenRes = await getYoutubeAccessToken(db);
  if (!tokenRes.ok) return { ok: false, reason: tokenRes.reason };
  const accessToken = tokenRes.accessToken;

  // ③ 일 업로드 상한.
  const [cap, published] = await Promise.all([getYoutubeDailyUploadCap(db), countPublishedToday(db, now)]);
  if (published >= cap) {
    return { ok: false, skipped: true, reason: "YT_DAILY_UPLOAD_CAP_REACHED" };
  }

  const privacyStatus = await getYoutubePrivacyStatus(db);

  try {
    // ④ R2에서 영상 바이트 확보.
    const videoRes = await fetch(input.videoUrl, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!videoRes.ok) {
      return { ok: false, reason: `영상 다운로드 실패(${videoRes.status}): ${input.videoUrl}` };
    }
    const videoBuf = Buffer.from(await videoRes.arrayBuffer());

    // ⑤ resumable 세션 시작 — 메타(snippet+status) JSON.
    const metaBody = {
      snippet: {
        title: input.title,
        description: input.description,
        tags: input.tags,
        categoryId: CATEGORY_TRAVEL,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    };

    const startRes = await fetch(RESUMABLE_START, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(videoBuf.length),
      },
      body: JSON.stringify(metaBody),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!startRes.ok) {
      const errText = (await startRes.text().catch(() => "")).slice(0, 500);
      return { ok: false, reason: `업로드 세션 시작 실패(${startRes.status}): ${errText}` };
    }
    const uploadUrl = startRes.headers.get("location");
    if (!uploadUrl) {
      return { ok: false, reason: "업로드 세션 Location 헤더 없음" };
    }

    // ⑥ 영상 바이트 PUT.
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(videoBuf.length) },
      body: videoBuf,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    const putJson = (await putRes.json().catch(() => ({}))) as VideosInsertResponse;
    if (!putRes.ok || !putJson.id) {
      const reason =
        putJson.error?.message ??
        putJson.error?.errors?.[0]?.reason ??
        `업로드 실패(${putRes.status})`;
      return { ok: false, reason: String(reason).slice(0, 500) };
    }

    return { ok: true, ytVideoId: putJson.id, url: shortsUrl(putJson.id), privacyStatus };
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
}
