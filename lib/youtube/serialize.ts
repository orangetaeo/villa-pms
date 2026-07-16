// lib/youtube/serialize.ts — YoutubeShort API 응답 직렬화 (admin 큐 공유)
//   tags·flaggedTerms(Json)·DateTime을 클라 친화 형태로. 원가·마진·시크릿 필드는 모델에 없어 누수 불가.
import type { YoutubeShort, Villa } from "@prisma/client";
import { shortsUrl } from "@/lib/youtube/upload";

export interface SerializedYtShort {
  id: string;
  villaId: string | null;
  villaName: string | null;
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
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type ShortWithVilla = YoutubeShort & { villa?: Pick<Villa, "name"> | null };

function toStringArray(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

export function serializeYtShort(short: ShortWithVilla): SerializedYtShort {
  return {
    id: short.id,
    villaId: short.villaId,
    villaName: short.villa?.name ?? null,
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
    createdBy: short.createdBy,
    createdAt: short.createdAt.toISOString(),
    updatedAt: short.updatedAt.toISOString(),
  };
}
