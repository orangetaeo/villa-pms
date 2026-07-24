-- 2026-07-24-seo-article-translation.sql — 공개 블로그 다국어화 (ADR-0049)
CREATE TABLE IF NOT EXISTS "SeoArticleTranslation" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "bodyJson" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "errorNote" TEXT,
  "model" TEXT,
  "translatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeoArticleTranslation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeoArticleTranslation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeoArticleTranslation_articleId_locale_key" ON "SeoArticleTranslation"("articleId","locale");
CREATE INDEX IF NOT EXISTS "SeoArticleTranslation_locale_status_idx" ON "SeoArticleTranslation"("locale","status");
