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
import { ARTICLE_TOPICS, pickArticleImages, seedOf, type PickedImage } from "@/lib/seo/article-draft";
import type { PublicVilla } from "@/lib/seo/public-villa";
import { SERVICE_TOPICS } from "@/lib/seo/service-article";

/** 글 1편이 쓰는 자료 사진 최대 수(커버 1 + 본문 N-1). 이미지 도배는 그 자체로 저품질 신호다. */
export const MAX_MEDIA_PER_ARTICLE = 4;

export interface SeoMediaPick {
  id: string;
  url: string;
  alt: string;
  caption: string | null;
}

const PICK_SELECT = { id: true, url: true, alt: true, caption: true } as const;

/**
 * 사진에 붙일 수 있는 주제 = 가이드 글 주제 8종 + 부가서비스 글 주제 9종.
 * ★ 서비스 사진(마사지·BBQ·과일 …)은 카탈로그 상품 사진이 우선이지만, 분위기·현장 사진은
 *   상품에 붙일 자리가 없다 — 그 사진들이 여기로 들어온다.
 */
export const MEDIA_TOPIC_GROUPS: { label: "guide" | "service"; options: { key: string; title: string }[] }[] = [
  { label: "guide", options: ARTICLE_TOPICS.map((t) => ({ key: t.key, title: t.title })) },
  { label: "service", options: SERVICE_TOPICS.map((t) => ({ key: t.key, title: t.title })) },
];

/** 유효한 주제 키만 남긴다 — 오타·삭제된 주제 키가 들어오면 그 사진은 영원히 안 뽑힌다. */
export function normalizeTopicKeys(input: unknown): string[] {
  const valid = new Set(MEDIA_TOPIC_GROUPS.flatMap((g) => g.options.map((o) => o.key)));
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

  // ★ placeId가 있는 사진은 **특정 가게 사진**이라 여기서 제외한다(T-seo-place-article).
  //   그 사진은 그 장소를 소개하는 글에서만 의미가 있다 — 공항 이동 글에 끼면 무관한 이미지가 된다.
  const matched = await db.seoMedia.findMany({
    where: { active: true, placeId: null, topicKeys: { has: topicKey } },
    orderBy: order,
    take: max,
    select: PICK_SELECT,
  });
  if (matched.length >= max) return matched;

  // 범용 사진으로 나머지를 채운다. 주제 일치분과 겹치지 않게 id를 제외한다.
  const rest = await db.seoMedia.findMany({
    where: {
      active: true,
      placeId: null,
      topicKeys: { isEmpty: true },
      id: { notIn: matched.map((m) => m.id) },
    },
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

// ── 가이드 글 사진 = 자료 라이브러리 + 공개 빌라 사진 혼합 (T-seo-villa-photos-in-guide) ──
//
// 운영자 결정 2026-07-24: 가이드 글은 **등록된 공개 빌라 사진을 자동으로 끌어와 자료 사진과 혼합**한다.
//   그래야 운영자가 빌라 사진을 자료 라이브러리에 이중 등록하지 않는다. 라이브러리는 앞으로
//   비(非)빌라(풍경·장소·먹거리) 전용이 된다.
//
// ★ 워터마크: 빌라 사진(VillaPhoto.url)은 **업로드 시점에 이미 워터마크가 구워진** 파일이다
//   (lib/watermark.ts — supplier·admin 업로드 3경로 전부). 그래서 여기서 서버 재워터마크를 하지 않는다
//   (place 글처럼 파생본을 새로 굽는 파이프라인을 만들지 않는다 — 이중 워터마크·R2 낭비).
// ★ 누수 0: 빌라 사진은 pickArticleImages를 통해서만 들어오고, alt/caption은 publicLabel(지역·특징)뿐이다.
//   빌라 실명(name/nameVi)·정확 주소는 PublicVilla DTO에 애초에 없다(getPublicVillas 관문이 차단).
// ★ 결정성: Math.random 금지. 빌라 회전·혼합 선두는 글의 topicKey(seedOf)로만 정한다 — 같은 글은 항상 같은 결과.

export interface GuideImagePlan {
  /** 최종 커버·본문용 이미지. 빌라 사진은 업로드-워터마크 완료본, 자료 사진은 라이브러리 원본. */
  images: PickedImage[];
  /** 사용 처리(usedCount++)할 자료 사진 id — **최종 선택된 것만**. 안 뽑힌 라이브러리 사진은 소비하지 않는다. */
  usedMediaIds: string[];
}

/**
 * 자료 사진 행 + 빌라 사진을 결정적으로 혼합한다(순수 함수 — DB 없음, 테스트 가능).
 *   · 둘 다 있으면 **번갈아** 채워 최소 각 1장씩 섞이게 한다(한쪽 쏠림 방지). 선두 소스는 seed 홀짝으로 회전.
 *   · 한쪽이 비면 나머지로 채운다(사진은 전제조건이 아니다).
 *   · URL 중복은 제거하고 총합은 max로 제한한다.
 */
export function mergeGuideImages(
  libRows: SeoMediaPick[],
  villaPicks: PickedImage[],
  seedKey: string,
  max: number = MAX_MEDIA_PER_ARTICLE
): GuideImagePlan {
  if (max <= 0) return { images: [], usedMediaIds: [] };

  type Item = { img: PickedImage; id: string | null };
  const lib: Item[] = libRows.map((r) => ({
    img: { url: r.url, alt: r.alt, ...(r.caption ? { caption: r.caption } : {}) },
    id: r.id,
  }));
  const villa: Item[] = villaPicks.map((img) => ({ img, id: null }));

  const out: Item[] = [];
  const seen = new Set<string>();
  const push = (x: Item) => {
    if (out.length >= max || seen.has(x.img.url)) return;
    seen.add(x.img.url);
    out.push(x);
  };

  if (lib.length > 0 && villa.length > 0) {
    // 선두 소스를 글마다 회전 — 모든 가이드 글이 같은 순서(항상 빌라 먼저 등)로 시작하지 않게.
    const villaLeads = seedOf(seedKey) % 2 === 0;
    const a = villaLeads ? villa : lib;
    const b = villaLeads ? lib : villa;
    let i = 0;
    let j = 0;
    while (out.length < max && (i < a.length || j < b.length)) {
      if (i < a.length) push(a[i++]);
      if (out.length < max && j < b.length) push(b[j++]);
    }
  } else {
    // 한쪽만 존재 — 있는 쪽으로 채운다.
    for (const x of lib.length > 0 ? lib : villa) push(x);
  }

  return {
    images: out.map((x) => x.img),
    usedMediaIds: out.filter((x): x is Item & { id: string } => x.id !== null).map((x) => x.id),
  };
}

/**
 * 가이드 글 한 편의 사진 계획을 만든다 — 주제 자료 사진(주제+범용, placeId=null)과 공개 빌라 사진을 혼합.
 *   villas = getPublicVillas() 관문 통과분(호출부가 이미 조회해 넘긴다). 비어도 자료만으로 진행한다.
 *   반환 usedMediaIds는 markMediaUsed에 그대로 넘겨 소비 처리한다.
 */
export async function pickGuideImages(
  topicKey: string,
  villas: PublicVilla[],
  max: number = MAX_MEDIA_PER_ARTICLE,
  db: DbClient = prisma
): Promise<GuideImagePlan> {
  if (max <= 0) return { images: [], usedMediaIds: [] };
  const libRows = await pickMediaForTopic(topicKey, max, db);
  // 빌라 사진도 최대 max장 후보로 뽑는다(혼합에서 잘린다). seedKey=topicKey로 글마다 다른 빌라·공간이 나온다.
  const villaPicks = pickArticleImages(villas, max, topicKey);
  return mergeGuideImages(libRows, villaPicks, topicKey, max);
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
