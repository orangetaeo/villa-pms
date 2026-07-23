"use server";
// /marketing/seo 서버 액션 — 가이드 글 승인·반려 (T-seo-s3)
//
// ★ 모든 액션 첫 줄에서 권한 검사한다(운영자 + 마케팅 접근 허용자). 클라이언트 상태를 신뢰하지 않는다.
// ★ 승인은 곧 "발행 큐 진입"이다. 실제 발행은 seo-publish cron이 일 상한을 지키며 수행한다
//   — 승인 즉시 발행하지 않는 것이 점진 발행 정책의 핵심이다.
import { revalidatePath } from "next/cache";
import { SeoArticleStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import { writeAuditLog } from "@/lib/audit-log";
import { parseArticleBody, isArticlePublishable } from "@/lib/seo/article";

async function requireMarketingOperator(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId || !role || !isOperator(role)) throw new Error("FORBIDDEN");
  if (!(await userCanSeeMarketing(userId))) throw new Error("FORBIDDEN");
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
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoArticle",
    entityId: id,
    changes: { status: { old: row.status, new: "REJECTED" }, rejectionReason: { new: reason || null } },
  });
  revalidatePath("/marketing/seo");
}
