// 블로그 글 + 빌라 소개문 다국어 번역 cron (ADR-0049 §4 · ADR-0050 §7 · drip 방식)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(타 cron 동일, 첫 줄 게이트).
// 흐름: **빌라 소개문을 먼저** 처리(건수 적고 짧아 기아 방지), 남은 쿼터로 글을 번역한다(단일 Gemini 쿼터 공유).
//   대상 = {공개빌라·발행글} × {en,vi,ru,zh} 중 [행없음 | stale(hash 불일치) | FAILED>24h].
//
// ★ 발행 cron에 인라인하지 않는다(ADR §4) — 번역은 별도 drip. Gemini 호출이 발행 지연을 유발하면 안 된다.
// ★ stale이어도 재번역 **완료 전까지 기존 READY를 계속 서빙**한다(없는 것보다 낫다). 여기서 상태를 끄지 않는다.
// ★ 누수 0: 번역 파이프라인이 실명·금액 가드를 걸어 통과분만 READY로 저장한다(translate-*.ts).
// ★ 실명 needle은 실행당 **1회만** 조회해 빌라·글 두 패스가 재사용한다(빌라 전수 — 소수라 저렴).
import { SeoArticleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { articleSourceHash, TRANSLATION_READY, TRANSLATION_FAILED } from "@/lib/seo/article-i18n";
import { NON_KO_BLOG_LOCALES } from "@/lib/seo/blog-locale";
import { translateArticleToLocale, loadRealNameNeedles } from "@/lib/seo/translate-article";
import { translateVillaDescription, villaSourceHash } from "@/lib/seo/translate-villa";
import { getPublicVillas } from "@/lib/seo/public-villa";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 1회 실행당 번역 상한 기본값 — 점진 공급(과다 호출은 Gemini 비용·지연만 키운다). */
const DEFAULT_TRANSLATE_PER_RUN = 8;
/** 하드 천장 — 설정값이 잘못 커져도 여기서 막는다(getPublishPerDay 패턴 복제). */
const MAX_TRANSLATE_PER_RUN = 24;
/** FAILED 재시도 대기 — 즉시 재시도는 같은 실패를 반복한다. */
const FAILED_RETRY_MS = 24 * 3600 * 1000;

/** 실행당 번역 상한 — AppSetting(SEO_TRANSLATE_PER_RUN) > 기본. 하드 천장으로 클램프. */
async function getTranslatePerRun(): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: "SEO_TRANSLATE_PER_RUN" },
      select: { value: true },
    });
    const n = parseInt((row?.value ?? "").trim(), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_TRANSLATE_PER_RUN;
    return Math.min(MAX_TRANSLATE_PER_RUN, n);
  } catch {
    return DEFAULT_TRANSLATE_PER_RUN;
  }
}

type VillaRow = { id: string; description: string };

/** 빌라 번역 대상 선정 — 공개빌라 × 로케일 중 [행없음|stale|FAILED>24h], quota만큼. */
async function selectVillaWork(
  cutoff: Date,
  quota: number,
): Promise<{ villa: VillaRow; locale: (typeof NON_KO_BLOG_LOCALES)[number] }[]> {
  if (quota <= 0) return [];
  const villas = await getPublicVillas();
  const rows: VillaRow[] = villas.map((v) => ({ id: v.id, description: v.description ?? "" }));
  if (rows.length === 0) return [];

  const existing = await prisma.villaTranslation.findMany({
    where: { villaId: { in: rows.map((r) => r.id) } },
    select: { villaId: true, locale: true, status: true, sourceHash: true, updatedAt: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.villaId}:${e.locale}`, e]));

  const work: { villa: VillaRow; locale: (typeof NON_KO_BLOG_LOCALES)[number] }[] = [];
  outer: for (const villa of rows) {
    const hash = villaSourceHash(villa.description);
    for (const locale of NON_KO_BLOG_LOCALES) {
      if (work.length >= quota) break outer;
      const ex = byKey.get(`${villa.id}:${locale}`);
      const need =
        !ex ||
        (ex.status === TRANSLATION_READY && ex.sourceHash !== hash) ||
        (ex.status === TRANSLATION_FAILED && ex.updatedAt < cutoff);
      if (need) work.push({ villa, locale });
    }
  }
  return work;
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "seo-translate");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const quota = await getTranslatePerRun();
  if (quota <= 0) return Response.json({ ok: true, translated: 0, reason: "쿼터 0" });

  const cutoff = new Date(Date.now() - FAILED_RETRY_MS);

  // ── 1) 빌라 소개문 (먼저, 쿼터 우선 소진) ──────────────────────────────────
  const villaWork = await selectVillaWork(cutoff, quota).catch(() => []);
  const remaining = Math.max(0, quota - villaWork.length);

  // ── 2) 발행 글 (남은 쿼터) ────────────────────────────────────────────────
  const articles = await prisma.seoArticle.findMany({
    where: { status: SeoArticleStatus.PUBLISHED, publishedAt: { not: null }, publicHidden: false },
    orderBy: { publishedAt: "desc" },
    select: { id: true, slug: true, title: true, summary: true, bodyJson: true },
  });
  const articleWork: { article: (typeof articles)[number]; locale: (typeof NON_KO_BLOG_LOCALES)[number] }[] = [];
  if (remaining > 0 && articles.length > 0) {
    const ids = articles.map((a) => a.id);
    const existing = await prisma.seoArticleTranslation.findMany({
      where: { articleId: { in: ids } },
      select: { articleId: true, locale: true, status: true, sourceHash: true, updatedAt: true },
    });
    const byKey = new Map(existing.map((e) => [`${e.articleId}:${e.locale}`, e]));
    outer: for (const a of articles) {
      const hash = articleSourceHash(a);
      for (const locale of NON_KO_BLOG_LOCALES) {
        if (articleWork.length >= remaining) break outer;
        const ex = byKey.get(`${a.id}:${locale}`);
        const need =
          !ex ||
          (ex.status === TRANSLATION_READY && ex.sourceHash !== hash) ||
          (ex.status === TRANSLATION_FAILED && ex.updatedAt < cutoff);
        if (need) articleWork.push({ article: a, locale });
      }
    }
  }

  if (villaWork.length === 0 && articleWork.length === 0) {
    return Response.json({
      ok: true,
      translated: 0,
      reason: "대상 없음",
      articles: articles.length,
      villas: { processed: 0, ready: 0, failed: 0 },
    });
  }

  // 실명 needle은 실행당 1회만 조회해 두 패스가 재사용.
  const needles = await loadRealNameNeedles(prisma);

  // 빌라 패스
  const villaResults: { villaId: string; locale: string; status: string; errorNote: string | null }[] = [];
  for (const w of villaWork) {
    const r = await translateVillaDescription(w.villa, w.locale, { realNameNeedles: needles });
    villaResults.push({ villaId: w.villa.id, locale: r.locale, status: r.status, errorNote: r.errorNote });
  }

  // 글 패스
  const articleResults: { slug: string; locale: string; status: string; errorNote: string | null }[] = [];
  for (const w of articleWork) {
    const r = await translateArticleToLocale(w.article, w.locale, { realNameNeedles: needles });
    articleResults.push({ slug: w.article.slug, locale: r.locale, status: r.status, errorNote: r.errorNote });
  }

  const villaReady = villaResults.filter((r) => r.status === TRANSLATION_READY).length;
  const articleReady = articleResults.filter((r) => r.status === TRANSLATION_READY).length;
  return Response.json({
    ok: true,
    quota,
    processed: villaResults.length + articleResults.length,
    ready: villaReady + articleReady,
    failed: villaResults.length + articleResults.length - villaReady - articleReady,
    villas: {
      processed: villaResults.length,
      ready: villaReady,
      failed: villaResults.length - villaReady,
    },
    results: articleResults,
    villaResults,
  });
}

export const GET = handle;
export const POST = handle;
