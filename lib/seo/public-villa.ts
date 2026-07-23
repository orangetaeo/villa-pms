// lib/seo/public-villa.ts — 공개 SEO 페이지용 빌라 직렬화 **단일 관문** (T-seo-s1)
//
// ★★ 이 파일이 공개 경계의 유일한 통로다. 공개 라우트(app/villas·sitemap·feed·JSON-LD)는
//    Villa 모델을 **직접 조회하지 않는다**. 반드시 이 모듈의 함수를 경유한다.
//    (선례: lib/instagram/draft.ts VILLA_SELECT — 같은 원칙, 더 넓은 필드셋)
//
// ★ 절대 금지 (계약 T-seo-s1 §4.1 — 위반 시 롤백):
//   · 판매가·원가·마진·baseDepositVnd·monthlyRentVnd
//        └ 공급자는 자기 원가를 안다. 공개 판매가 = 마진 역산이므로 시작가·범위조차 금지(원칙 2)
//   · 날짜별 공실·캘린더·예약 가능 표시 (원칙 1 — 재고는 운영자 전용)
//   · 상세주소·googleMapUrl(정확 위치) — 무단 방문·공급자 역추적·직거래 우회 차단
//   · 공급자 정보(supplierId·이름·연락처), cleanerId
//   · accessType·accessInfo·wifiSsid·wifiPassword (기존 /p·/g 공개경계 규칙 승계)
//   · 미승인 클립(VillaClip은 APPROVED만), 내부 운영값(status·isSellable·qualityScore·rejectionReason·icalImportUrls)
//
// 노출 정책 (테오 결정 2026-07-22, 개정): **소비자 검색형 공개 사이트**. 빌라 300~400개 확장 전제.
//   publicListed는 "선별 노출"이 아니라 **품질·동의 게이트**(사진·소개문 미비, 공급자 비동의, 분쟁 빌라 제외).
//   검수 통과 빌라는 원칙적으로 공개 — 300~400개 수동 토글은 비현실적이므로
//   AppSetting SEO_AUTO_LIST_ON_SELLABLE(기본 on)로 isSellable 전환 시 자동 공개한다(S2).
//
// ★ 날짜(공실) 검색은 이 모듈이 절대 제공하지 않는다 — "특정 날짜에 가능한 빌라" 조회는
//   그 자체가 공실 현황 공개(원칙 1 정면 위반)다. 공개 필터에 checkIn·checkOut을 넣지 말 것.
//   날짜 조건은 상담(/chat) CTA로만 처리한다.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { publicVillaLabel } from "@/lib/marketing/public-name";

// ── 발행 품질 하한 (기획 §0 치명2 — 얇은 콘텐츠·대량 자동생성 스팸 시그널 방지) ──
/** 공개 페이지 생성에 필요한 최소 사진 수. 미달 빌라는 켜져 있어도 발행하지 않는다. */
export const MIN_PUBLIC_PHOTOS = 8;
/** 공개 페이지 본문 최소 길이(자). description이 짧으면 자동 생성 본문으로 보강 후 재판정. */
export const MIN_PUBLIC_BODY_CHARS = 600;

// ── 공개 화이트리스트 select ────────────────────────────────────────────────
//   여기에 필드를 추가할 때는 반드시 §4.1 금지 목록과 대조하고 tests/seo-leak.test.ts를 먼저 확인한다.
export const PUBLIC_VILLA_SELECT = {
  id: true,
  publicSlug: true,
  publicListedAt: true,
  updatedAt: true,

  // 지역 (표시용 — 정확 주소 아님)
  // ★ 고유 실명(name·nameVi)은 공개 경계 밖으로 절대 내보내지 않는다(원칙 1, 2026-07-24).
  //   실명으로 검색하면 직접 예약 페이지·공급자를 찾아 직거래 우회가 가능하기 때문.
  //   공개 표시명은 toPublicVilla에서 publicVillaLabel(지역·특징 조합)로 계산한다.
  complex: true,
  complexArea: { select: { code: true, name: true, nameKo: true } },

  // 규모·구성
  bedrooms: true,
  bathrooms: true,
  commonBathrooms: true,
  maxGuests: true,
  areaSqm: true,
  floors: true,
  extraBedAvailable: true,

  // 시설·특징
  hasPool: true,
  breakfastAvailable: true,
  beachDistanceM: true,
  features: { select: { featureKey: true } },

  // 이용규칙 (게스트 판단 정보 — 민감값 아님)
  checkInTime: true,
  checkOutTime: true,
  smokingAllowed: true,
  petsAllowed: true,
  partyAllowed: true,
  parkingSlots: true,

  // 소개문
  description: true,

  photos: {
    select: { id: true, url: true, space: true, spaceLabel: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
  // 발행된 유튜브 쇼츠 — VideoObject 구조화 데이터·비디오 사이트맵용 (T-seo-media).
  //   ★ PUBLISHED + ytVideoId 있는 것만. 미발행·비공개 영상은 절대 노출하지 않는다.
  //   ★ 영상 메타는 이미 유튜브에 공개된 정보(제목·설명)라 추가 누수 표면이 없다.
  youtubeShorts: {
    where: { status: "PUBLISHED", ytVideoId: { not: null } },
    select: { ytVideoId: true, title: true, description: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
    take: 3,
  },
} satisfies Prisma.VillaSelect;

export type PublicVillaRow = Prisma.VillaGetPayload<{ select: typeof PUBLIC_VILLA_SELECT }>;

/** 공개 페이지가 소비하는 최종 형태 — 이 타입 밖의 필드는 화면에 도달할 수 없다. */
export interface PublicVilla {
  id: string;
  slug: string;
  /** 공개 표시명 — 지역·특징 자동 조합(publicVillaLabel). 고유 실명(name/nameVi)은 이 DTO에 없다. */
  publicLabel: string;
  complex: string | null;
  areaCode: string | null;
  areaName: string | null;
  areaNameKo: string | null;
  bedrooms: number;
  bathrooms: number;
  commonBathrooms: number;
  maxGuests: number;
  areaSqm: number | null;
  floors: number | null;
  extraBedAvailable: boolean;
  hasPool: boolean;
  breakfastAvailable: boolean;
  beachDistanceM: number | null;
  featureKeys: string[];
  checkInTime: number;
  checkOutTime: number;
  smokingAllowed: boolean;
  petsAllowed: boolean;
  partyAllowed: boolean;
  parkingSlots: number;
  description: string | null;
  photos: { id: string; url: string; space: string; spaceLabel: string | null }[];
  /** 발행된 쇼츠 — VideoObject·비디오 사이트맵용. 없으면 빈 배열 */
  videos: { ytVideoId: string; title: string; description: string; publishedAt: Date | null }[];
  updatedAt: Date;
  publicListedAt: Date | null;
}

/**
 * 행 → 공개 DTO. **여기서 한 번 더 좁힌다** — select가 실수로 넓어져도 이 매핑을 통과하지 못한다
 * (이중 방어: select 화이트리스트 + 명시적 필드 매핑).
 */
export function toPublicVilla(row: PublicVillaRow): PublicVilla | null {
  if (!row.publicSlug) return null; // 슬러그 없는 빌라는 공개 URL이 없다
  return {
    id: row.id,
    slug: row.publicSlug,
    // 공개 표시명 = 지역·특징 조합. 고유 실명은 여기서 계산 소스로도 쓰지 않는다.
    publicLabel: publicVillaLabel({
      complex: row.complex,
      areaNameKo: row.complexArea?.nameKo ?? null,
      bedrooms: row.bedrooms,
      hasPool: row.hasPool,
    }),
    complex: row.complex,
    areaCode: row.complexArea?.code ?? null,
    areaName: row.complexArea?.name ?? null,
    // nameKo = 한국어 단지 병기(예: 쏘나씨). 타깃이 한국어 검색이라 표시에 사용한다.
    //   schema 주석의 "매칭 사용 금지"는 준수 — 조회·매칭에는 절대 쓰지 않고 표시 전용.
    areaNameKo: row.complexArea?.nameKo ?? null,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    commonBathrooms: row.commonBathrooms,
    maxGuests: row.maxGuests,
    areaSqm: row.areaSqm,
    floors: row.floors,
    extraBedAvailable: row.extraBedAvailable,
    hasPool: row.hasPool,
    breakfastAvailable: row.breakfastAvailable,
    beachDistanceM: row.beachDistanceM,
    featureKeys: row.features.map((f) => f.featureKey),
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    smokingAllowed: row.smokingAllowed,
    petsAllowed: row.petsAllowed,
    partyAllowed: row.partyAllowed,
    parkingSlots: row.parkingSlots,
    description: row.description,
    photos: row.photos.map((p) => ({ id: p.id, url: p.url, space: String(p.space), spaceLabel: p.spaceLabel })),
    videos: row.youtubeShorts
      .filter((s): s is typeof s & { ytVideoId: string } => !!s.ytVideoId)
      .map((s) => ({ ytVideoId: s.ytVideoId, title: s.title, description: s.description, publishedAt: s.publishedAt })),
    updatedAt: row.updatedAt,
    publicListedAt: row.publicListedAt,
  };
}

/**
 * 발행 자격 판정 — 켜져 있어도(publicListed) 품질 하한 미달이면 페이지·sitemap에서 제외한다.
 * 신규 도메인에 얇은 페이지를 대량 투입하면 저품질 판정이 도메인 전체로 번진다(기획 §0 치명2).
 */
export function isPublishable(v: PublicVilla): boolean {
  if (v.photos.length < MIN_PUBLIC_PHOTOS) return false;
  const body = (v.description ?? "").trim();
  return body.length >= MIN_PUBLIC_BODY_CHARS;
}

/** 공개 대상 조회의 단일 where — 다른 곳에서 조건을 재작성하지 않는다. */
const PUBLIC_WHERE = {
  publicListed: true,
  status: "ACTIVE",
  isSellable: true,
  publicSlug: { not: null },
} satisfies Prisma.VillaWhereInput;

/** 공개 빌라 전체(발행 자격 통과분만). sitemap·지역 허브·테마 조합이 공유한다. */
export async function getPublicVillas(db: DbClient = prisma): Promise<PublicVilla[]> {
  const rows = await db.villa.findMany({
    where: PUBLIC_WHERE,
    select: PUBLIC_VILLA_SELECT,
    orderBy: { publicListedAt: "asc" },
  });
  return rows.map(toPublicVilla).filter((v): v is PublicVilla => v !== null && isPublishable(v));
}

/** 슬러그 단건 조회 — 공개 상세 페이지용. 자격 미달·비공개면 null(404 처리). */
export async function getPublicVillaBySlug(slug: string, db: DbClient = prisma): Promise<PublicVilla | null> {
  const row = await db.villa.findFirst({
    where: { ...PUBLIC_WHERE, publicSlug: slug },
    select: PUBLIC_VILLA_SELECT,
  });
  if (!row) return null;
  const v = toPublicVilla(row);
  return v && isPublishable(v) ? v : null;
}

// ── 슬러그 생성 ─────────────────────────────────────────────────────────────
/**
 * 라틴 슬러그 생성 — **고유 실명(name/nameVi) 미사용**(원칙 1, 2026-07-24). 실명이 URL에 박히면
 * 그 URL·검색결과가 직접 예약 페이지·공급자로 이어지는 우회 경로가 된다. 대신 노출 가능한
 * 단지명(complex)과 규모(bedrooms)로 조립한다: `{complex-latin}-{N}br-villa-{id8}`.
 * 단지가 없으면 `villa-{id8}`. 발급 후에는 **불변**(URL 안정성 = SEO 자산) — 이 함수는 신규 발급에만 쓴다.
 */
export function buildPublicSlug(input: { id: string; complex?: string | null; bedrooms?: number | null }): string {
  const id8 = input.id.slice(0, 8);
  const complexLatin = (input.complex ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // 결합 발음기호(베트남어 성조) 제거
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const brToken = input.bedrooms && input.bedrooms > 0 ? `${input.bedrooms}br-` : "";
  return complexLatin.length >= 2 ? `${complexLatin}-${brToken}villa-${id8}` : `villa-${id8}`;
}
