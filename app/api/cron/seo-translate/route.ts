// 블로그 글 다국어 번역 cron (ADR-0049 §4 · drip 방식)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(타 cron 동일, 첫 줄 게이트).
// 흐름: 발행 글(PUBLISHED·공개) × {en,vi,ru,zh} 중 [행없음 | stale(hash 불일치) | FAILED>24h]만 쿼터만큼 번역.
//
// ★ 발행 cron에 인라인하지 않는다(ADR §4) — 번역은 별도 drip. Gemini 호출이 발행 지연을 유발하면 안 된다.
// ★ stale이어도 재번역 **완료 전까지 기존 READY를 계속 서빙**한다(없는 것보다 낫다). 여기서 상태를 끄지 않는다.
// ★ 누수 0: 번역 파이프라인이 실명·금액 가드를 걸어 통과분만 READY로 저장한다(translate-article.ts).
import { SeoArticleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { articleSourceHash, TRANSLATION_READY, TRANSLATION_FAILED } from "@/lib/seo/article-i18n";
import { NON_KO_BLOG_LOCALES } from "@/lib/seo/blog-locale";
import { translateArticleToLocale, loadRealNameNeedles } from "@/lib/seo/translate-article";

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

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "seo-translate");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const quota = await getTranslatePerRun();
  if (quota <= 0) return Response.json({ ok: true, translated: 0, reason: "쿼터 0" });

  // 공개 발행 글(최신순) — 조회 게이트는 article.ts와 동일 조건(PUBLISHED·publishedAt·publicHidden=false).
  const articles = await prisma.seoArticle.findMany({
    where: { status: SeoArticleStatus.PUBLISHED, publishedAt: { not: null }, publicHidden: false },
    orderBy: { publishedAt: "desc" },
    select: { id: true, slug: true, title: true, summary: true, bodyJson: true },
  });
  if (articles.length === 0) return Response.json({ ok: true, translated: 0, reason: "발행 글 없음" });

  const ids = articles.map((a) => a.id);
  const existing = await prisma.seoArticleTranslation.findMany({
    where: { articleId: { in: ids } },
    select: { articleId: true, locale: true, status: true, sourceHash: true, updatedAt: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.articleId}:${e.locale}`, e]));

  // 대상 선정: 최신 글 우선 × 로케일 순회. quota 도달 시 중단.
  const cutoff = new Date(Date.now() - FAILED_RETRY_MS);
  const work: { article: (typeof articles)[number]; locale: (typeof NON_KO_BLOG_LOCALES)[number] }[] = [];
  outer: for (const a of articles) {
    const hash = articleSourceHash(a);
    for (const locale of NON_KO_BLOG_LOCALES) {
      if (work.length >= quota) break outer;
      const ex = byKey.get(`${a.id}:${locale}`);
      const need =
        !ex || // 행 없음
        (ex.status === TRANSLATION_READY && ex.sourceHash !== hash) || // stale(재번역 전까지 기존 서빙 유지)
        (ex.status === TRANSLATION_FAILED && ex.updatedAt < cutoff); // FAILED 24h 경과
      if (need) work.push({ article: a, locale });
    }
  }

  if (work.length === 0) {
    return Response.json({ ok: true, translated: 0, reason: "대상 없음", articles: articles.length });
  }

  // 실명 needle은 실행당 1회만 조회해 모든 항목에 재사용(빌라 전수 — 소수라 저렴).
  const needles = await loadRealNameNeedles(prisma);

  const results: { slug: string; locale: string; status: string; errorNote: string | null }[] = [];
  for (const w of work) {
    const r = await translateArticleToLocale(w.article, w.locale, { realNameNeedles: needles });
    results.push({ slug: w.article.slug, locale: r.locale, status: r.status, errorNote: r.errorNote });
  }

  const ready = results.filter((r) => r.status === TRANSLATION_READY).length;
  const failed = results.filter((r) => r.status === TRANSLATION_FAILED);
  return Response.json({
    ok: true,
    quota,
    processed: results.length,
    ready,
    failed: failed.length,
    results,
  });
}

export const GET = handle;
export const POST = handle;
