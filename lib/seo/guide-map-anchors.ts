// lib/seo/guide-map-anchors.ts — 가이드 글 지도 앵커(큐레이션)
//
// ★ 왜 큐레이션인가: 가이드 글(시즌·아이동반·빌라vs호텔 등)은 대부분 **단일 지리 지점이 없다**.
//   지도를 억지로 넣으면 본문과 무관한 지도가 되어 오히려 품질 신호를 깎는다. 그래서 지리 앵커가
//   명확한 토픽만 여기 등록하고, 나머지 가이드 글엔 지도를 넣지 않는다(빌라·장소 글과 다른 점).
// ★ 좌표 데이터가 없으므로 장소명 검색 쿼리로 임베드한다(키 없는 output=embed). 공개 지점이라
//   정밀 노출에 문제 없다. slug(=가이드 topicKey)로 매칭한다.

export interface GuideMapAnchor {
  /** 구글 지도 검색어(영문 장소명 권장 — 매칭 정확도). */
  query: string;
  /** 화면 표기 라벨(한국어). */
  label: string;
  /** 줌(기본 13). 공항처럼 넓으면 12. */
  zoom?: number;
}

/** 지리 앵커가 명확한 가이드 slug만. 추가 시 여기 한 줄이면 된다. */
export const GUIDE_MAP_ANCHORS: Record<string, GuideMapAnchor> = {
  "airport-transfer": { query: "Phu Quoc International Airport", label: "푸꾸옥 국제공항", zoom: 12 },
};

/** slug에 앵커가 있으면 임베드 URL+라벨, 없으면 null(지도 생략). */
export function guideMapEmbed(slug: string): { embedUrl: string; label: string } | null {
  const a = GUIDE_MAP_ANCHORS[slug];
  if (!a) return null;
  const z = a.zoom ?? 13;
  return {
    embedUrl: `https://maps.google.com/maps?q=${encodeURIComponent(a.query)}&z=${z}&output=embed`,
    label: a.label,
  };
}
