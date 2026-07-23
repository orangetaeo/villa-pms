// lib/instagram/place-draft.ts — 장소 글(맛집·카페)을 인스타 소재로 재사용 (T-seo-to-instagram)
//
// 왜: IG 자동 초안이 **빌라당 상한**에 걸려 적격 빌라 0곳 상태다(빌라 2곳 모두 발행분 보유).
// 그런데 장소 글에는 운영자가 직접 찍은 사진이 10장 넘게 붙어 있다 — 이미 있는 재료를 안 쓰고 있었다.
//
// ★ 빌라 초안 경로는 건드리지 않는다. 장소는 **빌라가 못 채운 슬롯만** 채운다.
// ★ 한 글당 포스트 1개(seoArticleId로 판정) — 같은 가게 도배 방지(빌라당 상한과 같은 취지).
// ★ 캡션 사실 범위 = 장소 글과 동일: 인상·메모·사진 설명·동네까지. **가격·영업시간·전화·주소 금지**
//   (바뀌는 정보라 쓰는 순간 틀린 글이 되고, 우리는 갱신 수단이 없다).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import type { SlideInput } from "@/lib/instagram/render";
import { composeHashtags, findBannedTerms } from "@/lib/instagram/caption";
import { placeCategory, orderSinglePlacePhotos } from "@/lib/seo/place-article";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 45_000;

/** 사진이 이보다 적으면 캐러셀이 빈약하다 — 커버 + 사진 2~3장 + CTA는 되어야 한다. */
export const MIN_PLACE_PHOTOS_FOR_IG = 4;
/** 캐러셀 사진 상한(커버 포함). 인스타 캐러셀은 10장이 상한이고, CTA 1장을 남겨둔다. */
export const MAX_PLACE_SLIDE_PHOTOS = 7;

export interface PlacePhoto {
  id: string;
  url: string;
  alt: string;
  kind: string | null;
}

export interface PlaceIgSource {
  articleId: string;
  articleSlug: string;
  placeName: string;
  category: string;
  area: string | null;
  oneLiner: string;
  tips: string | null;
  photos: PlacePhoto[];
}

const PLACE_WITH_PHOTOS = {
  id: true,
  name: true,
  category: true,
  area: true,
  oneLiner: true,
  tips: true,
  usedInArticleId: true,
  photos: {
    where: { active: true },
    select: { id: true, url: true, alt: true, kind: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.SeoPlaceSelect;

/**
 * 인스타 소재가 될 장소 글을 고른다.
 *   조건: **발행된** 장소 글 + 아직 이 글로 만든 포스트 없음 + 사진 4장 이상.
 * ★ 발행분만 쓰는 이유: 사람이 승인·발행까지 통과시킨 글이라야 문장·사실이 검증된 것이다.
 */
export async function selectPlaceArticlesForIg(
  limit: number,
  db: DbClient = prisma
): Promise<PlaceIgSource[]> {
  if (limit <= 0) return [];

  const articles = await db.seoArticle.findMany({
    where: {
      topicKey: { startsWith: "place-" },
      status: "PUBLISHED",
      igPosts: { none: {} }, // 이미 만든 포스트가 있으면 제외
    },
    orderBy: { publishedAt: "desc" },
    take: limit * 3, // 사진 미달로 걸러질 수 있어 여유 있게
    select: { id: true, slug: true },
  });
  if (articles.length === 0) return [];

  const places = await db.seoPlace.findMany({
    where: { usedInArticleId: { in: articles.map((a) => a.id) }, active: true },
    select: PLACE_WITH_PHOTOS,
  });

  const out: PlaceIgSource[] = [];
  for (const a of articles) {
    if (out.length >= limit) break;
    // 묶음 글이면 여러 곳이 묶여 있다 — 사진이 가장 많은 곳을 대표로 쓴다(캐러셀 1편 = 가게 1곳).
    const candidates = places.filter((p) => p.usedInArticleId === a.id);
    const place = candidates.sort((x, y) => y.photos.length - x.photos.length)[0];
    if (!place || place.photos.length < MIN_PLACE_PHOTOS_FOR_IG) continue;

    out.push({
      articleId: a.id,
      articleSlug: a.slug,
      placeName: place.name,
      category: place.category,
      area: place.area,
      oneLiner: place.oneLiner,
      tips: place.tips,
      photos: orderSinglePlacePhotos(place.photos, MAX_PLACE_SLIDE_PHOTOS),
    });
  }
  return out;
}

/** 커버 헤드라인 — 가게 이름이 먼저 읽혀야 한다(검색어이자 저장 이유). */
export function buildPlaceHeadline(src: PlaceIgSource): string {
  const label = placeCategory(src.category)?.label ?? "가볼 만한 곳";
  const where = src.area ? `푸꾸옥 ${src.area}` : "푸꾸옥";
  return `${src.placeName}\n${where} ${label}`;
}

const CTA = {
  headline: "빌라 예약 · 여행 상담은\n프로필 링크 →\n카카오톡 상담",
};

/**
 * 장소 캐러셀 슬라이드 — 커버 + 사진들 + CTA.
 * ★ 빌라 전용 `info` 슬라이드(침실 수·해변 거리)는 쓰지 않는다 — 가게에는 해당 사실이 없다.
 */
export function buildPlaceSlides(src: PlaceIgSource): SlideInput[] {
  const photos = src.photos.slice(0, MAX_PLACE_SLIDE_PHOTOS);
  const slides: SlideInput[] = [];
  slides.push({
    templateId: "cover",
    srcPhotoId: photos[0].id,
    srcPhotoUrl: photos[0].url,
    data: { headline: buildPlaceHeadline(src) },
  });
  for (let i = 1; i < photos.length; i++) {
    slides.push({
      templateId: "raw",
      srcPhotoId: photos[i].id,
      srcPhotoUrl: photos[i].url,
      // 릴스로 확장할 때 쓰일 사진별 캡션 — 사람이 붙인 설명 그대로(짓지 않는다)
      reelCaption: photos[i].alt || null,
    });
  }
  slides.push({ templateId: "cta", data: CTA });
  return slides;
}

export function buildPlaceCaptionPrompt(src: PlaceIgSource): string {
  const photoNames = src.photos.map((p) => p.alt).filter(Boolean).slice(0, 8);
  return [
    "너는 푸꾸옥에서 빌라를 운영하는 사람의 인스타그램 계정을 대신 쓰는 에디터다.",
    "운영자가 직접 다녀온 가게를 소개하는 **인스타 캡션 본문**을 쓴다. 해시태그는 쓰지 마라(시스템이 붙인다).",
    "",
    `가게: ${src.placeName}${src.area ? ` (${src.area})` : ""}`,
    `직접 가본 인상: ${src.oneLiner}`,
    src.tips ? `메모: ${src.tips}` : "",
    photoNames.length > 0 ? `사진으로 확인되는 것: ${photoNames.join(", ")}` : "",
    "",
    "규칙(어기면 폐기된다):",
    "- 위에 있는 사실만 쓴다. 메뉴·분위기·좌석·역사·인기 여부를 지어내지 마라",
    "- **가격·영업시간·휴무일·전화번호·정확한 주소를 쓰지 마라**(바뀌는 정보라 쓰는 순간 틀린 글이 된다)",
    "- 인사말·자기소개로 시작하지 마라. 첫 줄부터 바로 본론",
    "- 최상급·과장은 운영자가 쓴 인상에 있을 때만 인용하고 새로 만들지 마라",
    "- 3~5문장, 250자 이내. 줄바꿈으로 읽기 쉽게",
    "- 마지막 한 줄은 빌라 숙박과 자연스럽게 엮는 문장(호객성 문구 금지)",
    "",
    "본문만 출력한다. 따옴표·머리말 없이.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface PlaceCaption {
  caption: string;
  flaggedTerms: string[];
  usedGemini: boolean;
}

/** 폴백 캡션 — Gemini 실패 시에도 사람이 쓴 문장(인상)이 있으므로 그것만으로 성립한다. */
export function fallbackPlaceCaption(src: PlaceIgSource): string {
  const label = placeCategory(src.category)?.label ?? "가볼 만한 곳";
  const where = src.area ? `푸꾸옥 ${src.area}` : "푸꾸옥";
  return [`${where} ${label} — ${src.placeName}`, "", src.oneLiner, src.tips ?? ""]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function generatePlaceCaption(
  src: PlaceIgSource,
  fetchFn: typeof fetch = fetch
): Promise<PlaceCaption> {
  let body: string | null = null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const res = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPlaceCaptionPrompt(src) }] }],
            generationConfig: { temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
        if (raw.length >= 30) body = raw.slice(0, 900);
      }
    } catch {
      body = null;
    }
  }
  const usedGemini = body != null;
  const text = body ?? fallbackPlaceCaption(src);

  // 해시태그는 기존 풀 재사용 — 장소 글은 여행 정보 성격이라 INFO 계열로 붙인다.
  const hashtags = composeHashtags("INFO", []);
  const tail = `\n\n${hashtags.join(" ")}\n📍 Phú Quốc`;
  const maxBody = 2200 - tail.length;
  const safe = text.length > maxBody ? `${text.slice(0, Math.max(0, maxBody - 1)).trimEnd()}…` : text;
  const caption = `${safe}${tail}`;

  return { caption, flaggedTerms: findBannedTerms(caption), usedGemini };
}
