// lib/seo/video-article-draft.ts — 개별 영상 글(category="video") 초안 생성 (ADR-0049)
//
// 원천은 이미 유튜브에 발행된 실촬영 쇼츠(YoutubeShort: PUBLISHED·ytVideoId·UPLOADED·villaId)다.
// 그 영상을 우리 도메인 블로그에 **개별 영상 글**로 등록해 체류·영상 SEO를 확보한다(쇼츠 1건 = 글 1건).
//
// ★★ 원칙 1(실명 비공개) 구조적 차단(DTO 봉인):
//    이 모듈의 입력 타입 VideoArticleVillaContext는 **PublicVilla에서 Pick**으로 만든다.
//    PublicVilla에는 name/nameVi가 애초에 없으므로, 여기에 그 키를 쓰면 **컴파일 에러**가 난다.
//    = 프롬프트·산출물에 빌라 고유 실명이 새어 들어가는 경로가 타입 레벨에서 봉인된다.
//    실명으로 검색하면 직접 예약 페이지·공급자를 찾아 직거래 우회가 가능하기 때문(PR #440 승계).
//
// ★ 본문 구조(ADR §5): [p 도입] → [video 임베드] → [h2] → [ul 볼거리] → [p CTA].
//   Gemini는 [p, h2, ul, p]만 만들고, video 블록은 시스템(composeVideoBody)이 도입 문단 뒤에 끼운다.
//   video 블록 title = 쇼츠 제목(PR #440에서 이미 실명 무결 산출물) 재사용.
//
// ★ 카피 규칙: [[copy-guide-must-inject-all-paths]] — 새 생성 경로이므로 copy-guide를 프롬프트 첫머리에
//   주입한다(**6번째 경로**). 금칙어 가드(findBannedTerms)는 기존 생성기들과 동일 패턴.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { findBannedTerms } from "@/lib/instagram/caption";
import { copyGuidePromptBlock } from "@/lib/instagram/content-guide";
import { parseArticleBody, type ArticleBlock } from "@/lib/seo/article";
import { extractJsonArray, buildSummary, type DraftResult, type PickedImage } from "@/lib/seo/article-draft";
import type { PublicVilla } from "@/lib/seo/public-villa";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;

/** PhotoSpace/VillaClip.space 코드 → 한국어 라벨. 볼거리 목록·프롬프트 힌트용. */
const SPACE_LABEL_KO: Record<string, string> = {
  EXTERIOR: "외관",
  POOL: "수영장",
  LIVING: "거실",
  BEDROOM: "침실",
  KITCHEN: "주방",
  BATHROOM: "욕실",
  BALCONY: "베란다",
  ETC: "내부",
};

/** 공간 코드 배열 → 한국어 라벨(중복 제거, 순서 보존). 알 수 없는 코드는 버린다. */
export function spaceLabelsKo(spaces: string[]): string[] {
  const out: string[] = [];
  for (const s of spaces) {
    const ko = SPACE_LABEL_KO[String(s).toUpperCase()];
    if (ko && !out.includes(ko)) out.push(ko);
  }
  return out;
}

// ── 입력 타입 (DTO 봉인) ──────────────────────────────────────────────────────
/**
 * 영상 글 생성에 쓰는 빌라 공개 컨텍스트.
 * ★ PublicVilla에서 Pick — name/nameVi를 구조적으로 배제한다(그 키를 추가하면 컴파일 에러).
 *   toPublicVilla(공개 관문)를 통과한 값만 들어오므로 가격·주소·공급자 정보도 이미 없다.
 */
export type VideoArticleVillaContext = Pick<
  PublicVilla,
  | "publicLabel"
  | "complex"
  | "areaName"
  | "areaNameKo"
  | "bedrooms"
  | "bathrooms"
  | "maxGuests"
  | "hasPool"
  | "breakfastAvailable"
  | "beachDistanceM"
  | "featureKeys"
  | "photos"
>;

/** 원천 쇼츠의 공개 필드 — 유튜브에 이미 공개된 메타만(추가 누수 표면 없음). */
export interface VideoArticleShort {
  /** 원천 YoutubeShort.id — topicKey(`video-<id>`)·감사 추적용. */
  shortId: string;
  /** 임베드용 유튜브 video id — 호출부가 non-null 보장(선정 조건 ytVideoId≠null). */
  ytVideoId: string;
  /** 쇼츠 제목 — video 블록 title로 재사용(PR #440에서 이미 실명 무결). */
  title: string;
  /** 썸네일(R2) — 커버·사이트맵 thumbnail_loc. 없으면 브랜드 폴백. */
  posterUrl: string | null;
  durationSec: number | null;
  publishedAt: Date | null;
  /** 컷 공간(VillaClip.space·쇼츠 컷 정보). 볼거리 목록 재료 — 비면 빌라 사진 공간으로 폴백. */
  clipSpaces: string[];
}

export interface VideoArticleInput {
  villa: VideoArticleVillaContext;
  short: VideoArticleShort;
}

// ── 키·제목 ──────────────────────────────────────────────────────────────────
/** 영상 글 topicKey — 원천 쇼츠 id로 고정(중복 생성 방지 + slug 안정, FK 없이 역참조). */
export function videoTopicKey(shortId: string): string {
  return `video-${shortId}`;
}

/** 제목 — 지역·특징 표시명(publicLabel)만. 고유 실명 미사용(원칙 1). */
export function buildVideoArticleTitle(v: VideoArticleVillaContext): string {
  return `${v.publicLabel} 영상으로 미리 보기`;
}

/** 이 영상 글의 "볼거리" 재료가 될 공간 라벨 — 컷 공간 우선, 없으면 빌라 사진 공간. */
export function videoSpaceHints(input: VideoArticleInput): string[] {
  const fromClips = spaceLabelsKo(input.short.clipSpaces);
  if (fromClips.length > 0) return fromClips;
  return spaceLabelsKo(input.villa.photos.map((p) => p.space));
}

// ── 프롬프트 ──────────────────────────────────────────────────────────────────
export function buildVideoArticlePrompt(input: VideoArticleInput): string {
  const { villa: v } = input;
  const where = v.areaNameKo ?? v.areaName ?? v.complex ?? "푸꾸옥";
  const facts: string[] = [`단지: ${where}`, `구성: 침실 ${v.bedrooms}개 · 최대 ${v.maxGuests}인`];
  if (v.hasPool) facts.push("전용 수영장 있음");
  if (v.breakfastAvailable) facts.push("조식 제공 가능");
  if (v.beachDistanceM != null) facts.push(`해변까지 약 ${v.beachDistanceM}m`);
  const spaces = videoSpaceHints(input);
  if (spaces.length) facts.push(`영상에 담긴 공간: ${spaces.join(", ")}`);

  return [
    // ★ 카피가이드 주입(6번째 경로) — 반드시 첫머리에.
    copyGuidePromptBlock(),
    "너는 베트남 푸꾸옥 현지에서 빌라를 운영하는 회사의 콘텐츠 에디터다.",
    "아래 빌라를 촬영한 짧은 영상(유튜브 쇼츠)을 소개하는 **영상 글**의 본문을 쓴다.",
    "영상 자체는 시스템이 페이지에 임베드하니, 너는 그 영상을 재생하고 싶게 만드는 짧은 소개 글만 쓴다.",
    "",
    // ★ 고유 실명 대신 지역·특징 표시명만 준다(원칙 1).
    `빌라: ${v.publicLabel}`,
    "확인된 사실:",
    ...facts.map((x) => `- ${x}`),
    "",
    "글의 구성(반드시 이 순서·개수):",
    "- 도입 문단(p) 1개: 이 영상이 무엇을 보여주는지 2~3문장. 영상을 켜 보고 싶게",
    "- 소제목(h2) 1개: '영상에서 볼 수 있는 곳' 같은 제목",
    "- 목록(ul) 1개: 영상 속 볼거리 3~5개. 위 '영상에 담긴 공간' 범위 안에서 공간별로",
    "- 마무리 문단(p) 1개: 카카오톡 채널 상담을 자연스럽게 권하는 마무리",
    "",
    "형식(반드시 지켜라):",
    "- JSON 배열만 출력한다. 코드펜스·설명 없이 배열 하나만",
    '- 각 원소는 {"type":"p","text":"..."} 또는 {"type":"h2","text":"..."} 또는 {"type":"ul","items":["..."]}',
    "- **이미지·영상 블록은 넣지 마라**(영상은 시스템이 알아서 배치한다)",
    "- 전체 텍스트 300~600자(한국어). 영상 페이지라 길 필요 없다 — 억지로 늘리지 마라",
    "",
    "내용 규칙(어기면 폐기된다):",
    "- 위에 없는 사실을 지어내지 마라. 영상에 없는 공간·시설을 추측하지 않는다",
    "- 가격·요금·금액 표현 금지('원', '동', '달러', '얼마', '무료')",
    "- 특정 날짜의 예약 가능 여부를 쓰지 마라",
    "- 상세 주소·소유자·관리인 정보를 쓰지 마라",
    "- 빌라 고유 실명·브랜드명을 지어내지 마라. 위 '빌라' 표시명까지만 쓴다",
    "- 최상급·과장('최고', '1위')·미확인 통계 금지",
    "",
    "마지막 문단에서 상담을 자연스럽게 권하되 호객성 문구는 쓰지 마라.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Gemini 호출 ───────────────────────────────────────────────────────────────
/**
 * 영상 글 본문 생성(도입·소제목·볼거리·CTA 텍스트). video 블록은 여기서 넣지 않는다(composeVideoBody 담당).
 * 실패 시 null(호출부가 이번 회차 건너뜀). 폴백 템플릿 없음 — 다른 생성기와 같은 원칙(못 만들면 안 만든다).
 */
export async function generateVideoArticleBody(
  input: VideoArticleInput,
  fetchFn: typeof fetch = fetch
): Promise<DraftResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildVideoArticlePrompt(input) }] }],
          generationConfig: { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = parseArticleBody(extractJsonArray(raw));
    if (blocks.length === 0) return null;

    const flat = blocks
      .map((b) =>
        b.type === "ul" ? b.items.join(" ") : b.type === "img" ? (b.caption ?? "") : b.type === "video" ? b.title : b.text
      )
      .join(" ");
    return { blocks, flaggedTerms: findBannedTerms(flat) };
  } catch {
    return null;
  }
}

// ── 본문 조립 ──────────────────────────────────────────────────────────────────
/**
 * 생성된 [p, h2, ul, p]에 video 블록을 **도입 문단(첫 p) 바로 뒤**에 끼운다(ADR §5 구조).
 * 도입 문단이 없으면 맨 앞에 영상을 둔다 — video 블록 ≥1(발행 자격)을 항상 보장한다.
 */
export function composeVideoBody(
  blocks: ArticleBlock[],
  video: { ytVideoId: string; title: string }
): ArticleBlock[] {
  const videoBlock: ArticleBlock = { type: "video", ytVideoId: video.ytVideoId, title: video.title };
  const out: ArticleBlock[] = [];
  let inserted = false;
  for (const b of blocks) {
    out.push(b);
    if (!inserted && b.type === "p") {
      out.push(videoBlock);
      inserted = true;
    }
  }
  if (!inserted) out.unshift(videoBlock);
  return out;
}

/** buildSummary 재노출 — 호출부가 이 모듈만 import해도 요약을 만들 수 있게(다른 생성기와 동일 함수). */
export { buildSummary };

// ── 원천 쇼츠 선정 (⑤ 브랜치용) ────────────────────────────────────────────────
/**
 * 영상 글 원천 후보 select — 공개 안전 필드만. villaId·editParamsJson은 조립 재료(컷 공간)로만 쓴다.
 * ★ 금액·원가 필드 없음(YoutubeShort에 애초에 없다). description·tags도 글에 쓰지 않으므로 빼둔다.
 */
export const VIDEO_SHORT_SELECT = {
  id: true,
  ytVideoId: true,
  title: true,
  posterUrl: true,
  durationSec: true,
  publishedAt: true,
  villaId: true,
  editParamsJson: true,
} satisfies Prisma.YoutubeShortSelect;

export type VideoShortRow = Prisma.YoutubeShortGetPayload<{ select: typeof VIDEO_SHORT_SELECT }>;

/** editParamsJson에서 컷 공간(VillaClip.space)을 방어적으로 추출한다. 형식이 다르면 빈 배열. */
export function extractClipSpaces(editParamsJson: Prisma.JsonValue | null | undefined): string[] {
  if (!editParamsJson || typeof editParamsJson !== "object") return [];
  const clips = (editParamsJson as Record<string, unknown>).clips;
  if (!Array.isArray(clips)) return [];
  const out: string[] = [];
  for (const c of clips) {
    if (c && typeof c === "object") {
      const space = (c as Record<string, unknown>).space;
      if (typeof space === "string" && space.trim()) out.push(space.trim());
    }
  }
  return out;
}

/**
 * ⑤ 브랜치 원천 후보 — 조건 충족 쇼츠 중 아직 글이 없는 것(오래된 publishedAt 순).
 *   status=PUBLISHED · ytVideoId≠null · sourceType=UPLOADED · villaId≠null (ADR §4).
 * ★ 멱등: `video-<id>`가 usedKeys(전 SeoArticle.topicKey 집합)에 있으면 건너뛴다.
 *   반려(REJECTED)분도 topicKey가 남아 존재로 침 → **반려 후 재생성 안 함이 기본**(ADR §4).
 *   재생성이 필요하면 운영자가 반려 글을 하드 삭제한다.
 */
export async function getVideoArticleCandidates(
  usedKeys: Set<string>,
  db: DbClient = prisma
): Promise<VideoShortRow[]> {
  const rows = await db.youtubeShort.findMany({
    where: {
      status: "PUBLISHED",
      ytVideoId: { not: null },
      sourceType: "UPLOADED",
      villaId: { not: null },
    },
    select: VIDEO_SHORT_SELECT,
    orderBy: { publishedAt: "asc" },
  });
  return rows.filter((r) => !usedKeys.has(videoTopicKey(r.id)));
}

/** VideoShortRow(+ 임베드 가능 확정) → 생성기 입력의 short 부분. */
export function toVideoArticleShort(row: VideoShortRow): VideoArticleShort | null {
  if (!row.ytVideoId) return null; // where로 이미 걸러지지만 타입 좁힘.
  return {
    shortId: row.id,
    ytVideoId: row.ytVideoId,
    title: row.title,
    posterUrl: row.posterUrl,
    durationSec: row.durationSec,
    publishedAt: row.publishedAt,
    clipSpaces: extractClipSpaces(row.editParamsJson),
  };
}

/** VideoArticleInput.villa로 좁히는 헬퍼 — PublicVilla에서 사용하는 공개 필드만 뽑는다(name/nameVi 없음). */
export function toVideoArticleVillaContext(v: PublicVilla): VideoArticleVillaContext {
  return {
    publicLabel: v.publicLabel,
    complex: v.complex,
    areaName: v.areaName,
    areaNameKo: v.areaNameKo,
    bedrooms: v.bedrooms,
    bathrooms: v.bathrooms,
    maxGuests: v.maxGuests,
    hasPool: v.hasPool,
    breakfastAvailable: v.breakfastAvailable,
    beachDistanceM: v.beachDistanceM,
    featureKeys: v.featureKeys,
    photos: v.photos,
  };
}

/** 커버 사진 — 쇼츠 포스터(R2) 우선, 없으면 호출부가 브랜드 폴백을 쓴다(coverPhotoUrl=posterUrl, ADR). */
export function videoCoverPhoto(short: VideoArticleShort): PickedImage | null {
  if (!short.posterUrl) return null;
  return { url: short.posterUrl, alt: "" };
}
