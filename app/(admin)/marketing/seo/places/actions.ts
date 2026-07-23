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
import { placeCategory } from "@/lib/seo/place-article";

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

/** 업로드된 사진을 장소에 붙인다 — 자료 사진과 같은 저장소(SeoMedia)를 쓰되 placeId로 구분한다. */
export async function addPlacePhoto(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const placeId = String(formData.get("placeId") ?? "");
  const url = read(formData, "url", 1000);
  const alt = read(formData, "alt", 200);
  if (!placeId) return;
  if (!url) redirect(`${PATH}?error=URL_REQUIRED`);
  if (alt.length < 2) redirect(`${PATH}?error=ALT_REQUIRED`);

  const place = await prisma.seoPlace.findUnique({ where: { id: placeId }, select: { id: true, name: true } });
  if (!place) return;

  const media = await prisma.seoMedia.create({
    data: { url, alt, placeId, caption: read(formData, "caption", 200) || null, uploadedBy: userId },
    select: { id: true },
  });
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "SeoMedia",
    entityId: media.id,
    changes: { placeId: { new: placeId }, place: { new: place.name }, alt: { new: alt } },
  });
  revalidatePath(PATH);
}
