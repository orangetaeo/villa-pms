// 가이드 글 발행 cron (T-seo-s3)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
// 흐름: 승인(APPROVED)분을 **하루 상한 잔여만큼** 발행 → IndexNow 핑 → AuditLog.
//
// ★ 이 cron의 존재 이유가 곧 상한이다. 승인 즉시 발행하지 않고 큐에 담아 하루 N건씩 내보낸다.
//   신뢰도 0인 신규 도메인에서 수십 건을 한 번에 색인 요청하면 그 자체가 스팸 시그널이다
//   (구글 scaled content abuse 2024-03 · 네이버가 블로그 글쓰기 API를 닫은 사유와 동일 맥락).
// ★ IndexNow 실패가 발행을 되돌리지 않는다 — 색인 요청은 부가 작업이고, 실패해도
//   sitemap·RSS로 결국 수집된다. 반대로 발행 롤백은 사용자에게 보이는 피해다.
import { SeoArticleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import { parseArticleBody, isArticlePublishable, remainingPublishQuota, pickArticlesToPublish } from "@/lib/seo/article";
import { pingIndexNow } from "@/lib/seo/indexnow";
import { blogPaths } from "@/lib/seo/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "seo-publish");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const now = new Date();
  const quota = await remainingPublishQuota(now, prisma);
  if (quota <= 0) {
    return Response.json({ ok: true, published: 0, reason: "일 발행 상한 도달" });
  }

  const candidates = await pickArticlesToPublish(quota, prisma);
  const publishedSlugs: string[] = [];
  const failed: { slug: string; reason: string }[] = [];

  for (const c of candidates) {
    // 승인 후에 본문이 손상됐을 가능성 방어 — 하한 미달이면 발행하지 않는다.
    const blocks = parseArticleBody(c.bodyJson);
    if (!isArticlePublishable(blocks)) {
      failed.push({ slug: c.slug, reason: "분량·구조 하한 미달" });
      continue;
    }

    // 조건부 update로 중복 발행 방지(동시 실행 시 두 번 발행되지 않게 status를 조건에 건다).
    const res = await prisma.seoArticle.updateMany({
      where: { id: c.id, status: SeoArticleStatus.APPROVED },
      data: { status: SeoArticleStatus.PUBLISHED, publishedAt: now },
    });
    if (res.count === 0) {
      failed.push({ slug: c.slug, reason: "이미 처리됨(동시 실행)" });
      continue;
    }

    publishedSlugs.push(c.slug);
    await writeAuditLog({
      userId: null,
      action: "UPDATE",
      entity: "SeoArticle",
      entityId: c.id,
      changes: {
        status: { old: "APPROVED", new: "PUBLISHED" },
        slug: { new: c.slug },
        title: { new: c.title },
      },
    });
  }

  // 색인 요청 — 발행분 전체를 한 번에. 실패해도 위 발행은 유지된다.
  let pingResults: Awaited<ReturnType<typeof pingIndexNow>> = [];
  if (publishedSlugs.length > 0) {
    pingResults = await pingIndexNow(publishedSlugs.map((s) => blogPaths.article(s)));
    const okAny = pingResults.some((r) => r.ok);
    if (okAny) {
      await prisma.seoArticle.updateMany({
        where: { slug: { in: publishedSlugs } },
        data: { lastPingAt: new Date() },
      });
    }
  }

  if (failed.length > 0) {
    await notifyMarketing({
      kind: "SEO_PUBLISH_FAILED",
      summary: `가이드 글 발행 실패 ${failed.length}건: ${failed.map((f) => `${f.slug}(${f.reason})`).join(", ")}`,
      href: "/marketing/seo",
    });
  }

  return Response.json({
    ok: true,
    quota,
    published: publishedSlugs.length,
    slugs: publishedSlugs,
    failed,
    indexNow: pingResults,
  });
}

export const GET = handle;
export const POST = handle;
