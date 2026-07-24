// lib/seo/public-place.ts — 장소 글(맛집·카페 등)의 지도·구조화 데이터 (서버 전용)
//
// ★ 빌라와 다르다: 장소는 **남의 공개 영업점**이라 정확 위치를 숨길 이유가 없다(재고 비공개 무관).
//   오히려 정확 지도 + LocalBusiness/Restaurant geo 구조화 데이터가 로컬 SEO의 핵심 신호다.
//   빌라(getPublicVillaApproxMapEmbed, approximate)와 반대로 여기선 **정밀** 좌표를 쓴다.
// ★ 연결: SeoPlace.usedInArticleId 역링크로 글↔장소를 잇는다(별도 필드 추가 불필요).
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { resolveShortMapUrl, extractLatLng } from "@/lib/seo/resolve-map-url";
import { toEmbedUrl } from "@/components/villa/map-embed-url";

/** 장소 category → schema.org 타입. 모르면 LocalBusiness로 폴백. */
const SCHEMA_TYPE: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "CafeOrCoffeeShop",
  bar: "BarOrPub",
  shop: "Store",
  market: "Store",
  spot: "TouristAttraction",
};

export interface PlaceArticleMap {
  name: string;
  area: string | null;
  /** 정밀 임베드 iframe src (output=embed) */
  embedUrl: string;
  /** 구조화 데이터 geo — 좌표 추출 실패 시 null(그래도 address는 나간다) */
  lat: number | null;
  lng: number | null;
  /** schema.org 타입("Restaurant" 등) */
  schemaType: string;
  /** "구글 지도에서 열기" 외부 링크(해석된 풀 URL) */
  mapLink: string;
}

/**
 * 장소 글에 붙일 지도·geo 데이터. 연결된 SeoPlace(usedInArticleId) 중 mapUrl 있는 첫 곳.
 * 지도 URL 없음·해석/임베드 실패 시 null(지도 생략).
 */
export async function getPlaceArticleMap(articleId: string, db: DbClient = prisma): Promise<PlaceArticleMap | null> {
  const place = await db.seoPlace.findFirst({
    where: { usedInArticleId: articleId, active: true, mapUrl: { not: null } },
    select: { name: true, area: true, category: true, mapUrl: true },
  });
  if (!place?.mapUrl) return null;

  const full = await resolveShortMapUrl(place.mapUrl);
  const embedUrl = toEmbedUrl(full, { approximate: false }); // 공개 영업점 = 정밀
  if (!embedUrl || !full) return null;

  const coord = extractLatLng(full);
  return {
    name: place.name,
    area: place.area,
    embedUrl,
    lat: coord?.lat ?? null,
    lng: coord?.lng ?? null,
    schemaType: SCHEMA_TYPE[place.category] ?? "LocalBusiness",
    mapLink: full,
  };
}
