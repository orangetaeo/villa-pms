// lib/instagram/draft.ts — 콘텐츠 초안 생성 오케스트레이션 (draft cron이 사용)
//
// 빌라 로테이션 선정 → 공간 다양성 사진 선별 → 슬라이드 구성 → 캡션 생성 → InstagramPost(PENDING_APPROVAL).
// ★ 누수: 빌라 조회 select는 공개 정보만(원가·마진·판매가·supplier 미포함). PhotoSpace 다양성으로 4~7장.
import { IgPostStatus, PhotoSpace, Prisma, YtShortStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { IG_POSTS_PER_VILLA_DEFAULT } from "@/lib/instagram/settings";
import { generateCaption, pickHeadline, captionForPhotoSpace, type VillaPublicInfo } from "@/lib/instagram/caption";
import type { SlideInput } from "@/lib/instagram/render";
import type { CoverData, InfoData, CtaData } from "@/lib/instagram/templates";

// ── 슬롯(KST 07:30/12:30/20:00) → UTC 저장 ──
const KST_OFFSET_MS = 9 * 3600 * 1000;
export const IG_SLOTS_KST = [
  { h: 7, m: 30 },
  { h: 12, m: 30 },
  { h: 20, m: 0 },
] as const;

/** 지정 KST 시각의 "다음 도래" UTC 시점. 오늘 슬롯이 이미 지났으면 익일. */
export function nextSlotUtc(now: Date, h: number, m: number): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const targetKstMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), h, m, 0);
  let utcMs = targetKstMs - KST_OFFSET_MS;
  if (utcMs <= now.getTime()) utcMs += 24 * 3600 * 1000;
  return new Date(utcMs);
}

/** 3개 슬롯의 다음 도래 UTC 시점(순서 유지). */
export function computeSlotSchedule(now: Date = new Date()): Date[] {
  return IG_SLOTS_KST.map((s) => nextSlotUtc(now, s.h, s.m));
}

/** 저녁 슬롯(20:00 KST)의 IG_SLOTS_KST 인덱스 — 릴스는 저녁 슬롯에만 배치. */
export const IG_EVENING_SLOT_INDEX = IG_SLOTS_KST.findIndex((s) => s.h === 20);

// ── 릴스 스케줄 게이트 (AppSetting IG_REELS_PER_WEEK, 기본 0=끔) ──
/** 주당 릴스 생성 횟수 설정 키. 0/미설정이면 릴스 완전 비활성(기존 캐러셀 동작 동일). */
export const IG_REELS_PER_WEEK_KEY = "IG_REELS_PER_WEEK";

/** 주당 릴스 횟수(0~7). 미설정·비정상·≤0이면 0(끔). */
export async function getReelsPerWeek(db: DbClient = prisma): Promise<number> {
  try {
    const row = await db.appSetting.findUnique({ where: { key: IG_REELS_PER_WEEK_KEY }, select: { value: true } });
    const n = parseInt((row?.value ?? "").trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(7, n);
  } catch {
    return 0;
  }
}

/**
 * 오늘(KST 요일)이 릴스 생성일인지 — perWeek회를 한 주(0~6)에 결정적으로 균등 분배.
 * perWeek=0 → 항상 false, perWeek≥7 → 항상 true. 그 사이는 정확히 perWeek일만 true.
 */
export function isReelDayKst(now: Date, perWeek: number): boolean {
  if (perWeek <= 0) return false;
  if (perWeek >= 7) return true;
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dow = kst.getUTCDay(); // KST 기준 요일(0=일)
  return Math.floor(((dow + 1) * perWeek) / 7) > Math.floor((dow * perWeek) / 7);
}

// ── 빌라 로테이션 선정 ──
/** 로테이션 최소 사진 장수 — 캐러셀 4장을 못 채우면 후보에서 제외. */
export const MIN_ROTATION_PHOTOS = 4;

/**
 * 상한 계산에서 제외할 상태 — 반려(CANCELLED)·발행실패(FAILED)는 "살아있는 콘텐츠"가 아니므로 슬롯을 도로 비워준다.
 * ★ notIn(부정 목록)을 쓰는 이유: 나중에 상태가 추가되면 **상한에 포함**되는 쪽(보수적=덜 만드는 쪽)으로 기울게 하기 위함.
 */
export const IG_DEAD_POST_STATUSES = [IgPostStatus.CANCELLED, IgPostStatus.FAILED] as const;
export const YT_DEAD_SHORT_STATUSES = [YtShortStatus.CANCELLED, YtShortStatus.FAILED] as const;

/**
 * 로테이션 적격 판정(순수함수) — 사진이 충분하고, 살아있는 콘텐츠 수가 빌라당 상한 미만일 때만 후보.
 * 빌라 재고가 적을 때 같은 빌라 도배를 막는 게이트(per-villa-content-cap).
 * @param perVillaCap 0이면 어떤 빌라도 후보가 되지 않는다(자동 생성 완전 중단).
 */
export function isRotationEligible(photoCount: number, liveContentCount: number, perVillaCap: number): boolean {
  if (photoCount < MIN_ROTATION_PHOTOS) return false;
  if (perVillaCap <= 0) return false;
  return liveContentCount < perVillaCap;
}

const VILLA_SELECT = {
  id: true,
  // name·nameVi는 **내부용**(로깅·운영자 식별)으로만 남긴다 — 공개 생성기에는 넘기지 않는다(원칙 1).
  name: true,
  nameVi: true,
  complex: true,
  complexArea: { select: { nameKo: true } },
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
  // 빌라당 상한 판정용 — 반려·발행실패를 뺀 "살아있는" 콘텐츠 수.
  _count: {
    select: { instagramPosts: { where: { status: { notIn: [...IG_DEAD_POST_STATUSES] } } } },
  },
} satisfies Prisma.VillaSelect;

type VillaRow = Prisma.VillaGetPayload<{ select: typeof VILLA_SELECT }>;
/**
 * planVillaDraft가 실제로 쓰는 필드만(공개 정보 + 사진). 로테이션 이력·상한 카운트는 불필요.
 * ★ 유튜브 로테이션(lib/youtube/draft.ts)도 이 타입으로 재사용하므로 인스타 전용 필드를 넣지 말 것.
 */
export type VillaDraftInput = Omit<VillaRow, "instagramPosts" | "_count">;
export type VillaPhotoRow = { id: string; url: string; space: PhotoSpace; sortOrder: number };

/**
 * 포스팅 후보 빌라 선정 — ACTIVE + isSellable + 사진 4장↑ 중, 최근 인스타 포스트가 가장 오래된(또는 없는) 순 count곳.
 * ★ 판매가능(isSellable) 게이트: 검수 통과 빌라만 노출(재고 비공개 원칙엔 개별 쇼케이스라 무해).
 * ★ 빌라당 상한(perVillaCap): 이미 상한만큼 콘텐츠가 있는 빌라는 제외 — 재고 적을 때 도배 방지.
 */
export async function selectVillasForRotation(
  count: number,
  db: DbClient = prisma,
  perVillaCap: number = IG_POSTS_PER_VILLA_DEFAULT
): Promise<VillaRow[]> {
  const villas = await db.villa.findMany({
    where: { status: "ACTIVE", isSellable: true },
    select: VILLA_SELECT,
  });
  const eligible = villas.filter((v) => isRotationEligible(v.photos.length, v._count.instagramPosts, perVillaCap));
  // 최근 포스트 없음(=한 번도 안 함)이 최우선, 그 다음 가장 오래된 포스트 순.
  eligible.sort((a, b) => {
    const at = a.instagramPosts[0]?.createdAt?.getTime() ?? 0;
    const bt = b.instagramPosts[0]?.createdAt?.getTime() ?? 0;
    return at - bt;
  });
  return eligible.slice(0, count);
}

// ── 공간 다양성 사진 선별 ──
const SPACE_PRIORITY: PhotoSpace[] = [
  PhotoSpace.EXTERIOR,
  PhotoSpace.POOL,
  PhotoSpace.LIVING,
  PhotoSpace.BEDROOM,
  PhotoSpace.KITCHEN,
  PhotoSpace.BATHROOM,
  PhotoSpace.BALCONY,
  PhotoSpace.ETC,
];

/**
 * 공간 다양성 우선 사진 선별(외관→수영장→거실→침실…).
 * ★공간당 1장 우선(breadth-first): 한 라운드에 각 공간에서 최대 1장씩만 뽑는다. 그렇게 모은 장수가
 *   minCount 이상이면 거기서 멈춰 **같은 공간 사진이 여러 장 들어가는 것(예: 비슷한 침실 3장)을 방지**한다.
 *   minCount에 못 미칠 때만 다음 라운드로 2번째 사진을 추가해 최소 장수를 채운다.
 *   (실측 2026-07-21: 침실 4장 빌라가 캐러셀에 침실 3장 들어가 "동일 침대 사진 중복"으로 보인 문제 수정.)
 * @returns minCount~max 장(공간 다양성 우선). 사진이 부족하면 있는 만큼.
 */
export function selectDiversePhotos(photos: VillaPhotoRow[], max = 7, minCount = 4): VillaPhotoRow[] {
  const bySpace = new Map<PhotoSpace, VillaPhotoRow[]>();
  for (const p of photos) {
    const arr = bySpace.get(p.space) ?? [];
    arr.push(p);
    bySpace.set(p.space, arr);
  }
  const out: VillaPhotoRow[] = [];
  let round = 0;
  while (out.length < max) {
    // 첫 라운드(공간당 1장) 완료 후, 이미 최소 장수를 채웠으면 멈춘다(공간 편중 방지).
    if (round >= 1 && out.length >= minCount) break;
    let progressed = false;
    for (const space of SPACE_PRIORITY) {
      const arr = bySpace.get(space);
      if (arr && arr.length > 0) {
        out.push(arr.shift()!);
        progressed = true;
        if (out.length >= max) break;
      }
    }
    if (!progressed) break; // 남은 사진 없음
    round += 1;
  }
  return out;
}

// ── 슬라이드 구성 ──
function toPublicInfo(v: VillaDraftInput): VillaPublicInfo {
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

function infoFacts(v: VillaDraftInput): string[] {
  const facts = [`침실 ${v.bedrooms}`, `최대 ${v.maxGuests}인`];
  if (v.beachDistanceM != null) facts.push(`해변 ${v.beachDistanceM}m`);
  else if (v.hasPool) facts.push("전용 수영장");
  return facts;
}

const CTA_DATA: CtaData = {
  headline: "예약 · 견적 문의는\n프로필 링크 →\n카카오톡 상담",
  // brandName·handle·kakaoLabel·helper는 템플릿 기본값(VILLA GO / @villago.phuquoc / 카카오톡으로 상담하기)을 사용.
};

/** 빌라+선별 사진+헤드라인 → 캐러셀 슬라이드(cover, info, raw…, cta). */
export function buildSlides(v: VillaDraftInput, photos: VillaPhotoRow[], headline: string): SlideInput[] {
  const slides: SlideInput[] = [];
  const cover: CoverData = { headline };
  const info: InfoData = {
    // ★ 고유 실명 미사용 — 단지명 또는 지역만 노출(원칙 1).
    villaName: `${v.complex ?? "푸꾸옥"} · 프라이빗 풀빌라`,
    facts: infoFacts(v),
    // ★ 시작가(priceValue)는 미주입 — 마진 비공개 원칙상 안전한 공개 시작가가 없어 가격 뱃지 숨김.
    priceValue: null,
  };
  // 릴스 중간 프레임 캡션은 각 사진의 공간(space)에 매칭 — 사진 내용과 문구 정합(이질감 방지). 캐러셀은 무시.
  const pub = toPublicInfo(v);

  slides.push({ templateId: "cover", srcPhotoId: photos[0].id, srcPhotoUrl: photos[0].url, data: cover });
  if (photos[1]) {
    slides.push({
      templateId: "info",
      srcPhotoId: photos[1].id,
      srcPhotoUrl: photos[1].url,
      data: info,
      reelCaption: captionForPhotoSpace(photos[1].space, pub),
    });
  }
  for (let i = 2; i < photos.length; i++) {
    slides.push({
      templateId: "raw",
      srcPhotoId: photos[i].id,
      srcPhotoUrl: photos[i].url,
      reelCaption: captionForPhotoSpace(photos[i].space, pub),
    });
  }
  slides.push({ templateId: "cta", data: CTA_DATA });
  return slides;
}

export interface VillaDraftPlan {
  villaId: string;
  publicInfo: VillaPublicInfo;
  slides: SlideInput[];
  headline: string;
}

/** 빌라 1곳의 초안 계획(슬라이드 + 헤드라인) 구성 — 렌더 전 단계. */
export function planVillaDraft(v: VillaDraftInput): VillaDraftPlan {
  const publicInfo = toPublicInfo(v);
  const photos = selectDiversePhotos(v.photos as VillaPhotoRow[], 7);
  // generateCaption 안에서 헤드라인을 뽑지만, cover 슬라이드에도 같은 톤이 필요하므로 여기서 한 번 더 뽑아 주입.
  // (헤드라인 자체는 무작위 로테이션 — cover와 캡션 헤드라인이 달라도 무방하나 여기선 cover용을 별도 확정.)
  const headline = pickHeadline(publicInfo);
  const slides = buildSlides(v, photos, headline);
  return { villaId: v.id, publicInfo, slides, headline };
}

export { generateCaption };
