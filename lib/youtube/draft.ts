// lib/youtube/draft.ts — 유튜브 쇼츠 자동 초안 오케스트레이션 (youtube-shorts-s1 콘텐츠 1)
//
// draft cron(instagram-draft)이 YT_SHORTS_PER_DAY≥1일 때만 호출한다(0이면 아예 호출 안 함 → 기존 동작 무변경).
// 흐름: 유튜브용 빌라 로테이션(YoutubeShort 이력 오래된 순) → 릴스 빌더(유튜브 CTA)로 MP4 → meta.ts로 제목·설명·태그
//   → YoutubeShort PENDING_APPROVAL(sourceType=VILLA_AUTO, 12:00·19:30 KST 슬롯 순환) → 같은 빌라 당일 InstagramPost 연결(가능 시).
//
// ★ 누수 0: 빌라 select는 공개 정보만(lib/instagram/draft 패턴 재사용). 메타 입력도 공개 정보만.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { planVillaDraft, nextSlotUtc, isRotationEligible, YT_DEAD_SHORT_STATUSES } from "@/lib/instagram/draft";
import { YT_SHORTS_PER_VILLA_DEFAULT } from "@/lib/youtube/settings";
import { renderAndBuildReel, YOUTUBE_REEL_CTA } from "@/lib/instagram/reels";
import { generateShortMeta } from "@/lib/youtube/meta";
import { writeAuditLog } from "@/lib/audit-log";
import { buildNarrationScript, normalizeScript, type NarrationVillaContext } from "@/lib/youtube/narration";
import { resolveClipPace } from "@/lib/youtube/pacing";
import { buildTourEditParams, canBuildTour, orderClipsForTour, usableTourClips, type ClipRow } from "@/lib/youtube/clip-draft";

const CREATED_BY = "cron:youtube-draft";
const KST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// ── 유튜브 슬롯(KST 12:00 / 19:30) → UTC ──
export const YT_SLOTS_KST = [
  { h: 12, m: 0 },
  { h: 19, m: 30 },
] as const;

/**
 * N개 쇼츠의 업로드 슬롯(UTC) — 12:00·19:30 KST를 순환하며, 하루 2개를 넘으면 다음 날로 넘어간다.
 * 각 슬롯의 "다음 도래"(오늘 지났으면 내일)를 기준으로 dayOffset을 더한다.
 */
export function computeYtSlotSchedule(now: Date, count: number): Date[] {
  const base = YT_SLOTS_KST.map((s) => nextSlotUtc(now, s.h, s.m)).sort((a, b) => a.getTime() - b.getTime());
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const slot = base[i % base.length];
    const dayOffset = Math.floor(i / base.length);
    out.push(new Date(slot.getTime() + dayOffset * DAY_MS));
  }
  return out;
}

/** 오늘(KST) 0시의 UTC 시점 — 일 업로드/당일 InstagramPost 판정 경계. */
export function startOfKstDayUtc(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dayStartKstMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0);
  return new Date(dayStartKstMs - KST_OFFSET_MS);
}

// ── 유튜브용 빌라 로테이션 ──
// VILLA_SELECT(instagram/draft)의 공개 필드 + youtubeShorts(로테이션 기준·빌라당 상한 카운트).
// planVillaDraft는 VillaDraftInput(공개 필드+사진)만 요구하므로 인스타 이력은 싣지 않는다.
const YT_VILLA_SELECT = {
  id: true,
  name: true,
  nameVi: true,
  complex: true,
  bedrooms: true,
  maxGuests: true,
  beachDistanceM: true,
  hasPool: true,
  breakfastAvailable: true,
  features: { select: { featureKey: true } },
  photos: {
    select: { id: true, url: true, space: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
  youtubeShorts: {
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  // 빌라당 상한 판정용 — 반려·업로드실패를 뺀 "살아있는" 쇼츠 수(sourceType 무관).
  _count: {
    select: { youtubeShorts: { where: { status: { notIn: [...YT_DEAD_SHORT_STATUSES] } } } },
  },
} satisfies Prisma.VillaSelect;

type YtVillaRow = Prisma.VillaGetPayload<{ select: typeof YT_VILLA_SELECT }>;

/**
 * 유튜브 쇼츠 후보 빌라 — ACTIVE + isSellable + 사진 4장↑ 중, 최근 YoutubeShort가 가장 오래된(또는 없는) 순 count곳.
 * 인스타 로테이션과 독립(유튜브 이력만 기준).
 * ★ 빌라당 상한(perVillaCap): 살아있는 쇼츠가 이미 상한만큼 있는 빌라는 제외 — 재고 적을 때 도배 방지.
 */
export async function selectVillasForYoutubeRotation(
  count: number,
  db: DbClient = prisma,
  perVillaCap: number = YT_SHORTS_PER_VILLA_DEFAULT
): Promise<YtVillaRow[]> {
  const villas = await db.villa.findMany({
    where: { status: "ACTIVE", isSellable: true },
    select: YT_VILLA_SELECT,
  });
  const eligible = villas.filter((v) => isRotationEligible(v.photos.length, v._count.youtubeShorts, perVillaCap));
  eligible.sort((a, b) => {
    const at = a.youtubeShorts[0]?.createdAt?.getTime() ?? 0;
    const bt = b.youtubeShorts[0]?.createdAt?.getTime() ?? 0;
    return at - bt;
  });
  return eligible.slice(0, count);
}

/**
 * 승인된 영상 클립으로 **투어 쇼츠 초안**을 만든다(영상 기반 자동화, 2026-07-23).
 *
 * 사진 슬라이드쇼와 다른 점: 여기서 렌더하지 않는다. `editJobStatus: PENDING`으로 넣어 두면
 * edit-jobs cron이 **렌더 전 검수 → 나레이션 → 완급**까지 수동 경로와 똑같이 처리한다.
 * 그래서 이번에 배운 것(변기 차단·쉼·어미·이동 컷 흡수)이 자동 생성물에도 그대로 적용된다.
 *
 * @returns 만든 쇼츠 id. 클립이 모자라면 null(호출부가 사진 슬라이드쇼로 폴백)
 */
async function createTourDraft(
  villa: YtVillaRow,
  clips: ClipRow[],
  scheduledAt: Date,
  instagramPostId: string | null,
  db: DbClient
): Promise<{ id: string; flagged: string[]; clipCount: number } | null> {
  if (!canBuildTour(clips)) return null;

  const ordered = orderClipsForTour(usableTourClips(clips)); // 긴 워크스루는 제외(컷 설계 필요)
  const meta = await generateShortMeta({
    name: villa.name,
    nameVi: villa.nameVi,
    complex: villa.complex,
    bedrooms: villa.bedrooms,
    maxGuests: villa.maxGuests,
    beachDistanceM: villa.beachDistanceM,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    featureKeys: villa.features.map((f) => f.featureKey),
  });

  // 나레이션 대본 — 실패해도 영상은 만든다(무음+배경음). 없는 것보다 낫다.
  let lines: Awaited<ReturnType<typeof buildNarrationScript>> | undefined;
  try {
    const ctx: NarrationVillaContext = {
      villaName: villa.name, // buildPrompt가 한글 읽기로 변환한다(toKoreanReading)
      complex: villa.complex,
      bedrooms: villa.bedrooms,
      hasPool: villa.hasPool,
      beachDistanceM: villa.beachDistanceM,
      clips: ordered.map((c) => ({ space: c.space, note: c.note })),
    };
    const draft = await buildNarrationScript(ctx);
    // ★ clipKinds를 반드시 넘긴다 — 안 넘기면 이동 컷이 자기 자막을 가져 화면과 말이 어긋난다.
    const clipKinds = ordered.map((c) => resolveClipPace(c.space, c.note).kind);
    lines = normalizeScript(
      draft.map((l) => ({
        text: l.text,
        parts: l.parts.map((p) => ({ cut: p.clipIndexes.length ? p.clipIndexes[0] + 1 : 0, text: p.text })),
      })),
      ordered.length,
      clipKinds
    );
  } catch (e) {
    console.error(`[youtube/draft] 빌라 ${villa.id} 나레이션 생성 실패(무음으로 진행):`, e instanceof Error ? e.message : String(e));
  }

  const editParams = buildTourEditParams(
    villa.id,
    { name: villa.name, bedrooms: villa.bedrooms, hasPool: villa.hasPool, beachDistanceM: villa.beachDistanceM },
    clips,
    lines
  );

  const short = await db.youtubeShort.create({
    data: {
      villaId: villa.id,
      instagramPostId,
      sourceType: "VILLA_AUTO",
      // 렌더 전이라 아직 승인 대기가 아니다 — cron이 렌더를 마치면 PENDING_APPROVAL로 올린다.
      status: "DRAFT",
      editJobStatus: "PENDING",
      scheduledAt,
      title: meta.title,
      description: meta.description,
      tags: meta.tags as unknown as Prisma.InputJsonValue,
      videoUrl: "", // 렌더 후 채워진다
      editParamsJson: editParams as unknown as Prisma.InputJsonValue,
      flaggedTerms: meta.flaggedTerms.length > 0 ? meta.flaggedTerms : undefined,
      createdBy: CREATED_BY,
    },
    select: { id: true },
  });

  await writeAuditLog({
    userId: null,
    action: "CREATE",
    entity: "YoutubeShort",
    entityId: short.id,
    changes: {
      villaId: { new: villa.id },
      source: { new: "villa-clips" },
      clipCount: { new: editParams.clips.length },
      narration: { new: lines ? lines.length : 0 },
      scheduledAt: { new: scheduledAt.toISOString() },
    },
    db,
  });

  return { id: short.id, flagged: meta.flaggedTerms, clipCount: editParams.clips.length };
}

export interface YtDraftBatchResult {
  created: { id: string; villaId: string; flagged: string[] }[];
  failures: { villaId: string; reason: string }[];
}

/**
 * 유튜브 쇼츠 자동 초안 배치 — perDay건 생성. draft cron이 YT_SHORTS_PER_DAY≥1일 때만 호출.
 * 각 빌라 실패는 격리(다른 빌라·인스타 흐름 무영향). 스키마 강제(title≤100·durationSec≤60)는 meta/reels가 보장.
 */
export async function runYoutubeDraftBatch(
  perDay: number,
  now: Date = new Date(),
  db: DbClient = prisma,
  perVillaCap: number = YT_SHORTS_PER_VILLA_DEFAULT
): Promise<YtDraftBatchResult> {
  const created: YtDraftBatchResult["created"] = [];
  const failures: YtDraftBatchResult["failures"] = [];
  if (perDay <= 0) return { created, failures };

  const villas = await selectVillasForYoutubeRotation(perDay, db, perVillaCap);
  if (villas.length === 0) return { created, failures };

  const slots = computeYtSlotSchedule(now, villas.length);
  const dayStart = startOfKstDayUtc(now);

  for (let i = 0; i < villas.length; i++) {
    const villa = villas[i];
    const scheduledAt = slots[i];
    try {
      // 같은 빌라의 당일 InstagramPost 연결(가능 시) — 2플랫폼 크로스포스팅 추적.
      const igPostEarly = await db.instagramPost.findFirst({
        where: { villaId: villa.id, scheduledAt: { gte: dayStart } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      // ★ 영상 기반 우선: 승인된 클립이 충분하면 투어 쇼츠를 만든다(검수·나레이션·완급 전부 적용).
      //   클립이 모자라면 기존 사진 슬라이드쇼로 폴백한다 — 재고가 없다고 자동 생성이 멈추면 안 된다.
      const approvedClips = await db.villaClip.findMany({
        where: { villaId: villa.id, status: "APPROVED" },
        select: { id: true, r2Key: true, space: true, note: true, durationSec: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      const tour = await createTourDraft(villa, approvedClips, scheduledAt, igPostEarly?.id ?? null, db);
      if (tour) {
        console.log(`[youtube/draft] 빌라 ${villa.id} 투어 쇼츠 초안(클립 ${tour.clipCount}개) — 렌더는 edit-jobs cron`);
        created.push({ id: tour.id, villaId: villa.id, flagged: tour.flagged });
        continue;
      }

      const plan = planVillaDraft(villa);
      const meta = await generateShortMeta(plan.publicInfo);

      const baseName = `yt-${villa.id}-${scheduledAt.toISOString().slice(0, 10)}-${i}`;
      // 릴스 빌더에 유튜브 CTA 주입 — 엔딩 카드만 "카카오톡 채널 '빌라고' 검색"으로 교체.
      //   오디오=번들 실음원(CC0 밝은 우쿨렐레, assets/audio/reel-bgm.mp3). 파일 없으면 무음 폴백.
      //   중간 프레임 캡션은 슬라이드(reelCaption, 사진-공간 매칭)에 실려 자동 렌더된다.
      const reel = await renderAndBuildReel(plan.slides, baseName, {
        audio: "bundled",
        ctaOverride: YOUTUBE_REEL_CTA,
      });

      const igPost = igPostEarly;

      const short = await db.youtubeShort.create({
        data: {
          villaId: villa.id,
          instagramPostId: igPost?.id ?? null,
          sourceType: "VILLA_AUTO",
          status: "PENDING_APPROVAL",
          scheduledAt,
          title: meta.title,
          description: meta.description,
          tags: meta.tags as unknown as Prisma.InputJsonValue,
          videoUrl: reel.videoUrl,
          posterUrl: reel.posterUrl,
          durationSec: Math.round(reel.durationSec),
          flaggedTerms: meta.flaggedTerms.length > 0 ? meta.flaggedTerms : undefined,
          createdBy: CREATED_BY,
        },
        select: { id: true },
      });

      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "YoutubeShort",
        entityId: short.id,
        changes: {
          villaId: { new: villa.id },
          instagramPostId: { new: igPost?.id ?? null },
          scheduledAt: { new: scheduledAt.toISOString() },
          durationSec: { new: Math.round(reel.durationSec) },
          usedGemini: { new: meta.usedGemini },
          flaggedTerms: { new: meta.flaggedTerms },
        },
        db,
      });

      created.push({ id: short.id, villaId: villa.id, flagged: meta.flaggedTerms });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[youtube/draft] 빌라 ${villa.id} 쇼츠 초안 실패:`, reason);
      failures.push({ villaId: villa.id, reason });
    }
  }

  return { created, failures };
}
