// POST /api/youtube/edit-jobs — 직접 촬영 클립 편집 잡 생성 (marketing-s2 §A-3). admin.
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403.
// 소재 2종: ⑴ 마법사에서 새로 올린 `youtube-clips/…` 키 ⑵ **승인된 빌라 영상**(`clips[].villaClipId`
//   → 서버가 `villa-clips/…` 키로 해석). ⑵가 VillaClip의 유일한 소비처다(youtube-villa-clip-source).
// 흐름: {params(EditParams), title?, villaId?} → 소재 해석 → 검증 → (villaId면) 빌라 공개정보로 meta 초안 생성
//   → YoutubeShort(sourceType=UPLOADED, status=DRAFT, editJobStatus=PENDING) 생성 → {id}. AuditLog.
// ★ 이 시점엔 영상이 없어 videoUrl은 빈 문자열 placeholder — run 라우트가 렌더 후 채운다(DRAFT라 업로드 cron 미대상).
// ★ 누수: meta 입력은 빌라 공개정보(VillaPublicInfo)만 — 원가·마진·판매가 미포함(meta.ts 봉인).
import { NextResponse } from "next/server";
import {
  YtShortStatus,
  YtSourceType,
  YtEditJobStatus,
  VillaClipStatus,
  type Prisma,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { validateEditParams, EditValidationError, type EditParams } from "@/lib/youtube/edit";
import { generateShortMeta } from "@/lib/youtube/meta";
import {
  ClipSourceError,
  extractClipRefs,
  resolveSourceVilla,
  applyResolvedClipKeys,
} from "@/lib/youtube/villa-clip-source";
import type { VillaPublicInfo } from "@/lib/instagram/caption";

export const dynamic = "force-dynamic";

/** 빌라 공개정보 로드(누수 방지 화이트리스트 select) → VillaPublicInfo. 미존재 시 null. */
async function loadVillaPublicInfo(villaId: string): Promise<VillaPublicInfo | null> {
  const v = await prisma.villa.findUnique({
    where: { id: villaId },
    select: {
      // ★ 고유 실명(name/nameVi)은 조회하지 않는다 — 공개 표시명은 지역·특징으로 계산(원칙 1).
      complex: true,
      complexArea: { select: { nameKo: true } },
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
    complex: v.complex,
    areaNameKo: v.complexArea?.nameKo ?? null,
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

  // ── 빌라 자산(VillaClip) 소재 해석 (youtube-villa-clip-source) ──
  //   클라는 r2Key를 볼 수 없으므로 `clips[].villaClipId`로 보내고, 서버가 키로 바꾼다.
  //   ★ validateEditParams **앞**에서 돈다 — 그쪽은 key가 이미 채워져 있다고 가정한다.
  //   ★ 불변식: params에 실린 모든 `villa-clips/…` 키는 **APPROVED VillaClip 행으로 실재**해야 한다.
  //     (형식만 맞는 문자열을 직접 써넣는 우회를 막는 이중 게이트. 형식 검사는 edit.ts CLIP_KEY_RE)
  const requestedVillaId =
    typeof b.villaId === "string" && b.villaId.trim() ? b.villaId.trim() : null;
  let rawParams: unknown = b.params;
  let sourceVillaId: string | null = null;

  const refs = extractClipRefs(rawParams);
  if (refs.ids.length > 0 || refs.keys.length > 0) {
    const rows = await prisma.villaClip.findMany({
      where: {
        status: VillaClipStatus.APPROVED, // 검수 게이트(사업 원칙 3) — 미승인 영상은 소재가 될 수 없다
        OR: [{ id: { in: refs.ids } }, { r2Key: { in: refs.keys } }],
      },
      select: { id: true, r2Key: true, villaId: true },
    });
    try {
      const paramsVillaId =
        typeof (rawParams as { villaId?: unknown } | null)?.villaId === "string"
          ? ((rawParams as { villaId: string }).villaId.trim() || null)
          : null;
      sourceVillaId = resolveSourceVilla(rows, refs, paramsVillaId ?? requestedVillaId);
      rawParams = applyResolvedClipKeys(rawParams, rows);
    } catch (e) {
      if (e instanceof ClipSourceError) {
        return NextResponse.json({ error: e.code, message: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  let params: EditParams;
  try {
    params = validateEditParams(rawParams);
  } catch (e) {
    if (e instanceof EditValidationError) {
      return NextResponse.json({ error: "INVALID_PARAMS", code: e.code }, { status: 400 });
    }
    throw e;
  }

  // 소재가 빌라 자산이면 그 빌라가 곧 이 쇼츠의 빌라다(운영자가 따로 안 골라도 메타·나레이션이 붙는다).
  const villaId = params.villaId ?? requestedVillaId ?? sourceVillaId;

  // 메타(제목·설명·태그) 초안 — villaId 있으면 공개정보 기반 생성, 없으면 기본값/override.
  let title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 100) : "";
  let description = "";
  let tags: string[] = [];
  let flaggedTerms: string[] = [];
  let resolvedVillaName: string | null = null;

  if (villaId) {
    const info = await loadVillaPublicInfo(villaId);
    if (!info) return NextResponse.json({ error: "VILLA_NOT_FOUND" }, { status: 400 });
    // ★ 운영자 확인용 표시명 — 이 응답은 **운영자 화면**(create-short-wizard)에만 쓰이므로 실명 OK(내부).
    //   공개 생성기(generateShortMeta)에는 실명이 들어가지 않는다(info에 name 없음).
    const named = await prisma.villa.findUnique({ where: { id: villaId }, select: { name: true } });
    resolvedVillaName = named?.name ?? null;
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
      // 빌라 자산 재사용 건수 — "공급자 영상이 실제로 쓰였는지"를 감사 로그만으로 추적할 수 있어야 한다.
      villaClipCount: { new: refs.ids.length + refs.keys.length },
      villaId: { new: villaId },
    },
  });

  return NextResponse.json({ id: created.id, editJobStatus: "PENDING", villaName: resolvedVillaName });
}
