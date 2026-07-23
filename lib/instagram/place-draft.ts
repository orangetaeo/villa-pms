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
import { loadCopyGuideRaw, copyGuidePromptBlock } from "@/lib/instagram/content-guide";
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
  /** 워터마크 파생본 — 인스타·쇼츠에 나가는 이미지도 워터마크가 박힌 쪽을 쓴다 */
  watermarkedUrl?: string | null;
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
    select: { id: true, url: true, alt: true, kind: true, watermarkedUrl: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.SeoPlaceSelect;

/**
 * 인스타 소재가 될 장소 글을 고른다.
 *   조건: **발행된** 장소 글 + 아직 이 글로 만든 포스트 없음 + 사진 4장 이상.
 * ★ 발행분만 쓰는 이유: 사람이 승인·발행까지 통과시킨 글이라야 문장·사실이 검증된 것이다.
 */
export interface PlaceSourceFilter {
  /** 유튜브 쇼츠가 이미 있는 글을 제외한다(쇼츠 배치용) */
  excludeShorts?: boolean;
  /** 인스타 포스트 유무를 무시한다 — 플랫폼별로 1개씩 만들기 위함(쇼츠 배치용) */
  ignoreIgPosts?: boolean;
}

export async function selectPlaceArticlesForIg(
  limit: number,
  db: DbClient = prisma,
  filter: PlaceSourceFilter = {}
): Promise<PlaceIgSource[]> {
  if (limit <= 0) return [];

  const articles = await db.seoArticle.findMany({
    where: {
      topicKey: { startsWith: "place-" },
      status: "PUBLISHED",
      // 플랫폼별로 1개씩 — 인스타에 이미 나갔어도 쇼츠는 따로 만든다(같은 소재, 다른 형식).
      ...(filter.ignoreIgPosts ? {} : { igPosts: { none: {} } }),
      ...(filter.excludeShorts ? { ytShorts: { none: {} } } : {}),
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

/**
 * 릴스·쇼츠 화면 자막 — ★역할별 고정 문구를 쓰면 음식 컷 3장이 **전부 같은 문장**이 된다
 * (실측 2026-07-23: "○○, 이걸 먹으러 갑니다" 3연속 → 테오 지적). 컷마다 달라야 한다.
 *
 * 규칙의 정본은 **카피가이드 §5-6**(docs/marketing/copy-guide.md)이다 — 코드가 규칙을 새로 만들지 않는다.
 * 여기서는 ① Gemini에 카피가이드를 주입해 컷별 자막을 받고 ② 실패하면 **회전 폴백**으로 반복만은 막는다.
 */
const FALLBACK_CAPTIONS: Record<string, string[]> = {
  exterior: ["여기가 그 집", "간판 보고 들어가면 됨", "골목에서 바로 보임"],
  interior: ["안은 이런 느낌", "자리는 이 정도", "주방이 열려 있음"],
  menu: ["메뉴는 이 중에서", "사진 보고 고르면 됨", "종류는 넉넉"],
  food: ["이건 꼭", "한 접시 더", "이 맛에 옵니다"],
  etc: ["기록해 둡니다", "이런 것도 있음", "다음에 또"],
};

/** 폴백 자막 — 같은 역할이 여러 번 나와도 **문장이 겹치지 않게** 회전시킨다. */
export function fallbackReelCaption(photo: PlacePhoto, seenOfKind: number): string {
  const kind = photo.kind && FALLBACK_CAPTIONS[photo.kind] ? photo.kind : "etc";
  const bank = FALLBACK_CAPTIONS[kind];
  const alt = photo.alt.trim();
  // 음식 컷은 사람이 붙인 이름이 곧 정보다 — 이름 + 짧은 각도로 조합(이름이 다르면 문장도 달라진다).
  if (kind === "food" && alt) return `${alt} ${bank[seenOfKind % bank.length]}`.slice(0, 16);
  return bank[seenOfKind % bank.length];
}

export function buildFallbackCaptions(photos: PlacePhoto[]): string[] {
  const counts = new Map<string, number>();
  return photos.map((p) => {
    const k = p.kind ?? "etc";
    const n = counts.get(k) ?? 0;
    counts.set(k, n + 1);
    return fallbackReelCaption(p, n);
  });
}

export function buildReelCaptionPrompt(src: PlaceIgSource, guide: string | null): string {
  const cuts = src.photos.map((p, i) => `${i + 1}) ${p.alt || "(설명 없음)"} — 역할: ${p.kind ?? "미지정"}`);
  return [
    "너는 푸꾸옥 빌라 운영사의 인스타 릴스·유튜브 쇼츠 화면 자막을 쓰는 카피라이터다.",
    "",
    guide ? "[카피가이드 — 이 규칙을 따른다]" + String.fromCharCode(10) + guide.slice(0, 6000) : "",
    "",
    `가게: ${src.placeName}${src.area ? ` (${src.area})` : ""}`,
    `직접 가본 인상: ${src.oneLiner}`,
    src.tips ? `메모: ${src.tips}` : "",
    "",
    "컷 목록(순서대로):",
    ...cuts,
    "",
    "요구:",
    "- 컷 수만큼 자막을 쓴다. **각 12자 이내**, 마침표 없음",
    "- ★ 컷마다 문장이 달라야 한다. 같은 문형을 반복하지 마라",
    "- 위 인상·컷 설명 밖의 사실(맛·재료·조리법·인기)을 만들지 마라",
    "- 가격·영업시간·전화번호 금지",
    "",
    `출력: 줄바꿈으로 구분한 자막 ${src.photos.length}줄만. 번호·따옴표·설명 없이.`,
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10));
}

/** 컷별 자막 생성 — 실패하면 회전 폴백(반복 없음)으로 떨어진다. */
export async function generateReelCaptions(
  src: PlaceIgSource,
  fetchFn: typeof fetch = fetch
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  const fallback = buildFallbackCaptions(src.photos);
  if (!apiKey) return fallback;
  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildReelCaptionPrompt(src, loadCopyGuideRaw()) }] }],
          generationConfig: { temperature: 0.95, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const lines = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
      .split(String.fromCharCode(10))
      .map((l) => l.replace(/^[0-9]+[).\s]*/, "").replace(/^["'\s]+|["'\s]+$/g, "").trim())
      .filter((l) => l.length > 0 && l.length <= 20);

    // 모자라면 폴백으로 채우고, 중복 줄은 폴백으로 대체한다(반복 방지가 이 함수의 존재 이유다).
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < src.photos.length; i++) {
      const cand = lines[i];
      if (cand && !seen.has(cand)) {
        out.push(cand);
        seen.add(cand);
      } else {
        out.push(fallback[i]);
        seen.add(fallback[i]);
      }
    }
    return out;
  } catch {
    return fallback;
  }
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
export function buildPlaceSlides(src: PlaceIgSource, captions?: string[]): SlideInput[] {
  // ★ 워터마크 파생본이 있으면 그쪽을 쓴다 — 인스타·쇼츠로 나가는 이미지도 도용 방지 대상이다.
  const photos = src.photos
    .slice(0, MAX_PLACE_SLIDE_PHOTOS)
    .map((p) => ({ ...p, url: p.watermarkedUrl ?? p.url }));
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
      // 자막은 카피가이드 기반 생성값 → 없으면 회전 폴백(반복 방지). 캐러셀은 이 값을 무시한다.
      reelCaption: captions?.[i] ?? fallbackReelCaption(photos[i], i),
    });
  }
  slides.push({ templateId: "cta", data: CTA });
  return slides;
}

export function buildPlaceCaptionPrompt(src: PlaceIgSource): string {
  const photoNames = src.photos.map((p) => p.alt).filter(Boolean).slice(0, 8);
  return [
    copyGuidePromptBlock(),
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
