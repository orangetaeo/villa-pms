// lib/seo/place-article.ts — 푸꾸옥 장소(맛집·카페·쇼핑) 소개 글 (T-seo-place-article)
//
// 다른 글 종류와 결정적으로 다른 점 두 가지:
//  ① **고갈되지 않는다.** 빌라 글은 재고 수만큼, 서비스 글은 9종, 가이드 글은 8종이 끝이다.
//     장소 글만 테오가 다닐수록 늘어난다 — 그래서 회차(1편·2편·3편…)로 이어진다.
//  ② **사실 원천이 우리 DB가 아니다.** 남의 가게라 AI가 지어낼 여지가 가장 크다.
//     → **등록된 장소만 등장할 수 있고, 문장만 AI가 쓴다.** 이 모듈은 그 계약을 강제한다.
//
// ★ 영업시간·가격·휴무일·전화번호는 **필드 자체가 없다**(SeoPlace 참조). 수시로 바뀌는데 갱신 수단이
//   없어 쓰는 순간부터 틀린 글이 되기 때문이다. 사람이 책임질 문장은 oneLiner·tips로 들어온다.
// ★ 묶음 글(3곳 이상)인 이유: 카페 한 곳으로 800자를 채우면 지어낼 수밖에 없다.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { findBannedTerms } from "@/lib/instagram/caption";
import { copyGuidePromptBlock } from "@/lib/instagram/content-guide";
import { parseArticleBody } from "@/lib/seo/article";
import {
  extractJsonArray,
  interleaveImageGroups,
  type DraftResult,
  type PickedImage,
} from "@/lib/seo/article-draft";
import type { SeoArticleCategory } from "@/lib/seo/categories";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;

/** 한 편에 묶는 장소 수 — 최소 3곳이어야 글이 되고, 너무 많으면 각 장소가 얇아진다. */
export const MIN_PLACES_PER_ARTICLE = 3;
export const MAX_PLACES_PER_ARTICLE = 5;
/** 재료 하한(자) — 이름만 등록된 상태로는 쓰지 않는다. */
export const MIN_PLACE_FACT_CHARS = 120;

export interface PlaceCategory {
  key: string;
  /** 글 제목에 들어가는 말 */
  label: string;
  /** 집필 각도 */
  brief: string;
}

/** ★ 화이트리스트 — DB는 String이라 여기 없는 값은 글에 쓰이지 않는다(오타 방어). */
export const PLACE_CATEGORIES: PlaceCategory[] = [
  {
    key: "restaurant",
    label: "맛집",
    brief: "어떤 상황·일행에게 맞는 집인지, 무엇을 먹으러 가는 집인지, 빌라 일정 중 언제 넣으면 좋은지",
  },
  {
    key: "cafe",
    label: "카페",
    brief: "머무는 목적(더위 피하기·작업·아이 동반)에 따른 선택, 해변·시내 동선과의 관계",
  },
  {
    key: "shop",
    label: "쇼핑",
    brief: "무엇을 사러 가는 곳인지, 귀국 선물·현지 조달 관점, 빌라에서의 접근성",
  },
  {
    key: "market",
    label: "시장·야시장",
    brief: "언제 가는 게 좋은지, 무엇을 보러 가는지, 아이·어르신 동반 시 고려할 점",
  },
  { key: "bar", label: "바·펍", brief: "분위기와 시간대, 빌라로 돌아가는 동선, 일행 구성에 따른 선택" },
  { key: "spot", label: "가볼 만한 곳", brief: "무엇을 보러 가는 곳인지, 소요 시간과 일정 중 배치" },
];

export function placeCategory(key: string): PlaceCategory | undefined {
  return PLACE_CATEGORIES.find((c) => c.key === key);
}

/** topicKey 겸 slug — 회차가 이어진다(place-cafe-1, place-cafe-2 …). */
export function placeTopicKey(categoryKey: string, seq: number): string {
  return `place-${categoryKey}-${seq}`;
}

export const PLACE_SELECT = {
  id: true,
  name: true,
  nameLocal: true,
  category: true,
  area: true,
  oneLiner: true,
  tips: true,
  photos: {
    where: { active: true },
    select: { id: true, url: true, alt: true, caption: true, kind: true, watermarkedUrl: true },
    orderBy: { createdAt: "asc" as const },
    // 단독 글은 등록된 사진을 넉넉히 쓴다 — 맛집은 음식 갤러리처럼 보이는 편이 낫다(테오 지적 2026-07-24,
    // 사진 28장 올렸는데 8장만 나가 아쉬움). take는 사진 상한(MAX_PHOTOS_SINGLE_PLACE)보다 여유 있게.
    take: 24,
  },
} satisfies Prisma.SeoPlaceSelect;

export type PlaceRow = Prisma.SeoPlaceGetPayload<{ select: typeof PLACE_SELECT }>;

export interface PlaceCandidate {
  category: PlaceCategory;
  seq: number;
  places: PlaceRow[];
}

/** 재료 총량 — 이름·인상·팁·지역만 센다(지어내기 방지의 근거가 되는 사람 입력분). */
export function placeFactCharCount(places: PlaceRow[]): number {
  return places
    .map((p) => [p.name, p.nameLocal ?? "", p.area ?? "", p.oneLiner, p.tips ?? ""].join(""))
    .join("").length;
}

export function hasEnoughPlaceFacts(places: PlaceRow[]): boolean {
  if (places.length < MIN_PLACES_PER_ARTICLE) return false;
  if (places.some((p) => p.oneLiner.trim().length === 0)) return false; // 인상 없는 장소는 못 쓴다
  return placeFactCharCount(places) >= MIN_PLACE_FACT_CHARS;
}

/**
 * 글로 묶을 수 있는 카테고리를 고른다 — **아직 소개하지 않은** 활성 장소가 3곳 이상 모인 카테고리.
 * 장소가 없으면 빈 배열(장소 글 단계 통째로 no-op).
 */
export async function getPlaceCandidates(db: DbClient = prisma): Promise<PlaceCandidate[]> {
  const rows = await db.seoPlace.findMany({
    where: { active: true, usedInArticleId: null },
    select: PLACE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return [];

  const out: PlaceCandidate[] = [];
  for (const category of PLACE_CATEGORIES) {
    const places = rows.filter((r) => r.category === category.key).slice(0, MAX_PLACES_PER_ARTICLE);
    if (!hasEnoughPlaceFacts(places)) continue;
    // 회차 = 이 카테고리로 이미 만든 글 수 + 1 (상태 무관 — 반려분도 번호를 소비한다)
    const already = await db.seoArticle.count({ where: { topicKey: { startsWith: `place-${category.key}-` } } });
    out.push({ category, seq: already + 1, places });
  }
  return out;
}

/**
 * 제목 꼬리말 후보 — ★모든 글이 "직접 가보고 적는다"로 끝나면 상투구가 되어 오히려 자동 생성 티가 난다
 *   (테오 지적 2026-07-24: "계속 반복적으로 쓰면 그게 좋을까?"). 제목은 AI를 안 거치는 고정 문자열이라
 *   여기서 직접 다양화한다. 카테고리별로 동사를 바꿔 "직접 다녀온 사람"의 목소리를 살린다.
 */
const TITLE_SUFFIXES: Record<"eat" | "browse" | "visit", string[]> = {
  eat: [
    // 맛집·카페·바
    "직접 먹어보고 적는다",
    "가서 직접 먹어봤습니다",
    "다녀와서 남기는 솔직 후기",
    "직접 맛보고 적는 기록",
    "먹어보고 정리했습니다",
  ],
  browse: [
    // 쇼핑·시장
    "직접 둘러보고 적는다",
    "가서 직접 둘러봤습니다",
    "다녀와서 남기는 솔직 후기",
    "직접 발품 팔아 적는 기록",
    "둘러보고 정리했습니다",
  ],
  visit: [
    // 가볼 만한 곳
    "직접 가보고 적는다",
    "직접 다녀왔습니다",
    "다녀와서 남기는 솔직 후기",
    "가서 직접 보고 적는 기록",
    "다녀와서 정리했습니다",
  ],
};

function titleFlavor(categoryKey: string): keyof typeof TITLE_SUFFIXES {
  if (categoryKey === "shop" || categoryKey === "market") return "browse";
  if (categoryKey === "spot") return "visit";
  return "eat"; // restaurant·cafe·bar
}

/** 씨앗 문자열을 안정적인 정수로 — 같은 가게는 언제나 같은 꼬리말(재생성해도 제목이 흔들리지 않게). */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 단독 장소 글의 제목 꼬리말 — 카테고리 어투 안에서 가게 이름으로 결정적으로 하나 고른다. */
export function placeTitleSuffix(categoryKey: string, seed: string): string {
  const pool = TITLE_SUFFIXES[titleFlavor(categoryKey)];
  return pool[stableHash(seed) % pool.length];
}

/**
 * 제목 — 한 곳만 다루는 글은 **가게 이름이 제목에 와야 한다**(검색어가 곧 가게 이름이다).
 * "맛집 1곳"은 사람이 검색하지 않는 말이다.
 */
export function buildPlaceArticleTitle(c: PlaceCategory, places: PlaceRow[], seq: number): string {
  if (places.length === 1) {
    const p = places[0];
    const where = p.area ? `푸꾸옥 ${p.area}` : "푸꾸옥";
    return `${p.name} — ${where} ${c.label}, ${placeTitleSuffix(c.key, p.name)}`;
  }
  const suffix = seq > 1 ? ` (${seq}편)` : "";
  return `푸꾸옥 ${c.label} ${places.length}곳 — 직접 가본 곳만${suffix}`;
}

/**
 * 사진 역할 — ★순서가 아니라 **역할**로 골라야 본문과 맞물린다.
 *   실측(메오키친 2026-07-23): 등록 순서 앞 4장이 입구·입구2·주방·메뉴판이라
 *   **음식 사진이 한 장도 없는 맛집 글**이 나왔다. 사람이 올린 사진의 절반도 못 썼다.
 */
export const MEDIA_KINDS: { key: string; label: string }[] = [
  { key: "exterior", label: "외관·간판" },
  { key: "food", label: "음식" },
  { key: "interior", label: "내부" },
  { key: "menu", label: "메뉴판" },
  // ★ 맛집 외 장소(가볼 만한 곳·카페·바)용 — 스팟은 음식이 없어 이 종류로 나눈다(테오 지적 2026-07-24:
  //   썬셋 사나토가 수영장·노을로 나뉘는데 태그가 없어 한 갤러리로 묶였다). 운영자가 사진에 태그하면 분리된다.
  { key: "scenery", label: "풍경·전망" },
  { key: "facility", label: "수영장·시설" },
  { key: "etc", label: "기타" },
];

export function isMediaKind(v: unknown): v is string {
  return typeof v === "string" && MEDIA_KINDS.some((k) => k.key === v);
}

/**
 * 단독 장소 글이 쓰는 사진 최대 수 — 등록분을 넉넉히 쓰되 무한정 늘어나 스크롤 피로를 주지는 않게.
 * 맛집은 음식 사진이 많을수록 글이 풍성해 보인다(테오 지적 2026-07-24). 상한만 두고 그 안에서는 다 쓴다.
 */
export const MAX_PHOTOS_SINGLE_PLACE = 16;

/**
 * 단독 글의 사진 순서: **외관(커버) → 음식 몇 장 → 내부 1 → 메뉴판 1** 로 도입 흐름을 잡고,
 * 그다음 **남은 음식 전부 → 나머지 역할** 순서로 상한(max)까지 모두 채운다.
 *   ★ 예전엔 음식을 6장(4+2)만 넣고 끊어, 음식 사진이 24장이어도 6장만 나가 대부분 버려졌다
 *     (테오 지적 2026-07-24). 이제 상한 안에서는 남은 음식 사진도 이어붙인다.
 * kind가 미지정(null)인 사진은 등록 순서대로 뒤에 붙는다 — 역할을 안 정해도 동작은 한다.
 */
export function orderSinglePlacePhotos<T extends { kind: string | null }>(photos: T[], max = MAX_PHOTOS_SINGLE_PLACE): T[] {
  const by = (k: string) => photos.filter((p) => p.kind === k);
  const unset = photos.filter((p) => !isMediaKind(p.kind));
  const out: T[] = [];
  const push = (arr: T[], n: number) => {
    for (const x of arr.slice(0, n)) if (!out.includes(x) && out.length < max) out.push(x);
  };
  // ── 도입 흐름 ──
  push(by("exterior"), 1); // 커버 1장
  push(by("food"), 3); // 초반 음식 몇 장으로 본론 진입
  push(by("interior"), 1);
  push(by("menu"), 1);
  // ── 상한까지 나머지 전부(음식 우선) ──
  push(by("food"), max); // 남은 음식 사진 전부 — 맛집 글의 중심
  push(by("interior"), max);
  push(unset, max); // 역할 미지정분
  push(by("etc"), max);
  push(by("exterior"), max); // 남은 외관
  push(by("menu"), max);
  return out;
}

/**
 * 묶음 글에서 **장소당** 쓰는 사진 수 — 예전엔 1장이라 28장 올려도 1장만 나갔다(테오 지적 2026-07-24).
 * 장소당 몇 장씩 모아 그 가게 소제목 아래 작은 그리드로 보여준다. 한 가게가 글을 독차지하지 않게 상한만 둔다.
 */
export const PHOTOS_PER_PLACE_BUNDLE = 3;

/** 워터마크 파생본 캐시 갱신을 위해 사진 id·워터마크 URL을 함께 싣는 픽. */
export type PlacePickedImage = PickedImage & { mediaId: string; watermarkedUrl: string | null };

/**
 * 장소별로 사진을 골라 **그룹 배열**로 돌려준다(그룹 1개 = 한 장소).
 *   · 단독 글: 그 가게 사진을 역할 순서(orderSinglePlacePhotos)로 최대 maxForSingle장
 *   · 묶음 글: 장소마다 최대 PHOTOS_PER_PLACE_BUNDLE장 — 그 장소 소제목 아래 그리드로 묶인다
 * 중복 URL은 전역에서 한 번만(가게 A·B가 같은 사진을 올린 경우 한쪽만).
 * alt는 업로드 때 사람이 쓴 문장 그대로 — 사진 설명을 AI가 짓지 않는다.
 */
export function pickPlaceGroups(
  places: PlaceRow[],
  opts?: { single?: number; bundle?: number }
): PlacePickedImage[][] {
  const single = places.length === 1;
  const perSingle = opts?.single ?? MAX_PHOTOS_SINGLE_PLACE;
  const perBundle = opts?.bundle ?? PHOTOS_PER_PLACE_BUNDLE;
  const seen = new Set<string>();
  return places.map((p) => {
    const ordered = single ? orderSinglePlacePhotos(p.photos, perSingle) : p.photos.slice(0, perBundle);
    const out: PlacePickedImage[] = [];
    for (const photo of ordered) {
      if (seen.has(photo.url)) continue;
      seen.add(photo.url);
      out.push({
        url: photo.url,
        alt: photo.alt,
        caption: photo.caption ?? p.name,
        mediaId: photo.id,
        watermarkedUrl: photo.watermarkedUrl ?? null,
      });
    }
    return out;
  });
}

/** 그룹을 펼친 평면 목록(썸네일 개수·기존 호출부 호환용). */
export function pickPlacePhotos(places: PlaceRow[], maxForSingle = MAX_PHOTOS_SINGLE_PLACE): PickedImage[] {
  return pickPlaceGroups(places, { single: maxForSingle }).flat();
}

/**
 * 단독 장소 글의 갤러리 표시 순서 — 음식이 중심이라 맨 앞, 그다음 풍경·시설·내부·메뉴·외관.
 * (맛집은 food가 주, 스팟은 food가 없어 scenery/facility가 자연스럽게 앞선다.)
 */
export const SINGLE_PLACE_KIND_ORDER = ["food", "scenery", "facility", "interior", "menu", "exterior", "etc"] as const;

/** 한 종류가 예산을 독차지하지 않게 **각 종류에 먼저 보장**하는 최소 장수. */
export const KIND_RESERVE_MIN = 4;

/**
 * 단독 장소 글: 커버 1장(외관 우선) + 본문을 **종류별 갤러리**로 묶은 그룹들.
 *   ★ 종류가 섞여 흩어지던 문제(메뉴판 위 1장·아래 3장)를 종류별로 모아 해결한다
 *     (음식끼리·메뉴끼리·풍경끼리). 각 그룹은 본문에서 연속 배치되어 하나의 그리드가 된다.
 *   ★ **예약(2-pass):** 음식이 아무리 많아도 외관 간판·메뉴 같은 다른 종류가 묻히지 않게, 먼저 각 종류에
 *     최소 KIND_RESERVE_MIN장을 보장한 뒤 남은 예산을 종류 순서대로 채운다(테오 지적 2026-07-24:
 *     해피 레스토랑에 외관 간판이 있는데 음식만 나갔다).
 * 반환: cover(썸네일용, 본문에선 제외) + bodyGroups(각 그룹 = 한 종류, 표시 순서대로).
 */
export function pickSinglePlaceKindGroups(
  place: PlaceRow,
  max = MAX_PHOTOS_SINGLE_PLACE
): { cover: PlacePickedImage | null; bodyGroups: PlacePickedImage[][] } {
  type Photo = PlaceRow["photos"][number];
  const toPick = (photo: Photo): PlacePickedImage => ({
    url: photo.url,
    alt: photo.alt,
    caption: photo.caption ?? place.name,
    mediaId: photo.id,
    watermarkedUrl: photo.watermarkedUrl ?? null,
  });
  const all = place.photos;
  // 커버 = 외관 우선(가게 간판이 대표에 어울린다), 없으면 첫 장.
  const coverPhoto = all.find((p) => p.kind === "exterior") ?? all[0] ?? null;
  const cover = coverPhoto ? toPick(coverPhoto) : null;
  const used = new Set<string>();
  if (coverPhoto) used.add(coverPhoto.url);
  let budget = Math.max(0, max - (cover ? 1 : 0));

  const picked = new Map<string, PlacePickedImage[]>();
  // 특정 종류(또는 미지정)를 cap장까지 예산 안에서 담는다. picked에 누적.
  const takeKind = (kindKey: string, predicate: (p: Photo) => boolean, cap: number) => {
    const arr = picked.get(kindKey) ?? [];
    picked.set(kindKey, arr);
    for (const photo of all) {
      if (budget <= 0 || arr.length >= cap) break;
      if (used.has(photo.url) || !predicate(photo)) continue;
      used.add(photo.url);
      arr.push(toPick(photo));
      budget--;
    }
  };

  const kinds = [...SINGLE_PLACE_KIND_ORDER];
  // 1) 예약: 각 종류(+미지정)에 최소 보장 — 한 종류가 다 먹지 않게.
  for (const k of kinds) takeKind(k, (p) => p.kind === k, KIND_RESERVE_MIN);
  takeKind("__unset", (p) => !isMediaKind(p.kind), KIND_RESERVE_MIN);
  // 2) 채움: 남은 예산을 표시 순서대로 전부.
  for (const k of kinds) takeKind(k, (p) => p.kind === k, Number.MAX_SAFE_INTEGER);
  takeKind("__unset", (p) => !isMediaKind(p.kind), Number.MAX_SAFE_INTEGER);

  const bodyGroups: PlacePickedImage[][] = [];
  for (const k of [...kinds, "__unset"]) {
    const g = picked.get(k);
    if (g && g.length) bodyGroups.push(g);
  }
  return { cover, bodyGroups };
}

/**
 * 사진을 본문에 **고르게** 흩뿌린다 — 소제목 뒤에만 넣으면 소제목 수(3~4개)가 곧 사진 상한이 된다.
 *   문단 위치를 세어 균등 간격으로 배치하고, 남으면 끝에 이어 붙인다(사진이 잘리지 않게).
 */
export function spreadImages<B extends { type: string }>(blocks: B[], images: PickedImage[]): B[] {
  if (images.length === 0) return blocks;
  const slots: number[] = [];
  for (let i = 0; i < blocks.length; i++) if (blocks[i].type === "p") slots.push(i);
  if (slots.length === 0) return [...blocks, ...(images.map((im) => ({ type: "img", ...im })) as unknown as B[])];

  // 첫 문단(리드) 뒤부터 균등 간격
  const step = Math.max(1, Math.floor(slots.length / images.length));
  const chosen = new Map<number, PickedImage>();
  let si = 0;
  for (const img of images) {
    while (si < slots.length && chosen.has(slots[si])) si++;
    if (si >= slots.length) break;
    chosen.set(slots[si], img);
    si += step;
  }
  const placed = new Set(chosen.values());
  const out: B[] = [];
  for (let i = 0; i < blocks.length; i++) {
    out.push(blocks[i]);
    const img = chosen.get(i);
    if (img) out.push({ type: "img", url: img.url, alt: img.alt, ...(img.caption ? { caption: img.caption } : {}) } as unknown as B);
  }
  for (const img of images) {
    if (placed.has(img)) continue;
    out.push({ type: "img", url: img.url, alt: img.alt, ...(img.caption ? { caption: img.caption } : {}) } as unknown as B);
  }
  return out;
}

/**
 * 소제목 다듬기 — ★모델이 **프롬프트의 뼈대를 그대로 소제목에 베껴 쓰는** 문제를 결정적으로 막는다.
 *   실측: "① 어떤 곳인가요?" "② 무엇을 먹거나 보러 가나요?"처럼 지시문의 번호·물음표가 그대로 나왔다.
 *   프롬프트로 "쓰지 마라"고만 하면 지켜지지 않는다 — 값에서 지우는 쪽이 확실하다.
 * 문단(p)은 건드리지 않는다(분량 하한 판정에 영향을 주면 안 된다).
 */
export function tidyHeadings<T extends { type: string }>(blocks: T[]): T[] {
  return blocks.map((b) => {
    if (b.type !== "h2") return b;
    const h = b as unknown as { type: "h2"; text: string };
    const text = h.text
      .replace(/^[\s]*[①②③④⑤⑥⑦⑧⑨⑩]\s*/u, "") // 원문자 번호
      .replace(/^[\s]*\d+[).．.]\s*/u, "") // "1) " "2. "
      .replace(/\?$/u, "") // 물음표 소제목("~인가요?") → 명사구로
      .trim();
    return { ...b, text: text || h.text } as T;
  });
}

/**
 * 같은 문단 반복 제거 — ★모델이 리드 문단을 두 번 뱉는 일이 실제로 있었다(테오 실측 2026-07-23:
 * "푸꾸옥에서 빌라를 운영하며…" 문단이 연속 2회). 프롬프트로 막을 수 없는 종류라 값에서 지운다.
 * 소제목(h2)은 건드리지 않는다 — 같은 제목이 의도적으로 반복될 여지는 없지만, 본문 흐름을 바꾸지 않기 위함.
 */
export function dedupeParagraphs<B extends { type: string }>(blocks: B[]): B[] {
  const seen = new Set<string>();
  const out: B[] = [];
  for (const b of blocks) {
    if (b.type === "p") {
      const key = (b as unknown as { text: string }).text.replace(/\s+/g, " ").trim();
      if (key.length > 0) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
    }
    out.push(b);
  }
  return out;
}

/**
 * 썸네일 후킹 한 줄 — **운영자가 쓴 인상의 첫 문장**을 그대로 쓴다(AI가 새 문구를 만들지 않는다).
 * 길면 자르되 문장 중간이 아니라 어절 경계에서 자른다.
 */
export function buildThumbnailHook(oneLiner: string, max = 26): string | null {
  // 줄바꿈(10·13)·마침표·느낌표·물음표 중 가장 먼저 오는 경계까지가 첫 문장이다.
  const BREAKS = [String.fromCharCode(10), String.fromCharCode(13), ".", "!", "?"];
  let first = oneLiner.trim();
  for (const br of BREAKS) {
    const idx = first.indexOf(br);
    if (idx > 0) first = first.slice(0, idx).trim();
  }
  if (first.length === 0) return null;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return "" + (sp > max * 0.5 ? cut.slice(0, sp) : cut).trim() + "…";
}

/** 사용 처리 — 같은 가게가 다음 편에 다시 나오지 않게 한다. */
export async function markPlacesUsed(ids: string[], articleId: string, db: DbClient = prisma): Promise<void> {
  if (ids.length === 0) return;
  await db.seoPlace.updateMany({
    where: { id: { in: ids } },
    data: { usedInArticleId: articleId, usedAt: new Date() },
  });
}

/**
 * 초안 1편 생성 — cron(자동)과 운영자 버튼(수동)이 **같은 경로**를 쓴다.
 * ★ 수동 호출은 장소 1곳으로도 허용한다(운영자가 명시적으로 누른 것이고, 어차피 승인 게이트가 있다).
 *   자동 생성만 3곳 하한을 지킨다 — 사람이 안 보는 경로일수록 보수적이어야 한다.
 * 반환: 만든 글 / 못 만든 이유.
 */
export async function createPlaceArticleDraft(
  input: { category: PlaceCategory; places: PlaceRow[]; seq: number; createdBy: string },
  deps: {
    db?: DbClient;
    generate?: typeof generatePlaceArticleBody;
    /** 사진 URL → 워터마크 파생본 URL. 순환 참조를 피하려고 호출부가 주입한다. */
    watermark: (photo: PickedImage & { mediaId?: string }) => Promise<string>;
    /** 커버 사진 + 문구 → 썸네일 URL(실패 시 null) */
    renderThumbnail: (
      photoUrl: string,
      input: { title: string; hook: string | null; eyebrow: string | null }
    ) => Promise<string | null>;
    /** 블록 → 상세페이지 HTML */
    toHtml: (
      blocks: ReturnType<typeof parseArticleBody>,
      opts: { title: string; thumbnailUrl: string | null; summary: string }
    ) => string;
    /** 순환 참조를 피하려고 호출부가 넘긴다(article-draft의 공용 헬퍼들) */
    helpers: {
      isArticlePublishable: (blocks: ReturnType<typeof parseArticleBody>) => boolean;
      buildArticleSlug: (key: string) => string;
      buildSummary: (blocks: ReturnType<typeof parseArticleBody>) => string;
      interleaveImages: (
        blocks: ReturnType<typeof parseArticleBody>,
        images: PickedImage[]
      ) => ReturnType<typeof parseArticleBody>;
      brandFallbackImage: string;
    };
  }
): Promise<{ ok: true; id: string; slug: string; title: string; photos: number } | { ok: false; reason: string }> {
  const db = deps.db ?? prisma;
  const generate = deps.generate ?? generatePlaceArticleBody;
  const { category, places, seq, createdBy } = input;
  const key = placeTopicKey(category.key, seq);

  const draft = await generate(category, places);
  if (!draft) return { ok: false, reason: "생성 실패" };
  if (!deps.helpers.isArticlePublishable(draft.blocks)) return { ok: false, reason: "분량·구조 하한 미달" };

  // ★ 블로그에 나가는 이미지는 **워터마크 필수**(테오 지시 2026-07-23). 파생본이 없으면 여기서 굽는다.
  //   실패 시 원본 URL로 폴백 — 워터마크 때문에 글 생성을 멈추지 않는다.
  const wm = async (p: PlacePickedImage) => ({ ...p, url: await deps.watermark(p) });
  const dblocks = dedupeParagraphs(draft.blocks);
  let cover: PickedImage | null;
  let bodyGroups: PickedImage[][];
  let flatCount: number;

  if (places.length === 1) {
    // ★ 단독 글: 사진을 **종류별로 묶는다**(음식끼리·메뉴끼리·내부끼리) — 흩어지지 않게(테오 지적 2026-07-24).
    //   각 종류 그룹이 소제목 아래 연속 배치되어 하나의 그리드 갤러리가 된다. 커버(외관)는 본문에서 제외.
    const kind = pickSinglePlaceKindGroups(places[0]);
    cover = kind.cover ? await wm(kind.cover) : null;
    bodyGroups = await Promise.all(kind.bodyGroups.map((g) => Promise.all(g.map(wm))));
    flatCount = (cover ? 1 : 0) + bodyGroups.reduce((n, g) => n + g.length, 0);
  } else {
    // 묶음 글: 장소마다 그 가게 사진 묶음을 소제목 아래에 배치(사진-장소 짝 유지).
    const wmGroups = await Promise.all(pickPlaceGroups(places).map((g) => Promise.all(g.map(wm))));
    // ★ 첫 장은 **커버 전용**이다 — 본문에 또 넣으면 같은 사진이 두 번 나온다(테오 실측 2026-07-23).
    const firstIdx = wmGroups.findIndex((g) => g.length > 0);
    cover = firstIdx >= 0 ? wmGroups[firstIdx][0] : null;
    bodyGroups = wmGroups.map((g, i) => (i === firstIdx ? g.slice(1) : g));
    flatCount = wmGroups.reduce((n, g) => n + g.length, 0);
  }
  const body = interleaveImageGroups(dblocks, bodyGroups);
  const title = buildPlaceArticleTitle(category, places, seq);
  const summary = deps.helpers.buildSummary(draft.blocks);
  // 대표 썸네일 — 커버 사진(워터마크본) 위에 제목·후킹·브랜드를 얹는다. 실패하면 사진 URL로 폴백.
  const thumbnailUrl = cover
    ? await deps.renderThumbnail(cover.url, {
        title: places.length === 1 ? places[0].name : `푸꾸옥 ${category.label}`,
        hook: buildThumbnailHook(places[0].oneLiner),
        eyebrow: [places[0].area ? `푸꾸옥 ${places[0].area}` : "푸꾸옥", category.label].join(" · "),
      })
    : null;

  const row = await db.seoArticle.create({
    data: {
      thumbnailUrl,
      bodyHtml: deps.toHtml(body, { title, thumbnailUrl, summary }),
      slug: deps.helpers.buildArticleSlug(key),
      title,
      summary,
      bodyJson: body,
      topicKey: key,
      // 장소 글 대분류 — cron·운영자 수동 생성 모두 이 함수를 지나므로 여기 한 곳이면 충분하다.
      category: "place" satisfies SeoArticleCategory,
      coverPhotoUrl: thumbnailUrl ?? cover?.url ?? deps.helpers.brandFallbackImage,
      status: "PENDING_APPROVAL",
      flaggedTerms: draft.flaggedTerms.length > 0 ? draft.flaggedTerms : undefined,
      createdBy,
    },
    select: { id: true, slug: true, title: true },
  });
  // ★ 글 저장 성공 뒤에만 소비 처리 — 실패한 회차가 장소를 태우면 그 가게는 영영 못 나온다.
  await markPlacesUsed(
    places.map((p) => p.id),
    row.id,
    db
  );
  return { ok: true, ...row, photos: flatCount };
}

export function buildPlaceArticlePrompt(c: PlaceCategory, places: PlaceRow[]): string {
  // ★ 사진 설명(alt)은 사람이 쓴 사실이다 — 이걸 재료로 주지 않으면 모델이 메뉴를 지어낸다
  //   (실측: 사진에 반세오·반미·꼬치가 있는데 본문은 '라이스페이퍼'를 창작했다).
  const photoFacts = places.flatMap((p) =>
    p.photos
      .map((ph) => ph.alt.trim())
      .filter((a) => a.length > 0)
      .slice(0, 12)
  );

  const blocks = places.map((p, i) => {
    const lines = [`${i + 1}) ${p.name}${p.nameLocal ? ` (현지 표기: ${p.nameLocal})` : ""}`];
    if (p.area) lines.push(`   - 위치: ${p.area}`);
    lines.push(`   - 직접 가본 인상: ${p.oneLiner}`);
    if (p.tips) lines.push(`   - 메모: ${p.tips}`);
    return lines.join("\n");
  });

  // ★ 한 곳만 다루는 글은 구조가 다르다 — 장소당 소제목 1개로는 800자 하한을 채울 수 없고,
  //   억지로 채우게 하면 없는 사실을 지어낸다. 그래서 "사실은 그대로 두고 판단·활용을 나눠 쓰는" 틀을 준다.
  const single = places.length === 1;
  const howTo = single
    ? [
        "쓰는 방법(중요):",
        "- 이 한 곳만 다루는 글이다. 아래 네 갈래를 각각 하나의 소제목으로 다뤄라:",
        "  (가) 어떤 곳인지(위 인상을 풀어서) (나) 무엇을 먹거나 보러 가는지(위에 적힌 것만)",
        "  (다) 어떤 일행·상황에 맞고 안 맞는지(판단) (라) 빌라 일정과 어떻게 엮으면 좋은지",
        "- ★ 소제목은 **이 지시문을 베끼지 마라**. 번호(①·1.)·괄호기호·물음표를 쓰지 말고,",
        "  그 단락 내용을 요약한 짧은 명사구로 직접 지어라(예: '반세오와 할아버지 맥주', '어떤 일행에게 맞나').",
        "- ③④는 위 사실에서 **추론한 판단**이다. '어떤 일행에게 맞는지', '일정 중 언제 넣을지' 같은",
        "  여행자 관점의 판단만 쓴다. 판단을 쓴다는 이유로 **가게에 관한 새 사실을 만들면 안 된다**",
        "- 특히 다음은 전부 '사실'이라 지어내면 폐기된다:",
        "  · 위치 관계('야시장 근처', '해변에서 가깝다', '시내 중심') — 위에 적힌 동네 이름까지만 쓴다",
        "  · 가게 컨셉·역사('현지 음식을 현대적으로 재해석', '오래된 노포')",
        "  · 재료·조리 방식('신선한 재료', '직접 반죽')·좌석·분위기·인기 여부",
        "- 도입부에서 '직접 가본 곳'이라는 점을 담백하게 밝혀라",
      ]
    : [
        "쓰는 방법(중요):",
        "- 각 장소를 소제목 하나씩으로 다뤄라. 위에 적힌 인상·메모를 자연스러운 문장으로 풀어 쓴다",
        "- **위에 없는 사실을 추가하지 마라** — 메뉴 이름, 분위기, 좌석, 뷰, 역사, 인기 여부를 지어내지 않는다",
        "- 인상이 짧으면 짧은 대로 쓴다. 억지로 부풀리지 마라",
        "- 도입부에서 이 목록이 '직접 가본 곳'이라는 점을 담백하게 밝혀라",
        "- 마지막에 빌라에 묵는 일정과 어떻게 엮으면 좋은지 한 문단",
      ];

  return [
    copyGuidePromptBlock(),
    "너는 베트남 푸꾸옥에 살면서 빌라를 운영하는 사람의 글을 대신 정리하는 에디터다.",
    "운영자가 직접 다녀온 곳들을 한국인 여행객에게 소개하는 글을 쓴다. 본문만 쓴다.",
    "",
    `주제: 푸꾸옥 ${c.label} 소개`,
    `글의 각도: ${c.brief}`,
    "",
    single
      ? "다녀온 곳(이 가게 말고 다른 가게는 절대 언급하지 마라):"
      : "다녀온 곳(이 목록 밖의 가게는 절대 언급하지 마라):",
    ...blocks,
    photoFacts.length > 0 ? `
사진으로 확인되는 것(운영자가 직접 찍고 이름을 붙였다): ${photoFacts.join(", ")}` : "",
    photoFacts.length > 0
      ? "- 위 사진 목록에 있는 것은 **실제로 있는 것**이니 본문에서 자연스럽게 다뤄라. 목록에 없는 메뉴·시설은 만들지 마라"
      : "",
    "",
    ...howTo,
    "",
    "형식(반드시 지켜라):",
    "- JSON 배열만 출력한다. 코드펜스·설명 없이 배열 하나만",
    '- 각 원소는 {"type":"h2","text":"..."} 또는 {"type":"p","text":"..."} 또는 {"type":"ul","items":["..."]}',
    single ? "- 소제목(h2) 3~4개, 각 소제목 아래 문단 2개 이상" : "- 장소마다 소제목(h2) 1개 + 문단 2개 이상",
    "- 전체 본문 900~1500자(한국어). **900자 미만이면 실패로 폐기된다**",
    "- **이미지·영상 블록은 넣지 마라**(시스템이 알아서 배치한다)",
    "",
    "내용 규칙(어기면 폐기된다):",
    "- **영업시간·휴무일·가격·예산·전화번호를 쓰지 마라.** 바뀌는 정보라 쓰는 순간 틀린 글이 된다",
    "- 정확한 주소·좌표를 쓰지 마라(동네 이름까지만)",
    "- ★ 첫 블록부터 바로 본론이다. 인사·자기소개·예고 문장을 쓰지 마라",
    "  (금지 예: '안녕하세요', '소개해 드립니다', '이번에는 ~입니다', '~해 보세요')",
    "- 광고 문구체 금지('입안 가득 행복감', '망설임 없이 선택해 보세요', '놓칠 수 없는'). 담백한 서술체",
    "- 최상급·과장 표현은 **운영자가 직접 쓴 인상에 있을 때만** 그대로 인용하고, 네가 새로 만들지 마라",
    "- 확인되지 않은 통계·순위·수상 이력 금지",
    "- 다른 가게를 깎아내리지 마라",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 장소 글 본문 생성. 실패 시 null — 폴백 템플릿 없음(다른 글 종류와 동일 원칙). */
export async function generatePlaceArticleBody(
  c: PlaceCategory,
  places: PlaceRow[],
  fetchFn: typeof fetch = fetch
): Promise<DraftResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPlaceArticlePrompt(c, places) }] }],
          // responseMimeType:"application/json" — 큰 프롬프트(카피가이드 주입)에서 모델이 가이드를
          // 복창해 파싱 0블록이 되는 간헐 실패를 차단(JSON 디코딩 모드 강제). 실패 시 null 폴백은 유지.
          generationConfig: {
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = tidyHeadings(parseArticleBody(extractJsonArray(raw)));
    if (blocks.length === 0) return null;

    const flat = blocks
      .map((b) =>
        b.type === "ul" ? b.items.join(" ") : b.type === "img" ? (b.caption ?? "") : b.type === "video" ? b.title : b.text
      )
      .join(" ");
    return { blocks, flaggedTerms: findBannedTerms(flat) };
  } catch {
    return null;
  }
}
