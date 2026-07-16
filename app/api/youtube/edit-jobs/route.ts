// POST /api/youtube/edit-jobs — 직접 촬영 클립 편집 잡 생성 (marketing-s2 §A-3). admin.
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403.
// 흐름: {params(EditParams), title?, villaId?} → 검증 → (villaId면) 빌라 공개정보로 meta 초안 생성
//   → YoutubeShort(sourceType=UPLOADED, status=DRAFT, editJobStatus=PENDING) 생성 → {id}. AuditLog.
// ★ 이 시점엔 영상이 없어 videoUrl은 빈 문자열 placeholder — run 라우트가 렌더 후 채운다(DRAFT라 업로드 cron 미대상).
// ★ 누수: meta 입력은 빌라 공개정보(VillaPublicInfo)만 — 원가·마진·판매가 미포함(meta.ts 봉인).
import { NextResponse } from "next/server";
import { YtShortStatus, YtSourceType, YtEditJobStatus, type Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { validateEditParams, EditValidationError, type EditParams } from "@/lib/youtube/edit";
import { generateShortMeta } from "@/lib/youtube/meta";
import type { VillaPublicInfo } from "@/lib/instagram/caption";

export const dynamic = "force-dynamic";

/** 빌라 공개정보 로드(누수 방지 화이트리스트 select) → VillaPublicInfo. 미존재 시 null. */
async function loadVillaPublicInfo(villaId: string): Promise<VillaPublicInfo | null> {
  const v = await prisma.villa.findUnique({
    where: { id: villaId },
    select: {
      name: true,
      nameVi: true,
      complex: true,
      bedrooms: true,
      maxGuests: true,
      beachDistanceM: true,
      hasPool: true,
      breakfastAvailable: true,
      features: { select: { featureKey: true } },
    },
  });
  if (!v) return null;
  return {
    name: v.name,
    nameVi: v.nameVi,
    complex: v.complex,
    bedrooms: v.bedrooms,
    maxGuests: v.maxGuests,
    beachDistanceM: v.beachDistanceM,
    hasPool: v.hasPool,
    breakfastAvailable: v.breakfastAvailable,
    featureKeys: v.features.map((f) => f.featureKey),
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  let params: EditParams;
  try {
    params = validateEditParams(b.params);
  } catch (e) {
    if (e instanceof EditValidationError) {
      return NextResponse.json({ error: "INVALID_PARAMS", code: e.code }, { status: 400 });
    }
    throw e;
  }

  const villaId =
    params.villaId ?? (typeof b.villaId === "string" && b.villaId.trim() ? b.villaId.trim() : null);

  // 메타(제목·설명·태그) 초안 — villaId 있으면 공개정보 기반 생성, 없으면 기본값/override.
  let title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 100) : "";
  let description = "";
  let tags: string[] = [];
  let flaggedTerms: string[] = [];
  let resolvedVillaName: string | null = null;

  if (villaId) {
    const info = await loadVillaPublicInfo(villaId);
    if (!info) return NextResponse.json({ error: "VILLA_NOT_FOUND" }, { status: 400 });
    resolvedVillaName = info.name;
    const meta = await generateShortMeta(info);
    if (!title) title = meta.title;
    description = meta.description;
    tags = meta.tags;
    flaggedTerms = meta.flaggedTerms;
  }
  if (!title) title = "직접 촬영 편집 영상";

  const created = await prisma.youtubeShort.create({
    data: {
      villaId,
      sourceType: YtSourceType.UPLOADED,
      status: YtShortStatus.DRAFT,
      scheduledAt: new Date(), // 업로드 슬롯 — 승인 후 조정 가능(별도 태스크)
      title,
      description,
      tags: tags as unknown as Prisma.InputJsonValue,
      videoUrl: "", // placeholder — run 라우트가 렌더 산출물 URL로 교체(DRAFT라 업로드 cron 미대상)
      flaggedTerms: flaggedTerms.length ? (flaggedTerms as unknown as Prisma.InputJsonValue) : undefined,
      editJobStatus: YtEditJobStatus.PENDING,
      editParamsJson: params as unknown as Prisma.InputJsonValue,
      sourceClipsJson: params.clips.map((c) => c.key) as unknown as Prisma.InputJsonValue,
      createdBy: session.user.id,
    },
    select: { id: true },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "YoutubeShort",
    entityId: created.id,
    changes: {
      sourceType: { new: "UPLOADED" },
      editJobStatus: { new: "PENDING" },
      clipCount: { new: params.clips.length },
      villaId: { new: villaId },
    },
  });

  return NextResponse.json({ id: created.id, editJobStatus: "PENDING", villaName: resolvedVillaName });
}
