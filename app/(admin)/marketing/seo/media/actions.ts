"use server";
// /marketing/seo/media 서버 액션 — 자료 사진 라이브러리 CRUD (T-seo-media-library)
//
// ★ 모든 액션 첫 줄에서 권한 검사(운영자 + 마케팅 접근 허용자). 클라이언트 상태를 신뢰하지 않는다.
// ★ 삭제 액션이 없다 — 이미 발행된 글의 본문 이미지 URL이 죽으면 안 되므로 active=false로만 내린다.
// ★ URL은 클라이언트가 보낸 문자열이지만 **허용 호스트 검증**(isAllowedImageUrl)을 통과해야만 저장된다.
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { userCanSeeMarketing } from "@/lib/marketing-access";
import { writeAuditLog } from "@/lib/audit-log";
import { normalizeTopicKeys, validateMediaInput } from "@/lib/seo/media";

const PATH = "/marketing/seo/media";

async function requireMarketingOperator(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId || !role || !isOperator(role)) throw new Error("FORBIDDEN");
  if (!(await userCanSeeMarketing(userId))) throw new Error("FORBIDDEN");
  return userId;
}

function readTopicKeys(formData: FormData): string[] {
  return normalizeTopicKeys(formData.getAll("topicKeys").map((v) => String(v)));
}

/** 업로드된 사진을 라이브러리에 등록. alt 없거나 허용 호스트 밖이면 저장하지 않는다. */
export async function createMedia(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const url = String(formData.get("url") ?? "").trim();
  const alt = String(formData.get("alt") ?? "").trim().slice(0, 200);
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 200);
  const credit = String(formData.get("credit") ?? "").trim().slice(0, 100);

  const check = validateMediaInput({ url, alt });
  if (!check.ok) {
    // 폼 오류는 쿼리로 돌려준다(클라이언트 상태 없이 RSC만으로 표시).
    revalidatePath(PATH);
    throw new Error(check.error);
  }

  const row = await prisma.seoMedia.create({
    data: {
      url,
      alt,
      caption: caption || null,
      credit: credit || null,
      topicKeys: readTopicKeys(formData),
      uploadedBy: userId,
    },
    select: { id: true, topicKeys: true },
  });
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "SeoMedia",
    entityId: row.id,
    changes: { url: { new: url }, alt: { new: alt }, topicKeys: { new: row.topicKeys } },
  });
  revalidatePath(PATH);
}

/** alt·캡션·주제 태그 수정. URL은 바꾸지 않는다(이미 본문에 박힌 이미지와 어긋나면 안 된다). */
export async function updateMedia(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const alt = String(formData.get("alt") ?? "").trim().slice(0, 200);
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 200);
  if (alt.length < 2) return; // alt 없는 상태로는 저장할 수 없다

  const before = await prisma.seoMedia.findUnique({
    where: { id },
    select: { alt: true, topicKeys: true },
  });
  if (!before) return;

  const topicKeys = readTopicKeys(formData);
  await prisma.seoMedia.update({
    where: { id },
    data: { alt, caption: caption || null, topicKeys },
  });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "SeoMedia",
    entityId: id,
    changes: {
      alt: { old: before.alt, new: alt },
      topicKeys: { old: before.topicKeys, new: topicKeys },
    },
  });
  revalidatePath(PATH);
}

/** 사용 중지/재개 — 중지해도 이미 발행된 글의 이미지는 그대로 남는다(URL 불변). */
export async function toggleMediaActive(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const id = String(formData.get("id") ?? "");
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
