// lib/instagram/serialize.ts — InstagramPost API 응답 직렬화 (admin 큐 공유)
//   mediaJson·flaggedTerms(Json)·DateTime을 클라 친화 형태로. 가격/원가 필드 자체가 모델에 없어 누수 불가.
import type { InstagramPost, Villa } from "@prisma/client";

export interface IgPostMediaItem {
  srcPhotoId: string | null;
  renderedUrl: string;
  templateId: string;
  overlayText: string | null;
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
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type PostWithVilla = InstagramPost & { villa?: Pick<Villa, "name"> | null };

function toMedia(json: unknown): IgPostMediaItem[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const m = (raw ?? {}) as Record<string, unknown>;
    return {
      srcPhotoId: typeof m.srcPhotoId === "string" ? m.srcPhotoId : null,
      renderedUrl: typeof m.renderedUrl === "string" ? m.renderedUrl : "",
      templateId: typeof m.templateId === "string" ? m.templateId : "raw",
      overlayText: typeof m.overlayText === "string" ? m.overlayText : null,
    };
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
    createdBy: post.createdBy,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
