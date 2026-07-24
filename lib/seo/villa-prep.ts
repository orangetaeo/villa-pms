// lib/seo/villa-prep.ts — 빌라 공개 준비 (T-seo-s2 앞부분)
//
// 빌라가 공개 페이지에 나가려면 3가지가 필요한데, 지금은 셋 다 비어 있다:
//   ① publicSlug — 발급 로직만 있고 아무도 호출하지 않았다
//   ② description — 실빌라 2건 모두 0자. 사진만 있고 글이 없는 페이지 = 얇은 콘텐츠
//   ③ publicListed — 기본 false, 켜는 경로가 없었다
// 이 모듈이 ①②를 만들고, ③은 운영자 판단(또는 AppSetting 자동 전환)으로 남긴다.
//
// ★ 공개 경계(T-seo-s1 §4.1) 승계: 소개문 생성 입력에 가격·원가·공실·주소·공급자 정보를 넣지 않는다.
// ★ description을 **덮어쓰지 않는다** — 사람이 쓴 글이 있으면 그대로 둔다. 빈 값일 때만 채운다.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { findBannedTerms } from "@/lib/instagram/caption";
import { buildPublicSlug, MIN_PUBLIC_PHOTOS, MIN_PUBLIC_BODY_CHARS } from "@/lib/seo/public-villa";
import { publicVillaLabel } from "@/lib/marketing/public-name";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;

// ── 슬러그 발급 ─────────────────────────────────────────────────────────────
/**
 * 충돌 없는 publicSlug를 만든다. 같은 이름의 빌라가 여러 개일 수 있으므로(단지 내 동일 타입)
 * 이미 쓰는 슬러그면 -2, -3… 접미를 붙인다. 발급 후에는 **불변**(URL = SEO 자산).
 */
export async function ensureUniquePublicSlug(
  input: { id: string; complex?: string | null; bedrooms?: number | null },
  db: DbClient = prisma
): Promise<string> {
  const base = buildPublicSlug(input);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.villa.findFirst({
      where: { publicSlug: candidate, NOT: { id: input.id } },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  // 극단적 충돌 — id 기반 폴백(항상 유일)
  return `villa-${input.id.slice(0, 12)}`;
}

// ── 소개문 생성 ─────────────────────────────────────────────────────────────
/**
 * 소개문 생성 입력 — 공개 가능한 사실만. 이 타입 밖의 정보는 프롬프트에 들어가지 않는다.
 * ★ 고유 빌라 실명(name/nameVi)은 없다(원칙 1) — 생성된 소개문은 공개 description으로 렌더되므로
 *   실명이 들어가면 검색 우회·직거래로 이어진다. 프롬프트 표시명은 publicVillaLabel로 계산한다.
 */
export interface VillaDescriptionFacts {
  complex: string | null;
  areaNameKo: string | null;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  areaSqm: number | null;
  floors: number | null;
  hasPool: boolean;
  breakfastAvailable: boolean;
  beachDistanceM: number | null;
  parkingSlots: number;
  petsAllowed: boolean;
  smokingAllowed: boolean;
  partyAllowed: boolean;
  extraBedAvailable: boolean;
  featureKeys: string[];
  /** 사진 공간 분포 — "침실 4·수영장·거실" 같은 실제 구성 근거 */
  photoSpaces: string[];
}

const FEATURE_KO: Record<string, string> = {
  viewSea: "바다뷰",
  viewMountain: "마운틴뷰",
  viewCity: "시티뷰",
  bbq: "BBQ 시설",
  elevator: "엘리베이터",
  generator: "발전기(정전 대비)",
  kidsPool: "키즈풀",
  privatePool: "프라이빗 풀",
  gym: "헬스장",
  golfNearby: "골프장 인근",
  beachFront: "해변 바로앞",
  marketNearby: "시장 인근",
};

export function buildVillaDescriptionPrompt(f: VillaDescriptionFacts): string {
  const where = f.areaNameKo ?? f.complex ?? "푸꾸옥";
  const facts: string[] = [
    `위치: ${where} 단지`,
    `구성: 침실 ${f.bedrooms}개 · 욕실 ${f.bathrooms}개 · 최대 ${f.maxGuests}인`,
  ];
  if (f.areaSqm) facts.push(`전용면적 약 ${f.areaSqm}㎡`);
  if (f.floors) facts.push(`${f.floors}층 구조`);
  if (f.hasPool) facts.push("전용 수영장 있음");
  if (f.breakfastAvailable) facts.push("조식 제공 가능");
  if (f.beachDistanceM != null) facts.push(`해변까지 약 ${f.beachDistanceM}m`);
  if (f.parkingSlots > 0) facts.push(`주차 ${f.parkingSlots}대`);
  if (f.extraBedAvailable) facts.push("엑스트라베드 가능");
  facts.push(`반려동물 ${f.petsAllowed ? "동반 가능" : "동반 불가"}`);
  facts.push(`흡연 ${f.smokingAllowed ? "가능" : "불가"}`);
  facts.push(`파티 ${f.partyAllowed ? "가능" : "불가"}`);
  const feats = f.featureKeys.map((k) => FEATURE_KO[k]).filter(Boolean);
  if (feats.length) facts.push(`특징: ${feats.join(", ")}`);
  if (f.photoSpaces.length) facts.push(`사진으로 확인 가능한 공간: ${f.photoSpaces.join(", ")}`);

  return [
    "너는 베트남 푸꾸옥 현지에서 빌라를 운영하는 회사의 콘텐츠 에디터다.",
    "아래 사실만 가지고 한국인 여행객이 읽을 빌라 소개문을 쓴다.",
    "",
    // ★ 고유 실명 대신 지역·특징 표시명만 준다 — 소개문은 공개 description으로 나간다(원칙 1).
    `빌라: ${publicVillaLabel({ complex: f.complex, areaNameKo: f.areaNameKo, bedrooms: f.bedrooms, hasPool: f.hasPool })}`,
    "확인된 사실:",
    ...facts.map((x) => `- ${x}`),
    "",
    "규칙(어기면 폐기된다):",
    "- **위에 없는 사실을 지어내지 마라.** 없는 시설·전망·서비스를 추측해서 쓰지 않는다",
    "- 가격·요금·금액을 절대 쓰지 마라('원', '동', '달러', '얼마' 금지)",
    "- 특정 날짜의 예약 가능 여부를 쓰지 마라",
    "- 상세 주소·소유자·관리인 정보를 쓰지 마라",
    "- 최상급·과장 표현('최고', '최상', '단연', '1위') 금지",
    "- 확인되지 않은 통계·수치 금지",
    "",
    "형식:",
    "- 순수 텍스트만 출력한다(제목·마크다운·따옴표 없이 본문만)",
    `- ${MIN_PUBLIC_BODY_CHARS}자 이상 900자 이하의 한국어`,
    "- 2~3개 문단. 누가 묵기 좋은 빌라인지, 공간 구성이 어떤지, 무엇을 확인하면 좋은지 순서로",
    "- 담백하게. 광고 문구가 아니라 판단에 도움이 되는 설명으로",
  ].join("\n");
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export interface VillaDescriptionResult {
  text: string;
  flaggedTerms: string[];
}

/**
 * Gemini로 빌라 소개문 생성. 키 미설정·오류·하한 미달이면 null(호출부가 건너뛴다).
 * ★ 폴백 템플릿 없음 — 스펙 나열식 자동 문장은 그 자체가 얇은 콘텐츠이고,
 *   모든 빌라가 같은 문장 구조면 중복 콘텐츠 신호가 된다.
 */
export async function generateVillaDescription(
  facts: VillaDescriptionFacts,
  fetchFn: typeof fetch = fetch
): Promise<VillaDescriptionResult | null> {
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
          contents: [{ parts: [{ text: buildVillaDescriptionPrompt(facts) }] }],
          generationConfig: { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    if (text.length < MIN_PUBLIC_BODY_CHARS) return null;
    return { text: text.slice(0, 2000), flaggedTerms: findBannedTerms(text) };
  } catch {
    return null;
  }
}

// ── 준비 상태 판정 ──────────────────────────────────────────────────────────
export interface VillaPrepStatus {
  hasSlug: boolean;
  hasDescription: boolean;
  enoughPhotos: boolean;
  activeSellable: boolean;
  /** 공개(publicListed)를 켤 수 있는가 — 켜져 있어야 실제 노출되지만, 켜기 전 조건 충족 여부 */
  eligible: boolean;
}

export function evaluatePrep(v: {
  status: string;
  isSellable: boolean;
  publicSlug: string | null;
  description: string | null;
  photoCount: number;
}): VillaPrepStatus {
  const hasSlug = !!v.publicSlug;
  const hasDescription = (v.description ?? "").trim().length >= MIN_PUBLIC_BODY_CHARS;
  const enoughPhotos = v.photoCount >= MIN_PUBLIC_PHOTOS;
  const activeSellable = v.status === "ACTIVE" && v.isSellable;
  return {
    hasSlug,
    hasDescription,
    enoughPhotos,
    activeSellable,
    eligible: hasSlug && hasDescription && enoughPhotos && activeSellable,
  };
}

/** 준비 대상 빌라 조회 select — 공개 경계 밖 필드는 읽지 않는다. */
export const PREP_VILLA_SELECT = {
  id: true,
  name: true,
  nameVi: true,
  complex: true,
  status: true,
  isSellable: true,
  publicSlug: true,
  publicListed: true,
  description: true,
  bedrooms: true,
  bathrooms: true,
  maxGuests: true,
  areaSqm: true,
  floors: true,
  hasPool: true,
  breakfastAvailable: true,
  beachDistanceM: true,
  parkingSlots: true,
  petsAllowed: true,
  smokingAllowed: true,
  partyAllowed: true,
  extraBedAvailable: true,
  complexArea: { select: { nameKo: true } },
  features: { select: { featureKey: true } },
  photos: { select: { space: true } },
} satisfies Prisma.VillaSelect;

export type PrepVillaRow = Prisma.VillaGetPayload<{ select: typeof PREP_VILLA_SELECT }>;

const SPACE_KO: Record<string, string> = {
  EXTERIOR: "외관",
  POOL: "수영장",
  LIVING: "거실",
  BEDROOM: "침실",
  KITCHEN: "주방",
  BATHROOM: "욕실",
  BALCONY: "발코니",
  ETC: "기타",
};

/** 행 → 소개문 생성 입력(공개 사실만). */
export function toDescriptionFacts(v: PrepVillaRow): VillaDescriptionFacts {
  const spaces = [...new Set(v.photos.map((p) => SPACE_KO[String(p.space)] ?? "기타"))];
  return {
    complex: v.complex,
    areaNameKo: v.complexArea?.nameKo ?? null,
    bedrooms: v.bedrooms,
    bathrooms: v.bathrooms,
    maxGuests: v.maxGuests,
    areaSqm: v.areaSqm,
    floors: v.floors,
    hasPool: v.hasPool,
    breakfastAvailable: v.breakfastAvailable,
    beachDistanceM: v.beachDistanceM,
    parkingSlots: v.parkingSlots,
    petsAllowed: v.petsAllowed,
    smokingAllowed: v.smokingAllowed,
    partyAllowed: v.partyAllowed,
    extraBedAvailable: v.extraBedAvailable,
    featureKeys: v.features.map((f) => f.featureKey),
    photoSpaces: spaces,
  };
}

/** 검수 통과 시 자동 공개 전환 여부 — AppSetting. 기본 off(운영자가 켠 뒤 자동화). */
export async function isAutoListEnabled(db: DbClient = prisma): Promise<boolean> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: "SEO_AUTO_LIST_ON_SELLABLE" },
      select: { value: true },
    });
    return (row?.value ?? "").trim() === "1";
  } catch {
    return false;
  }
}
