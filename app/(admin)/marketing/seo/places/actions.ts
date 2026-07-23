"use server";
// /marketing/seo/places 서버 액션 — 푸꾸옥 장소 등록·수정 (T-seo-place-article)
//
// ★ 첫 줄에서 권한 검사(운영자 + 마케팅 접근 허용자).
// ★ `oneLiner`(직접 가본 인상)는 **필수** — 비면 AI가 채우게 되고, 그게 곧 지어내기다.
// ★ 삭제 없음 — active=false로 내린다(이미 발행된 글에 등장한 장소의 이력을 지우지 않는다).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import { writeAuditLog } from "@/lib/audit-log";
import { placeCategory, createPlaceArticleDraft, PLACE_SELECT } from "@/lib/seo/place-article";
import { isArticlePublishable } from "@/lib/seo/article";
import { buildArticleSlug, buildSummary, interleaveImages, BRAND_FALLBACK_IMAGE } from "@/lib/seo/article-draft";

const PATH = "/marketing/seo/places";

async function requireMarketingOperator(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId || !role || !isOperator(role)) throw new Error("FORBIDDEN");
  if (!(await userCanSeeMarketing(userId))) throw new Error("FORBIDDEN");
  return userId;
}

function read(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

export async function createPlace(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const name = read(formData, "name", 120);
  const category = read(formData, "category", 40);
  const oneLiner = read(formData, "oneLiner", 500);

  if (!name) redirect(`${PATH}?error=NAME_REQUIRED`);
  if (!placeCategory(category)) redirect(`${PATH}?error=CATEGORY_REQUIRED`);
  // ★ 인상이 없으면 글의 재료가 없다 — 등록 자체를 막는다(나중에 채우게 두면 빈 채로 남는다).
  if (oneLiner.length < 10) redirect(`${PATH}?error=ONELINER_REQUIRED`);

  const row = await prisma.seoPlace.create({
    data: {
      name,
      nameLocal: read(formData, "nameLocal", 120) || null,
      category,
      area: read(formData, "area", 80) || null,
      oneLiner,
      tips: read(formData, "tips", 500) || null,
      mapUrl: read(formData, "mapUrl", 500) || null,
      createdBy: userId,
    },
    select: { id: true, name: true, category: true },
  });
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "SeoPlace",
    entityId: row.id,
    changes: { name: { new: row.name }, category: { new: row.category } },
  });
  revalidatePath(PATH);
}

export async function updatePlace(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = read(formData, "name", 120);
  const oneLiner = read(formData, "oneLiner", 500);
  if (!name || oneLiner.length < 10) return;

  const before = await prisma.seoPlace.findUnique({ where: { id }, select: { name: true, oneLiner: true } });
  if (!before) return;

  await prisma.seoPlace.update({
    where: { id },
    data: {
      name,
      oneLiner,
      area: read(formData, "area", 80) || null,
      tips: read(formData, "tips", 500) || null,
    },
  });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoPlace",
    entityId: id,
    changes: { name: { old: before.name, new: name }, oneLiner: { old: before.oneLiner, new: oneLiner } },
  });
  revalidatePath(PATH);
}

export async function togglePlaceActive(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const row = await prisma.seoPlace.findUnique({ where: { id }, select: { active: true } });
  if (!row) return;

  await prisma.seoPlace.update({ where: { id }, data: { active: !row.active } });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoPlace",
    entityId: id,
    changes: { active: { old: row.active, new: !row.active } },
  });
  revalidatePath(PATH);
}

/**
 * 업로드된 사진들을 장소에 붙인다 — **여러 장 한 번에**(T-seo-ux-fix 지적 1).
 * 자료 사진과 같은 저장소(SeoMedia)를 쓰되 placeId로 구분한다.
 * ★ 같은 URL 중복은 무시한다 — 메오키친에서 같은 사진이 2행 들어간 실제 사례가 있었다.
 */
export async function addPlacePhoto(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const placeId = String(formData.get("placeId") ?? "");
  if (!placeId) return;
  const urls = formData.getAll("url").map((v) => String(v).trim());
  const alts = formData.getAll("alt").map((v) => String(v).trim().slice(0, 200));
  if (urls.length === 0 || urls.every((u) => !u)) redirect(`${PATH}?error=URL_REQUIRED`);

  const place = await prisma.seoPlace.findUnique({
    where: { id: placeId },
    select: { id: true, name: true, photos: { select: { url: true } } },
  });
  if (!place) return;

  const existing = new Set(place.photos.map((p) => p.url));
  let saved = 0;
  let altMissing = false;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const alt = alts[i] ?? "";
    if (!url || existing.has(url)) continue;
    if (alt.length < 2) {
      altMissing = true;
      continue;
    }
    existing.add(url);
    const media = await prisma.seoMedia.create({
      data: { url, alt, placeId, uploadedBy: userId },
      select: { id: true },
    });
    saved++;
    await writeAuditLog({
      userId,
      action: "CREATE",
      entity: "SeoMedia",
      entityId: media.id,
      changes: { placeId: { new: placeId }, place: { new: place.name }, alt: { new: alt } },
    });
  }

  revalidatePath(PATH);
  if (saved === 0) redirect(`${PATH}?error=${altMissing ? "ALT_REQUIRED" : "URL_REQUIRED"}`);
}

/** 사진 개별 내리기/되살리기 — 삭제하지 않는다(발행된 글의 이미지 URL 보호). */
export async function togglePlacePhoto(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("mediaId") ?? "");
  if (!id) return;
  const row = await prisma.seoMedia.findUnique({ where: { id }, select: { active: true } });
  if (!row) return;

  await prisma.seoMedia.update({ where: { id }, data: { active: !row.active } });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoMedia",
    entityId: id,
    changes: { active: { old: row.active, new: !row.active } },
  });
  revalidatePath(PATH);
}

/**
 * "이 장소로 지금 글 만들기" — 자동 생성은 3곳부터지만 운영자가 누르면 **1곳으로도** 만든다.
 * ★ 사람이 명시적으로 누른 것이고, 어차피 승인 게이트를 통과해야 공개된다.
 *   자동 경로(cron)만 3곳 하한을 지킨다 — 사람이 안 보는 경로일수록 보수적이어야 한다.
 */
export async function draftPlaceArticleNow(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const placeId = String(formData.get("placeId") ?? "");
  if (!placeId) return;

  const place = await prisma.seoPlace.findFirst({
    where: { id: placeId, active: true, usedInArticleId: null },
    select: PLACE_SELECT,
  });
  if (!place) redirect(`${PATH}?error=PLACE_NOT_AVAILABLE`);

  const category = placeCategory(place.category);
  if (!category) redirect(`${PATH}?error=CATEGORY_REQUIRED`);

  const already = await prisma.seoArticle.count({
    where: { topicKey: { startsWith: `place-${category.key}-` } },
  });
  const result = await createPlaceArticleDraft(
    { category, places: [place], seq: already + 1, createdBy: `admin:${userId}` },
    {
      helpers: {
        isArticlePublishable,
        buildArticleSlug,
        buildSummary,
        interleaveImages,
        brandFallbackImage: BRAND_FALLBACK_IMAGE,
      },
    }
  );
  if (!result.ok) redirect(`${PATH}?error=DRAFT_FAILED`);

  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "SeoArticle",
    entityId: result.id,
    changes: {
      kind: { new: "place" },
      manual: { new: true },
      category: { new: category.key },
      places: { new: [place.name] },
      slug: { new: result.slug },
      photos: { new: result.photos },
      status: { new: "PENDING_APPROVAL" },
    },
  });
  revalidatePath(PATH);
  redirect("/marketing/seo?tab=pending");
}
