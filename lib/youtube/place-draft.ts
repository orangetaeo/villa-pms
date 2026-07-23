// lib/youtube/place-draft.ts — 장소 글(맛집·카페)을 유튜브 쇼츠 소재로 (T-seo-to-instagram S2)
//
// 인스타 캐러셀과 **같은 소재·같은 슬라이드**를 쓰고, 릴스 빌더(renderAndBuildReel)로 9:16 MP4를 만든다.
// 빌라 쇼츠 경로(runYoutubeDraftBatch)는 건드리지 않는다 — 장소는 빌라가 못 채운 몫만 만든다.
//
// ★ 제목·설명도 장소 글과 같은 사실 범위: 인상·메모·사진 설명·동네까지.
//   **가격·영업시간·전화·주소 금지** — 영상은 수정이 더 어렵다(업로드 후 교체 불가).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { writeAuditLog } from "@/lib/audit-log";
import { renderAndBuildReel, YOUTUBE_REEL_CTA } from "@/lib/instagram/reels";
import { findBannedTerms } from "@/lib/instagram/caption";
import { copyGuidePromptBlock } from "@/lib/instagram/content-guide";
import { YT_TITLE_MAX, YT_KAKAO_LINE } from "@/lib/youtube/meta";
import {
  buildPlaceSlides,
  selectPlaceArticlesForIg,
  generateReelCaptions,
  type PlaceIgSource,
} from "@/lib/instagram/place-draft";
import { placeCategory } from "@/lib/seo/place-article";

const CREATED_BY = "cron:instagram-draft";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 45_000;

export interface PlaceShortMeta {
  title: string;
  description: string;
  tags: string[];
  flaggedTerms: string[];
  usedGemini: boolean;
}

export function buildPlaceShortTitle(src: PlaceIgSource): string {
  const label = placeCategory(src.category)?.label ?? "가볼 만한 곳";
  const where = src.area ? `푸꾸옥 ${src.area}` : "푸꾸옥";
  const t = `${src.placeName} | ${where} ${label} #shorts`;
  return t.length > YT_TITLE_MAX ? `${t.slice(0, YT_TITLE_MAX - 1)}…` : t;
}

function placeTags(src: PlaceIgSource): string[] {
  const label = placeCategory(src.category)?.label ?? "여행";
  return ["푸꾸옥", "푸꾸옥여행", `푸꾸옥${label}`, src.placeName, "베트남여행", "푸꾸옥빌라"].filter(
    (t) => t.length > 0
  );
}

/** 설명 폴백 — 사람이 쓴 인상만으로 성립한다(Gemini 실패해도 빈 설명이 나가지 않게). */
export function fallbackPlaceShortDescription(src: PlaceIgSource): string {
  const label = placeCategory(src.category)?.label ?? "가볼 만한 곳";
  const where = src.area ? `푸꾸옥 ${src.area}` : "푸꾸옥";
  return [`${where} ${label} — ${src.placeName}`, "", src.oneLiner, src.tips ?? ""].filter(Boolean).join("\n");
}

export function buildPlaceShortPrompt(src: PlaceIgSource): string {
  const photoNames = src.photos.map((p) => p.alt).filter(Boolean).slice(0, 8);
  return [
    copyGuidePromptBlock(),
    "너는 푸꾸옥에서 빌라를 운영하는 사람의 유튜브 채널을 대신 쓰는 에디터다.",
    "직접 다녀온 가게를 소개하는 **쇼츠 설명문**을 쓴다. 해시태그는 쓰지 마라(시스템이 붙인다).",
    "",
    `가게: ${src.placeName}${src.area ? ` (${src.area})` : ""}`,
    `직접 가본 인상: ${src.oneLiner}`,
    src.tips ? `메모: ${src.tips}` : "",
    photoNames.length > 0 ? `영상에 나오는 것: ${photoNames.join(", ")}` : "",
    "",
    "규칙(어기면 폐기된다):",
    "- 위에 있는 사실만 쓴다. 메뉴·분위기·좌석·역사·인기 여부를 지어내지 마라",
    "- **가격·영업시간·휴무일·전화번호·정확한 주소 금지**(영상은 올린 뒤 고치기 어렵다)",
    "- 2~3문장, 200자 이내. 인사말 없이 바로 본론",
    "- 마지막 한 줄은 빌라 숙박과 자연스럽게 엮는 문장(호객성 문구 금지)",
    "",
    "설명문만 출력한다.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generatePlaceShortMeta(
  src: PlaceIgSource,
  fetchFn: typeof fetch = fetch
): Promise<PlaceShortMeta> {
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
            contents: [{ parts: [{ text: buildPlaceShortPrompt(src) }] }],
            generationConfig: { temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
        if (raw.length >= 20) body = raw.slice(0, 600);
      }
    } catch {
      body = null;
    }
  }
  const usedGemini = body != null;
  const title = buildPlaceShortTitle(src);
  const tags = placeTags(src);
  const description = [body ?? fallbackPlaceShortDescription(src), "", YT_KAKAO_LINE, "", tags.map((t) => `#${t}`).join(" ")]
    .join("\n")
    .slice(0, 4900);

  return { title, description, tags, flaggedTerms: findBannedTerms(`${title}\n${description}`), usedGemini };
}

export interface PlaceShortsBatchResult {
  created: { id: string; slug: string; flagged: string[] }[];
  failures: { slug: string; reason: string }[];
}

/**
 * 장소 쇼츠 배치 — 빌라 배치가 못 채운 몫만 만든다.
 * ★ 각 건 실패는 격리한다(다른 소재·인스타 흐름 무영향) — 렌더는 실패 가능성이 있는 작업이다.
 */
export async function runPlaceShortsBatch(
  count: number,
  slots: Date[],
  db: DbClient = prisma
): Promise<PlaceShortsBatchResult> {
  const created: PlaceShortsBatchResult["created"] = [];
  const failures: PlaceShortsBatchResult["failures"] = [];
  if (count <= 0) return { created, failures };

  // 쇼츠가 아직 없는 글만 — 인스타 포스트가 이미 있어도 쇼츠는 별도로 만든다(플랫폼별 1개씩).
  const sources = await selectPlaceArticlesForIg(count, db, { excludeShorts: true, ignoreIgPosts: true });

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const scheduledAt = slots[i % slots.length];
    try {
      const meta = await generatePlaceShortMeta(src);
      // ★ 화면 자막은 카피가이드 기반으로 컷마다 새로 쓴다(고정 문구 반복 금지 — 테오 지적 2026-07-23)
      const captions = await generateReelCaptions(src);
      const slides = buildPlaceSlides(src, captions);
      const reel = await renderAndBuildReel(slides, `yt-place-${src.articleSlug}-${scheduledAt.toISOString().slice(0, 10)}`, {
        audio: "bundled",
        ctaOverride: YOUTUBE_REEL_CTA,
      });

      const short = await db.youtubeShort.create({
        data: {
          villaId: null,
          seoArticleId: src.articleId,
          sourceType: "PLACE_AUTO",
          status: "PENDING_APPROVAL",
          scheduledAt,
          title: meta.title,
          description: meta.description,
          tags: meta.tags as unknown as Prisma.InputJsonValue,
          videoUrl: reel.videoUrl,
          posterUrl: reel.posterUrl,
          durationSec: Math.round(reel.durationSec),
          flaggedTerms: meta.flaggedTerms.length > 0 ? meta.flaggedTerms : undefined,
          createdBy: CREATED_BY,
        },
        select: { id: true },
      });

      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "YoutubeShort",
        entityId: short.id,
        changes: {
          source: { new: "seo-place" },
          seoArticleId: { new: src.articleId },
          place: { new: src.placeName },
          durationSec: { new: Math.round(reel.durationSec) },
          usedGemini: { new: meta.usedGemini },
          flaggedTerms: { new: meta.flaggedTerms },
        },
      });
      created.push({ id: short.id, slug: src.articleSlug, flagged: meta.flaggedTerms });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[yt/place-draft] 장소 쇼츠 ${src.articleSlug} 실패:`, reason);
      failures.push({ slug: src.articleSlug, reason });
    }
  }
  return { created, failures };
}
