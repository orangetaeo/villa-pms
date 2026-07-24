// lib/seo/article.ts — 공개 SEO 가이드 글 도메인 로직 (T-seo-s3)
//
// 책임 3가지:
//   1) 본문 블록 JSON의 **엄격한 파싱**(Gemini 산출물 = 미신뢰 입력)
//   2) 공개 조회 — PUBLISHED만 밖으로 나간다
//   3) **점진 발행(drip)** — 하루 상한을 넘겨 발행하지 않는다
//
// ★ 점진 발행이 왜 규칙인가 (기획 §0 치명2):
//   구글은 2024-03 scaled content abuse를 명문 위반으로 정했고 네이버도 유사 필터를 운영한다.
//   (애초에 네이버가 블로그 글쓰기 API를 닫은 사유가 "API 대량 발행"이다)
//   신뢰도 0인 신규 도메인이 하루에 수십 건을 쏟아내면 그 자체가 스팸 시그널이다.
//   → 승인 게이트(사람) + 일 상한(코드) 두 겹으로 막는다.
//
// ★ 공개 경계(T-seo-s1 §4.1) 승계: 본문에 가격·공실·주소·공급자 정보를 넣지 않는다.
//   빌라 언급은 lib/seo/public-villa.ts 관문을 경유한 정보만 사용한다.
import { Prisma, SeoArticleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { isSeoArticleCategory, type SeoArticleCategory } from "@/lib/seo/categories";

// ── 본문 블록 ────────────────────────────────────────────────────────────────
export type ArticleBlock =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  /** 본문 이미지 — alt는 필수(접근성 + 이미지 검색 유입의 실질 근거) */
  | { type: "img"; url: string; alt: string; caption?: string }
  /** 본문 영상 — 유튜브 쇼츠 임베드. ytVideoId만 저장하고 임베드 URL은 렌더가 조립한다 */
  | { type: "video"; ytVideoId: string; title: string };

/** 유튜브 video id 형식 — 임의 문자열이 iframe src로 들어가는 것을 막는다. */
export function isValidYtVideoId(id: string): boolean {
  return typeof id === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(id);
}

// ── 이미지 URL 허용 호스트 ───────────────────────────────────────────────────
// ★ 임의 외부 URL을 본문에 넣지 못하게 막는다. 이유 3가지:
//   ① next/image remotePatterns 밖이면 렌더 자체가 실패한다
//   ② 외부 호스트 이미지는 방문자 IP가 제3자에게 새는 추적 벡터가 된다
//   ③ 우리가 통제 못 하는 URL은 언제든 깨져 죽은 이미지가 남는다
// 루트 상대경로("/og-villa-go.png")는 자사 자산이라 허용한다.
const ALLOWED_IMAGE_HOST_SUFFIXES = [".r2.dev", ".r2.cloudflarestorage.com", "villa-go.net"];

export function isAllowedImageUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true; // 자사 정적 자산
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ALLOWED_IMAGE_HOST_SUFFIXES.some((suf) => u.host === suf.replace(/^\./, "") || u.host.endsWith(suf));
  } catch {
    return false;
  }
}

/** 발행에 필요한 본문 최소 길이(자). 미달분은 얇은 콘텐츠라 발행하지 않는다. */
export const MIN_ARTICLE_BODY_CHARS = 800;
/**
 * 영상 글(category="video") 전용 하한(자) — ADR-0049 §5.
 * 영상 페이지의 정상 형태는 짧은 소개 텍스트다. 800자를 억지로 채우면 오히려 스팸 시그널이 되므로
 * 별도 하한을 둔다(video 블록 1개 필수 + 텍스트 300자). bodyTextLength의 영상=0 규칙은 그대로 유지.
 */
export const MIN_VIDEO_ARTICLE_BODY_CHARS = 300;
/** 하루 발행 상한 기본값 — AppSetting(SEO_PUBLISH_PER_DAY)이 있으면 그 값이 우선. */
export const DEFAULT_PUBLISH_PER_DAY = 5;
/** 상한의 하드 천장 — 설정값이 잘못 커져도 여기서 막는다(자기-스팸 방지). */
export const MAX_PUBLISH_PER_DAY = 20;

const TEXT_MAX = 2000;

/**
 * 미신뢰 JSON → 블록 배열. 형식을 벗어난 항목은 **조용히 버린다**(throw 금지 —
 * 초안 하나가 깨져도 파이프라인 전체가 멈추면 안 된다). 렌더는 이 결과만 신뢰한다.
 */
export function parseArticleBody(raw: unknown): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type;
    if (type === "h2" || type === "p") {
      const text = typeof o.text === "string" ? o.text.trim().slice(0, TEXT_MAX) : "";
      if (text) out.push({ type, text });
    } else if (type === "img") {
      // 허용 호스트가 아니거나 alt가 없으면 **블록 자체를 버린다**(빈 alt 이미지는 SEO·접근성 양쪽에 무의미).
      const url = typeof o.url === "string" ? o.url.trim() : "";
      const alt = typeof o.alt === "string" ? o.alt.trim().slice(0, 200) : "";
      const caption = typeof o.caption === "string" ? o.caption.trim().slice(0, 200) : "";
      if (url && alt && isAllowedImageUrl(url)) {
        out.push(caption ? { type: "img", url, alt, caption } : { type: "img", url, alt });
      }
    } else if (type === "video") {
      // ★ id 형식을 강제한다 — 검증 없이 iframe src에 넣으면 임의 URL 주입 통로가 된다.
      const id = typeof o.ytVideoId === "string" ? o.ytVideoId.trim() : "";
      const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
      if (isValidYtVideoId(id)) out.push({ type: "video", ytVideoId: id, title: title || "빌라 영상" });
    } else if (type === "ul") {
      const items = Array.isArray(o.items)
        ? o.items
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().slice(0, TEXT_MAX))
            .filter(Boolean)
        : [];
      if (items.length) out.push({ type: "ul", items });
    }
  }
  return out;
}

/**
 * 상세 페이지는 summary를 도입 리드 문단으로 렌더한다. 그런데 생성기(가이드·장소·서비스·빌라 전 경로)가
 * 본문 첫 문단을 summary와 똑같이 만들어, 같은 문단이 두 번 보이던 문제(테오 지적 2026-07-24)가 있었다.
 * 렌더용 블록에서 **첫 블록이 summary와 동일한 p면 버린다**. 공백만 정규화해 **완전 일치**일 때만 제거(과삭제 방지).
 * ★ 분량 하한(isArticlePublishable)은 저장본 bodyJson으로 판정하므로 이 제거의 영향을 받지 않는다.
 */
export function stripLeadingSummaryDuplicate(blocks: ArticleBlock[], summary: string): ArticleBlock[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const first = blocks[0];
  if (first?.type === "p" && norm(first.text) === norm(summary)) return blocks.slice(1);
  return blocks;
}

/** 본문 실제 글자 수 — 분량 하한 판정용(마크업·공백 제외한 텍스트 기준). */
export function bodyTextLength(blocks: ArticleBlock[]): number {
  return blocks.reduce((n, b) => {
    if (b.type === "ul") return n + b.items.join("").length;
    // ★ 이미지·영상은 분량으로 치지 않는다 — 미디어 도배로 글자수 하한을 우회하는 것을 막는다.
    if (b.type === "img") return n + (b.caption?.length ?? 0);
    if (b.type === "video") return n;
    return n + b.text.length;
  }, 0);
}

/**
 * 발행 자격 — 분량 하한 + 최소 구조(제목성 블록 1개 이상).
 *
 * ★ category는 **옵셔널**이다(ADR-0049 §5). 인자 없이 부르면 기존 800자 규칙 그대로라
 *   빌라·서비스·장소·가이드 호출부는 변경 없이 하위호환된다. 영상 글만 별도 하한을 탄다.
 *   video 카테고리 = video 블록 ≥1 + h2 ≥1 + 텍스트 ≥300자.
 */
export function isArticlePublishable(blocks: ArticleBlock[], category?: SeoArticleCategory): boolean {
  if (category === "video") {
    // 영상 글: video 블록 1개 필수 + 최소 소개 텍스트 300자 + 소제목 1개.
    if (!blocks.some((b) => b.type === "video")) return false;
    if (bodyTextLength(blocks) < MIN_VIDEO_ARTICLE_BODY_CHARS) return false;
    return blocks.some((b) => b.type === "h2");
  }
  if (bodyTextLength(blocks) < MIN_ARTICLE_BODY_CHARS) return false;
  return blocks.some((b) => b.type === "h2");
}

// ── 공개 조회 ────────────────────────────────────────────────────────────────
const PUBLIC_ARTICLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  bodyJson: true,
  coverPhotoUrl: true,
  thumbnailUrl: true,
  category: true,
  relatedVillaIds: true,
  publishedAt: true,
  updatedAt: true,
} satisfies Prisma.SeoArticleSelect;

export interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  blocks: ArticleBlock[];
  coverPhotoUrl: string | null;
  /** 텍스트 얹은 대표 썸네일 — 목록 카드는 thumbnailUrl ?? coverPhotoUrl 순으로 쓴다. */
  thumbnailUrl: string | null;
  /** 대분류 — DB는 String이라 화이트리스트 밖 값은 "guide"로 정규화(카테고리 목록/뱃지용). */
  category: SeoArticleCategory;
  relatedVillaIds: string[];
  publishedAt: Date;
  updatedAt: Date;
}

function toPublicArticle(row: Prisma.SeoArticleGetPayload<{ select: typeof PUBLIC_ARTICLE_SELECT }>): PublicArticle | null {
  if (!row.publishedAt) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    // 첫 문단이 summary와 동일하면 제거(도입 리드로 이미 노출되므로 중복 방지, 2026-07-24)
    blocks: stripLeadingSummaryDuplicate(parseArticleBody(row.bodyJson), row.summary),
    coverPhotoUrl: row.coverPhotoUrl,
    thumbnailUrl: row.thumbnailUrl,
    // DB는 String이므로 화이트리스트 밖 값(수기 오염 등)은 기본 카테고리로 정규화한다.
    category: isSeoArticleCategory(row.category) ? row.category : "guide",
    relatedVillaIds: row.relatedVillaIds,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

/** 발행된 글 목록(최신순). 공개 라우트·sitemap·RSS가 공유하는 단일 진입점. */
export async function getPublishedArticles(db: DbClient = prisma, take = 50): Promise<PublicArticle[]> {
  const rows = await db.seoArticle.findMany({
    // ★ publicHidden은 여기와 아래 단건 조회 두 곳에서만 막으면 된다 —
    //   이 둘이 공개 라우트·sitemap·RSS가 공유하는 단일 진입점이기 때문(파일 상단 규약).
    where: { status: SeoArticleStatus.PUBLISHED, publishedAt: { not: null }, publicHidden: false },
    select: PUBLIC_ARTICLE_SELECT,
    orderBy: { publishedAt: "desc" },
    take,
  });
  return rows.map(toPublicArticle).filter((a): a is PublicArticle => a !== null);
}

/** 슬러그 단건 — 미발행(DRAFT·PENDING·APPROVED·REJECTED)은 null(404 처리). */
export async function getPublishedArticleBySlug(slug: string, db: DbClient = prisma): Promise<PublicArticle | null> {
  const row = await db.seoArticle.findFirst({
    where: { slug, status: SeoArticleStatus.PUBLISHED, publishedAt: { not: null }, publicHidden: false },
    select: PUBLIC_ARTICLE_SELECT,
  });
  return row ? toPublicArticle(row) : null;
}

/**
 * 빌라 → 발행된 소개글 역조회 (계약 D, Q2) — Zalo 채팅 빌라 공유가 블로그 링크를 붙일 때 쓴다.
 * category='villa' 글을 우선하고(빌라 상세 소개), 없으면 이 빌라를 관련 빌라로 단 아무 발행글.
 * 공개 게이트(PUBLISHED·publishedAt·publicHidden=false)는 다른 공개 조회와 동일하게 유지한다.
 * relatedVillaIds에 villaId가 포함된 최신 발행글 1건의 {slug,title}만 반환(없으면 null).
 */
export async function getPublishedArticleForVilla(
  villaId: string,
  db: DbClient = prisma,
): Promise<{ slug: string; title: string } | null> {
  const base = {
    status: SeoArticleStatus.PUBLISHED,
    publishedAt: { not: null },
    publicHidden: false,
    relatedVillaIds: { has: villaId },
  } satisfies Prisma.SeoArticleWhereInput;

  // category='villa' 우선 — 빌라 상세 소개글.
  const villaArticle = await db.seoArticle.findFirst({
    where: { ...base, category: "villa" },
    orderBy: { publishedAt: "desc" },
    select: { slug: true, title: true },
  });
  if (villaArticle) return villaArticle;

  // 폴백 — 카테고리 무관 아무 발행글(이 빌라를 관련 빌라로 단 가이드·장소 등).
  return db.seoArticle.findFirst({
    where: base,
    orderBy: { publishedAt: "desc" },
    select: { slug: true, title: true },
  });
}

// ── 카테고리별 공개 목록 (T-seo-category) ────────────────────────────────────
/** 카테고리 목록 페이지네이션 기본 크기 — 프로젝트 규칙(목록 기본 10, 서버 skip/take). */
export const ARTICLES_PAGE_SIZE = 10;

export interface PagedPublicArticles {
  articles: PublicArticle[];
  total: number;
  /** 1-기반 현재 페이지 */
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 특정 카테고리의 발행 글을 최신순 + 서버 페이지네이션으로 조회.
 * ★ 공개 게이트(PUBLISHED·publishedAt·publicHidden=false)는 다른 조회와 동일하게 유지한다 —
 *   category만 추가로 좁힌다. 기존 getPublishedArticles 호출부는 건드리지 않는 별도 진입점.
 */
export async function getPublishedArticlesByCategory(
  category: SeoArticleCategory,
  page = 1,
  pageSize = ARTICLES_PAGE_SIZE,
  db: DbClient = prisma,
): Promise<PagedPublicArticles> {
  const where = {
    status: SeoArticleStatus.PUBLISHED,
    publishedAt: { not: null },
    publicHidden: false,
    category,
  } satisfies Prisma.SeoArticleWhereInput;

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const [total, rows] = await Promise.all([
    db.seoArticle.count({ where }),
    db.seoArticle.findMany({
      where,
      select: PUBLIC_ARTICLE_SELECT,
      orderBy: { publishedAt: "desc" },
      skip: (safePage - 1) * pageSize, // ★ 클라 slice 금지 — 서버 skip/take
      take: pageSize,
    }),
  ]);
  return {
    articles: rows.map(toPublicArticle).filter((a): a is PublicArticle => a !== null),
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ── 점진 발행 ────────────────────────────────────────────────────────────────
/** KST 기준 하루의 UTC 경계 — 발행 상한은 운영자 체감(한국 시간) 하루로 센다. */
export function kstDayBoundsUtc(now: Date): { start: Date; end: Date } {
  const KST = 9 * 3600 * 1000;
  const kst = new Date(now.getTime() + KST);
  const startKstMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return { start: new Date(startKstMs - KST), end: new Date(startKstMs - KST + 24 * 3600 * 1000) };
}

/** 설정된 일 발행 상한 — AppSetting > 기본값. 하드 천장으로 클램프. */
export async function getPublishPerDay(db: DbClient = prisma): Promise<number> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: "SEO_PUBLISH_PER_DAY" },
      select: { value: true },
    });
    const n = parseInt((row?.value ?? "").trim(), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_PUBLISH_PER_DAY;
    return Math.min(MAX_PUBLISH_PER_DAY, n);
  } catch {
    return DEFAULT_PUBLISH_PER_DAY;
  }
}

/**
 * 이번 실행에서 발행 가능한 건수 = 상한 − 오늘(KST) 이미 발행한 수.
 * 0 이하면 아무것도 발행하지 않는다.
 */
export async function remainingPublishQuota(now: Date, db: DbClient = prisma): Promise<number> {
  const limit = await getPublishPerDay(db);
  if (limit <= 0) return 0;
  const { start, end } = kstDayBoundsUtc(now);
  const publishedToday = await db.seoArticle.count({
    where: { status: SeoArticleStatus.PUBLISHED, publishedAt: { gte: start, lt: end } },
  });
  return Math.max(0, limit - publishedToday);
}

/**
 * 발행 대기(APPROVED) 글을 오래된 승인 순으로 quota만큼.
 * ★ category를 함께 실어 발행 자격 판정(isArticlePublishable)이 카테고리별 하한을 탈 수 있게 한다
 *   (영상 글은 300자 하한 — ADR-0049 §5). DB는 String이라 화이트리스트 밖 값은 undefined로 정규화한다.
 */
export async function pickArticlesToPublish(quota: number, db: DbClient = prisma) {
  if (quota <= 0) return [];
  const rows = await db.seoArticle.findMany({
    where: { status: SeoArticleStatus.APPROVED },
    orderBy: { approvedAt: "asc" },
    take: quota,
    select: { id: true, slug: true, title: true, bodyJson: true, category: true },
  });
  return rows.map((r) => ({
    ...r,
    category: isSeoArticleCategory(r.category) ? r.category : undefined,
  }));
}
