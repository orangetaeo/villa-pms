"use server";
// /marketing/seo/media 서버 액션 — 자료 사진 라이브러리 CRUD (T-seo-media-library)
//
// ★ 모든 액션 첫 줄에서 권한 검사(전체 운영자 isOperator). 클라이언트 상태를 신뢰하지 않는다.
// ★ 삭제 액션이 없다 — 이미 발행된 글의 본문 이미지 URL이 죽으면 안 되므로 active=false로만 내린다.
// ★ URL은 클라이언트가 보낸 문자열이지만 **허용 호스트 검증**(isAllowedImageUrl)을 통과해야만 저장된다.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { normalizeTopicKeys, validateMediaInput } from "@/lib/seo/media";

const PATH = "/marketing/seo/media";

async function requireMarketingOperator(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId || !role || !isOperator(role)) throw new Error("FORBIDDEN");
  return userId;
}

function readTopicKeys(formData: FormData): string[] {
  return normalizeTopicKeys(formData.getAll("topicKeys").map((v) => String(v)));
}

/**
 * 업로드된 사진들을 라이브러리에 등록 — **여러 장 한 번에**(T-seo-ux-fix 지적 1).
 * url[]·alt[]는 업로더가 짝지어 보낸다. alt 없거나 허용 호스트 밖인 항목은 건너뛴다.
 * ★ 같은 URL이 두 번 오면 하나만 저장한다(메오키친에서 실제로 중복 행이 생겼다).
 */
export async function createMedia(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const urls = formData.getAll("url").map((v) => String(v).trim());
  const alts = formData.getAll("alt").map((v) => String(v).trim().slice(0, 200));
  if (urls.length === 0 || urls.every((u) => !u)) redirect(`${PATH}?error=URL_REQUIRED`);

  const topicKeys = readTopicKeys(formData);
  const seen = new Set<string>();
  const created: string[] = [];
  let altMissing = false;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const alt = alts[i] ?? "";
    if (!url || seen.has(url)) continue;
    const check = validateMediaInput({ url, alt });
    if (!check.ok) {
      if (check.error === "ALT_REQUIRED") altMissing = true;
      continue;
    }
    seen.add(url);
    const row = await prisma.seoMedia.create({
      data: { url, alt, topicKeys, uploadedBy: userId },
      select: { id: true },
    });
    created.push(row.id);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entity: "SeoMedia",
      entityId: row.id,
      changes: { url: { new: url }, alt: { new: alt }, topicKeys: { new: topicKeys } },
    });
  }

  revalidatePath(PATH);
  // 한 장도 못 넣었으면 이유를 화면에 띄운다(throw는 "알 수 없는 오류" 화면만 남긴다).
  if (created.length === 0) redirect(`${PATH}?error=${altMissing ? "ALT_REQUIRED" : "URL_NOT_ALLOWED"}`);
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

/**
 * 선택한 자료 사진을 **영구 삭제**(하드 삭제) — 여러 장 한 번에(체크박스 다중선택).
 * ★ DB 행만 지운다. **R2 원본 파일은 지우지 않는다**: 이미 발행된 글의 bodyJson에 이미지 URL이
 *   구워져 있어 파일을 지우면 발행글 이미지가 깨진다(존치가 계약 — actions.ts 상단 삭제 정책 참조).
 * ★ placeId=null 조건 필수 — 장소 사진(placeId 있음)은 이 화면 대상이 아니다(/marketing/seo/places 소관, 방어).
 */
export async function deleteMedia(formData: FormData): Promise<void> {
  const userId = await requireMarketingOperator();
  const ids = formData
    .getAll("ids")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  if (ids.length === 0) return;

  const result = await prisma.seoMedia.deleteMany({
    where: { id: { in: ids }, placeId: null },
  });

  if (result.count > 0) {
    await writeAuditLog({
      userId,
      action: "DELETE",
      entity: "SeoMedia",
      entityId: ids[0],
      changes: { deletedIds: { old: ids }, count: { old: result.count } },
    });
  }
  revalidatePath(PATH);
}
