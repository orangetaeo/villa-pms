// lib/seo/media.ts — 가이드 글 자료 사진 라이브러리 (T-seo-media-library)
//
// 왜 필요한가: 가이드 글(공항 이동·시즌·아이 동반 …)에 **빌라 사진을 끼우면 본문과 무관한 이미지**가 된다
// (테오 지적 2026-07-22 → seo-draft가 가이드 글에서 본문 이미지를 아예 뺐다). 그래서 사진이 없는 글이 됐다.
// 해법은 "주제에 맞는 사진"을 운영자가 미리 올려두고(저작권 = 자사 촬영본), 초안 cron이 주제 태그로 고르는 것.
//
// ★ 이 모듈은 **선택·기록만** 한다. 업로드는 /api/uploads(기존 경로), 배치는 interleaveImages(기존 함수).
// ★ 라이브러리가 비어 있어도 글 생성은 그대로 진행된다 — 사진은 선택 재료지 전제조건이 아니다.
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { isAllowedImageUrl } from "@/lib/seo/article";
import { ARTICLE_TOPICS, type PickedImage } from "@/lib/seo/article-draft";

/** 글 1편이 쓰는 자료 사진 최대 수(커버 1 + 본문 N-1). 이미지 도배는 그 자체로 저품질 신호다. */
export const MAX_MEDIA_PER_ARTICLE = 4;

export interface SeoMediaPick {
  id: string;
  url: string;
  alt: string;
  caption: string | null;
}

const PICK_SELECT = { id: true, url: true, alt: true, caption: true } as const;

/** 유효한 주제 키만 남긴다 — 오타·삭제된 주제 키가 들어오면 그 사진은 영원히 안 뽑힌다. */
export function normalizeTopicKeys(input: unknown): string[] {
  const valid = new Set(ARTICLE_TOPICS.map((t) => t.key));
  const raw = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const k = v.trim();
    if (valid.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** 저장 전 검증 — alt 없는 이미지는 파서가 블록째 버리므로 애초에 들이지 않는다. */
export function validateMediaInput(input: { url: string; alt: string }): { ok: true } | { ok: false; error: string } {
  const url = input.url?.trim() ?? "";
  const alt = input.alt?.trim() ?? "";
  if (!url) return { ok: false, error: "URL_REQUIRED" };
  if (!isAllowedImageUrl(url)) return { ok: false, error: "URL_NOT_ALLOWED" };
  if (alt.length < 2) return { ok: false, error: "ALT_REQUIRED" };
  return { ok: true };
}

/**
 * 주제에 맞는 자료 사진을 고른다.
 *   ① 주제 태그가 일치하는 사진 우선 → ② 모자라면 범용(topicKeys 빈 배열)에서 채운다
 *   각 그룹 안에서는 **덜 쓴 사진 우선**(usedCount asc) — 같은 사진이 모든 글에 반복되면 저품질 신호다.
 * 라이브러리가 비면 빈 배열(호출부는 사진 없이 진행).
 */
export async function pickMediaForTopic(
  topicKey: string,
  max: number = MAX_MEDIA_PER_ARTICLE,
  db: DbClient = prisma
): Promise<SeoMediaPick[]> {
  if (max <= 0) return [];
  const order = [{ usedCount: "asc" as const }, { createdAt: "asc" as const }];

  const matched = await db.seoMedia.findMany({
    where: { active: true, topicKeys: { has: topicKey } },
    orderBy: order,
    take: max,
    select: PICK_SELECT,
  });
  if (matched.length >= max) return matched;

  // 범용 사진으로 나머지를 채운다. 주제 일치분과 겹치지 않게 id를 제외한다.
  const rest = await db.seoMedia.findMany({
    where: { active: true, topicKeys: { isEmpty: true }, id: { notIn: matched.map((m) => m.id) } },
    orderBy: order,
    take: max - matched.length,
    select: PICK_SELECT,
  });
  return [...matched, ...rest];
}

/** 본문 삽입용 형태로 변환 — caption이 없으면 키 자체를 넣지 않는다(파서 계약과 동일). */
export function toPickedImages(rows: SeoMediaPick[]): PickedImage[] {
  return rows.map((r) => ({ url: r.url, alt: r.alt, ...(r.caption ? { caption: r.caption } : {}) }));
}

/**
 * 사용 기록 — 다음 글이 다른 사진을 고르게 만드는 유일한 장치다.
 * ★ 실패해도 throw하지 않는다: 글은 이미 저장됐고, 기록 실패로 파이프라인을 멈추면 손해가 더 크다.
 */
export async function markMediaUsed(ids: string[], db: DbClient = prisma): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db.seoMedia.updateMany({
      where: { id: { in: ids } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  } catch {
    // 무시 — 최악의 경우 같은 사진이 한 번 더 뽑힐 뿐이다.
  }
}
