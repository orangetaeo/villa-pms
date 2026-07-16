// lib/instagram/serialize.ts — InstagramPost API 응답 직렬화 (admin 큐 공유)
//   mediaJson·flaggedTerms(Json)·DateTime을 클라 친화 형태로. 가격/원가 필드 자체가 모델에 없어 누수 불가.
import type { InstagramPost, Villa } from "@prisma/client";

export interface IgPostMediaItem {
  srcPhotoId: string | null;
  renderedUrl: string; // 이미지: 렌더 JPEG / 릴스: 포스터(첫 프레임) JPEG
  templateId: string; // 릴스는 "reel"
  overlayText: string | null;
  videoUrl?: string; // 릴스 전용 — MP4 공개 URL(이미지 포스트는 없음)
}

export interface SerializedIgPost {
  id: string;
  villaId: string | null;
  villaName: string | null;
  kind: string;
  status: string;
  scheduledAt: string;
  caption: string;
  media: IgPostMediaItem[];
  igMediaId: string | null;
  igPermalink: string | null;
  publishedAt: string | null;
  failReason: string | null;
  flaggedTerms: string[];
  // 인사이트 캐시 (Phase 2, additive) — 카드 뱃지·정렬용. 미수집이면 null(기존 소비처 무해).
  latestReach: number | null;
  insightsSyncedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type PostWithVilla = InstagramPost & { villa?: Pick<Villa, "name"> | null };

function toMedia(json: unknown): IgPostMediaItem[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const m = (raw ?? {}) as Record<string, unknown>;
    const item: IgPostMediaItem = {
      srcPhotoId: typeof m.srcPhotoId === "string" ? m.srcPhotoId : null,
      renderedUrl: typeof m.renderedUrl === "string" ? m.renderedUrl : "",
      templateId: typeof m.templateId === "string" ? m.templateId : "raw",
      overlayText: typeof m.overlayText === "string" ? m.overlayText : null,
    };
    if (typeof m.videoUrl === "string") item.videoUrl = m.videoUrl;
    return item;
  });
}

function toFlagged(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

export function serializeIgPost(post: PostWithVilla): SerializedIgPost {
  return {
    id: post.id,
    villaId: post.villaId,
    villaName: post.villa?.name ?? null,
    kind: post.kind,
    status: post.status,
    scheduledAt: post.scheduledAt.toISOString(),
    caption: post.caption,
    media: toMedia(post.mediaJson),
    igMediaId: post.igMediaId,
    igPermalink: post.igPermalink,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    failReason: post.failReason,
    flaggedTerms: toFlagged(post.flaggedTerms),
    latestReach: post.latestReach ?? null,
    insightsSyncedAt: post.insightsSyncedAt?.toISOString() ?? null,
    createdBy: post.createdBy,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
