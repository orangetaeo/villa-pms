// lib/service-image.ts — 서비스 카탈로그 항목의 표시 이미지 결정 (ADR-0019)
//   관리자가 사진을 업로드하지 않은 항목은 ServiceType에 맞는 기본 이미지를 보여준다.
//   정적 자산(/public/service-images/*) — UPLOAD_DIR volume·R2 설정과 무관하게 Next가 항상 정적 서빙하므로
//   업로드 경로(/uploads/*, volume 라우트)와 충돌하지 않는다. 순수 함수(클라·서버 공용).

/** ServiceType별 기본 이미지 경로 — 라이선스 free(Flickr CC) 사진을 public/service-images/에 번들. */
const DEFAULT_BY_TYPE: Record<string, string> = {
  BBQ: "/service-images/bbq.jpg",
  TICKET: "/service-images/ticket.jpg",
  GUIDE: "/service-images/guide.jpg",
  CAR_RENTAL: "/service-images/car-rental.jpg",
  BREAKFAST: "/service-images/breakfast.jpg",
  MOTORBIKE_RENTAL: "/service-images/motorbike-rental.jpg",
  MASSAGE: "/service-images/massage.jpg",
  BARBER: "/service-images/barber.jpg",
};

/**
 * 카탈로그 항목의 표시 이미지 — 업로드한 사진(photoUrl) 우선, 없으면 타입 기본 이미지.
 * 둘 다 없으면 null(호출측이 아이콘 플레이스홀더 등으로 폴백).
 */
export function catalogImage(type: string, photoUrl?: string | null): string | null {
  if (photoUrl && photoUrl.trim()) return photoUrl;
  return DEFAULT_BY_TYPE[type] ?? null;
}
