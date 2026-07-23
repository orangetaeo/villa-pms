// lib/youtube/serialize.ts — YoutubeShort API 응답 직렬화 (admin 큐 공유)
//   tags·flaggedTerms(Json)·DateTime을 클라 친화 형태로. 원가·마진·시크릿 필드는 모델에 없어 누수 불가.
import type { YoutubeShort, Villa } from "@prisma/client";
import { shortsUrl } from "@/lib/youtube/upload";

export interface SerializedYtShort {
  id: string;
  villaId: string | null;
  villaName: string | null;
  /** 장소 소재(PLACE_AUTO)일 때 화면에 쓸 이름. 빌라 소재면 null. */
  sourceName: string | null;
  articleSlug: string | null;
  instagramPostId: string | null;
  sourceType: string;
  status: string;
  scheduledAt: string;
  title: string;
  description: string;
  tags: string[];
  videoUrl: string;
  posterUrl: string | null;
  durationSec: number | null;
  ytVideoId: string | null;
  ytPrivacyStatus: string | null;
  shortsUrl: string | null; // ytVideoId 있으면 공개 쇼츠 URL
  publishedAt: string | null;
  failReason: string | null;
  flaggedTerms: string[];
  // ── 직접 촬영 자동 편집 잡 (marketing-s2 §A) — 편집 잡 아니면 editJobStatus=null ──
  editJobStatus: string | null; // PENDING/PROCESSING/DONE/FAILED (렌더 축, status와 별개)
  editError: string | null; // 렌더 실패 사유(업로드 failReason과 별개 축)
  // ── 성과 캐시 (marketing-s2 §B) — 타 에이전트가 값을 채움(필드만 additive) ──
  latestViews: number | null;
  latestLikes: number | null;
  latestComments: number | null;
  statsSyncedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type ShortWithVilla = YoutubeShort & {
  villa?: Pick<Villa, "name"> | null;
  seoArticle?: { slug: string; title: string } | null;
};

function toStringArray(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

export function serializeYtShort(short: ShortWithVilla): SerializedYtShort {
  return {
    id: short.id,
    villaId: short.villaId,
    villaName: short.villa?.name ?? null,
    sourceName: short.seoArticle ? short.seoArticle.title.split(" — ")[0].trim() : null,
    articleSlug: short.seoArticle?.slug ?? null,
    instagramPostId: short.instagramPostId,
    sourceType: short.sourceType,
    status: short.status,
    scheduledAt: short.scheduledAt.toISOString(),
    title: short.title,
    description: short.description,
    tags: toStringArray(short.tags),
    videoUrl: short.videoUrl,
    posterUrl: short.posterUrl,
    durationSec: short.durationSec ?? null,
    ytVideoId: short.ytVideoId,
    ytPrivacyStatus: short.ytPrivacyStatus,
    shortsUrl: short.ytVideoId ? shortsUrl(short.ytVideoId) : null,
    publishedAt: short.publishedAt?.toISOString() ?? null,
    failReason: short.failReason,
    flaggedTerms: toStringArray(short.flaggedTerms),
    editJobStatus: short.editJobStatus ?? null,
    editError: short.editError ?? null,
    latestViews: short.latestViews ?? null,
    latestLikes: short.latestLikes ?? null,
    latestComments: short.latestComments ?? null,
    statsSyncedAt: short.statsSyncedAt?.toISOString() ?? null,
    createdBy: short.createdBy,
    createdAt: short.createdAt.toISOString(),
    updatedAt: short.updatedAt.toISOString(),
  };
}
