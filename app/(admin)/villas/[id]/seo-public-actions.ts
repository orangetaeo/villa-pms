"use server";
// 빌라 공개 노출(SEO) 서버 액션 — T-seo-s2 앞부분
//
// ★ 모든 액션 첫 줄에서 권한 검사한다(운영자). 클라이언트 상태를 신뢰하지 않는다.
// ★ 공개 전환은 조건 충족(슬러그·소개문·사진·검수)일 때만 허용한다 —
//   조건 미달 빌라를 켜면 얇은 페이지가 색인되고, 그 판정은 도메인 전체에 번진다.
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import {
  PREP_VILLA_SELECT,
  ensureUniquePublicSlug,
  generateVillaDescription,
  toDescriptionFacts,
  evaluatePrep,
} from "@/lib/seo/villa-prep";

async function requireOperator(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId || !role || !isOperator(role)) throw new Error("FORBIDDEN");
  return userId;
}

/** 슬러그 발급 — 이미 있으면 아무것도 하지 않는다(발급 후 불변). */
export async function issuePublicSlug(formData: FormData): Promise<void> {
  const userId = await requireOperator();
  const id = String(formData.get("villaId") ?? "");
  if (!id) return;
  // ★ ensureUniquePublicSlug는 {id, complex, bedrooms}로 실명 없는 slug를 만든다(PR #440).
  //   name/nameVi를 넘기면 초과 프로퍼티라 TS는 통과하지만 complex/bedrooms가 undefined가 되어
  //   slug가 `villa-{id8}` 폴백으로 퇴화한다 — cron 경로와 동일하게 complex/bedrooms를 넘긴다.
  const v = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, complex: true, bedrooms: true, publicSlug: true },
  });
  if (!v || v.publicSlug) return;
  const slug = await ensureUniquePublicSlug(v, prisma);
  await prisma.villa.update({ where: { id }, data: { publicSlug: slug } });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Villa",
    entityId: id,
    changes: { publicSlug: { old: null, new: slug } },
  });
  revalidatePath(`/villas/${id}`);
}

/** 소개문 자동 생성 — ★기존 소개문이 있으면 덮어쓰지 않는다. */
export async function generateDescription(formData: FormData): Promise<void> {
  const userId = await requireOperator();
  const id = String(formData.get("villaId") ?? "");
  if (!id) return;
  const v = await prisma.villa.findUnique({ where: { id }, select: PREP_VILLA_SELECT });
  if (!v) return;
  if ((v.description ?? "").trim().length > 0) return; // 사람이 쓴 글 보호

  const gen = await generateVillaDescription(toDescriptionFacts(v));
  if (!gen) return; // 실패 시 조용히 무동작(운영자가 다시 누르면 된다)

  await prisma.villa.update({ where: { id }, data: { description: gen.text } });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Villa",
    entityId: id,
    changes: {
      description: { old: null, new: `${gen.text.length}자 자동 생성` },
      flaggedTerms: { new: gen.flaggedTerms },
    },
  });
  revalidatePath(`/villas/${id}`);
}

/** 공개 노출 토글 — 켤 때만 조건을 검사한다(끄는 건 언제나 허용: 즉시 내리는 안전밸브). */
export async function togglePublicListed(formData: FormData): Promise<void> {
  const userId = await requireOperator();
  const id = String(formData.get("villaId") ?? "");
  const next = String(formData.get("next") ?? "") === "1";
  if (!id) return;

  const v = await prisma.villa.findUnique({
    where: { id },
    select: {
      status: true,
      isSellable: true,
      publicSlug: true,
      description: true,
      publicListed: true,
      _count: { select: { photos: true } },
    },
  });
  if (!v || v.publicListed === next) return;

  if (next) {
    const prep = evaluatePrep({
      status: v.status,
      isSellable: v.isSellable,
      publicSlug: v.publicSlug,
      description: v.description,
      photoCount: v._count.photos,
    });
    if (!prep.eligible) return; // 조건 미달은 켜지 않는다(UI가 이미 버튼을 비활성화하지만 서버가 최종 판단)
  }

  await prisma.villa.update({
    where: { id },
    data: { publicListed: next, ...(next ? { publicListedAt: new Date() } : {}) },
  });
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Villa",
    entityId: id,
    changes: { publicListed: { old: !next, new: next } },
  });
  revalidatePath(`/villas/${id}`);
}
