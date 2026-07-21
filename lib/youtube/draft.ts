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
import { planVillaDraft, nextSlotUtc } from "@/lib/instagram/draft";
import { renderAndBuildReel, YOUTUBE_REEL_CTA } from "@/lib/instagram/reels";
import { reelMiddleCaptions } from "@/lib/instagram/caption";
import { generateShortMeta } from "@/lib/youtube/meta";
import { writeAuditLog } from "@/lib/audit-log";

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
// VILLA_SELECT(instagram/draft)와 동일 공개 필드 + instagramPosts(planVillaDraft 타입 충족) + youtubeShorts(로테이션 기준).
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
  instagramPosts: {
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  youtubeShorts: {
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.VillaSelect;

type YtVillaRow = Prisma.VillaGetPayload<{ select: typeof YT_VILLA_SELECT }>;

/**
 * 유튜브 쇼츠 후보 빌라 — ACTIVE + isSellable + 사진 4장↑ 중, 최근 YoutubeShort가 가장 오래된(또는 없는) 순 count곳.
 * 인스타 로테이션과 독립(유튜브 이력만 기준).
 */
export async function selectVillasForYoutubeRotation(count: number, db: DbClient = prisma): Promise<YtVillaRow[]> {
  const villas = await db.villa.findMany({
    where: { status: "ACTIVE", isSellable: true },
    select: YT_VILLA_SELECT,
  });
  const eligible = villas.filter((v) => v.photos.length >= 4);
  eligible.sort((a, b) => {
    const at = a.youtubeShorts[0]?.createdAt?.getTime() ?? 0;
    const bt = b.youtubeShorts[0]?.createdAt?.getTime() ?? 0;
    return at - bt;
  });
  return eligible.slice(0, count);
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
  db: DbClient = prisma
): Promise<YtDraftBatchResult> {
  const created: YtDraftBatchResult["created"] = [];
  const failures: YtDraftBatchResult["failures"] = [];
  if (perDay <= 0) return { created, failures };

  const villas = await selectVillasForYoutubeRotation(perDay, db);
  if (villas.length === 0) return { created, failures };

  const slots = computeYtSlotSchedule(now, villas.length);
  const dayStart = startOfKstDayUtc(now);

  for (let i = 0; i < villas.length; i++) {
    const villa = villas[i];
    const scheduledAt = slots[i];
    try {
      const plan = planVillaDraft(villa);
      const meta = await generateShortMeta(plan.publicInfo);

      const baseName = `yt-${villa.id}-${scheduledAt.toISOString().slice(0, 10)}-${i}`;
      // 릴스 빌더에 유튜브 CTA 주입 — 엔딩 카드만 "카카오톡 채널 '빌라고' 검색"으로 교체.
      //   저작권 프리 라운지 배경음 + 중간 프레임 셀링포인트 캡션(공개정보)으로 몰입감 강화.
      const reel = await renderAndBuildReel(plan.slides, baseName, {
        audio: "lounge",
        ctaOverride: YOUTUBE_REEL_CTA,
        middleCaptions: reelMiddleCaptions(plan.publicInfo),
      });

      // 같은 빌라의 당일 InstagramPost 연결(가능 시) — 2플랫폼 크로스포스팅 추적.
      const igPost = await db.instagramPost.findFirst({
        where: { villaId: villa.id, scheduledAt: { gte: dayStart } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

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
