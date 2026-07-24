"use server";
// /marketing/seo 서버 액션 — 가이드 글 승인·반려 (T-seo-s3)
//
// ★ 모든 액션 첫 줄에서 권한 검사한다(전체 운영자 isOperator — SEO 글엔 원가·마진 필드가 없어 누수 표면 0).
//    클라이언트 상태를 신뢰하지 않는다.
// ★ 승인은 곧 "발행 큐 진입"이다. 실제 발행은 seo-publish cron이 일 상한을 지키며 수행한다
//   — 승인 즉시 발행하지 않는 것이 점진 발행 정책의 핵심이다.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SeoArticleStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { parseArticleBody, isArticlePublishable, bodyTextLength, MIN_ARTICLE_BODY_CHARS } from "@/lib/seo/article";
import { parseEditedArticle } from "@/lib/seo/article-edit";
import { toArticleHtml } from "@/lib/seo/article-html";

async function requireMarketingOperator(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId || !role || !isOperator(role)) throw new Error("FORBIDDEN");
  return userId;
}

export async function approveArticle(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const row = await prisma.seoArticle.findUnique({
    where: { id },
    select: { id: true, slug: true, status: true, bodyJson: true },
  });
  if (!row || row.status !== SeoArticleStatus.PENDING_APPROVAL) return;

  // 승인 시점에도 분량·구조 하한을 다시 본다 — 초안 생성 이후 본문이 바뀌었을 수 있다.
  if (!isArticlePublishable(parseArticleBody(row.bodyJson))) return;

  await prisma.seoArticle.updateMany({
    where: { id, status: SeoArticleStatus.PENDING_APPROVAL },
    data: { status: SeoArticleStatus.APPROVED, approvedAt: new Date(), rejectionReason: null },
  });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoArticle",
    entityId: id,
    changes: { status: { old: "PENDING_APPROVAL", new: "APPROVED" }, slug: { new: row.slug } },
  });
  revalidatePath("/marketing/seo");
}

/**
 * 발행된 글 노출/비노출 (T-seo-ux-fix 지적 6).
 * ★ 상태를 REJECTED로 되돌리지 않는다 — 되돌릴 수 있어야 하고, 발행 이력(publishedAt)도 지키기 위함.
 *   공개 조회 2곳(getPublishedArticles·getPublishedArticleBySlug)이 publicHidden을 걸러낸다.
 */
export async function toggleArticleVisibility(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const row = await prisma.seoArticle.findUnique({
    where: { id },
    select: { status: true, slug: true, publicHidden: true },
  });
  if (!row || row.status !== SeoArticleStatus.PUBLISHED) return;

  await prisma.seoArticle.update({ where: { id }, data: { publicHidden: !row.publicHidden } });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoArticle",
    entityId: id,
    changes: { publicHidden: { old: row.publicHidden, new: !row.publicHidden }, slug: { new: row.slug } },
  });
  revalidatePath("/marketing/seo");
}

/**
 * 본문 편집 저장 (T-seo-article-edit) — 승인 화면에서 문장을 고치거나 문단·사진을 빼고 저장한다.
 * ★ 발행된 글도 고칠 수 있다(오탈자·지어낸 표현을 내리는 것이 더 급하다). 상태는 바꾸지 않는다.
 * ★ 편집 결과가 분량 하한에 미달하면 저장하지 않는다 — 사람이 고쳤어도 발행 기준은 같다.
 * ★ bodyHtml은 블록에서 다시 만든다(정본은 블록, HTML은 산출물).
 */
export async function updateArticleBody(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const before = await prisma.seoArticle.findUnique({
    where: { id },
    select: { title: true, summary: true, bodyJson: true, thumbnailUrl: true, slug: true },
  });
  if (!before) return;

  const edited = parseEditedArticle(formData);
  // 사람이 고친 뒤에도 렌더 계약(파서)을 다시 통과시킨다.
  const blocks = parseArticleBody(edited.blocks);
  if (!isArticlePublishable(blocks)) {
    redirect(`/marketing/seo?error=TOO_SHORT&chars=${bodyTextLength(blocks)}&min=${MIN_ARTICLE_BODY_CHARS}`);
  }

  const title = edited.title || before.title;
  const summary = edited.summary || before.summary;
  await prisma.seoArticle.update({
    where: { id },
    data: {
      title,
      summary,
      bodyJson: blocks,
      bodyHtml: toArticleHtml(blocks, { title, thumbnailUrl: before.thumbnailUrl, summary }),
    },
  });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoArticle",
    entityId: id,
    changes: {
      edited: { new: true },
      slug: { new: before.slug },
      title: { old: before.title, new: title },
      blocks: { old: parseArticleBody(before.bodyJson).length, new: blocks.length },
      chars: { new: bodyTextLength(blocks) },
    },
  });
  revalidatePath("/marketing/seo");
}

export async function rejectArticle(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!id) return;

  const row = await prisma.seoArticle.findUnique({ where: { id }, select: { status: true, slug: true } });
  if (!row || row.status === SeoArticleStatus.PUBLISHED) return; // 발행분은 반려로 되돌리지 않는다

  await prisma.seoArticle.updateMany({
    where: { id, status: { not: SeoArticleStatus.PUBLISHED } },
    data: { status: SeoArticleStatus.REJECTED, rejectionReason: reason || null },
  });

  // ★ 반려하면 그 글에 묶였던 장소를 **되돌려준다** — 안 그러면 그 가게는 영영 다시 글에 못 나온다
  //   (실측 2026-07-23: 테오가 메오키친 글을 반려했더니 메오키친이 소비된 채로 남아 재생성 불가).
  const released = await prisma.seoPlace.updateMany({
    where: { usedInArticleId: id },
    data: { usedInArticleId: null, usedAt: null },
  });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoArticle",
    entityId: id,
    changes: {
      status: { old: row.status, new: "REJECTED" },
      rejectionReason: { new: reason || null },
      releasedPlaces: { new: released.count },
    },
  });
  revalidatePath("/marketing/seo");
}
