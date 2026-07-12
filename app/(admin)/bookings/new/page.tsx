// /bookings/new — 관리자 수동 예약 생성 (T-admin-manual-booking, 운영자 다크 ko)
// RSC: 초기 화면용 판매가능 빌라 시드(initialVillas) + 지역(단지) 옵션만 조회.
//   실제 검색은 클라이언트가 GET /api/villas/bookable(BE)로 수행(날짜 공실·상세필터 반영, 단일 소스).
//   서버는 ACTIVE + isSellable 게이트를 항상 강제(검수 게이트, 사업원칙 3). 재고 비공개 — 운영자 전용.
//   가격 설정을 수반하므로 canViewFinance 게이트(제안 생성과 동일).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VillaStatus } from "@prisma/client";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import ManualBookingForm, { type VillaResult } from "./manual-booking-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBookings");
  return { title: `${t("create.title")} — Villa Go` };
}

// GET /api/villas/bookable 결과와 동일한 select — 첫 페인트/프리필 해석용 시드
const RESULT_SELECT = {
  id: true,
  name: true,
  nameVi: true,
  complex: true,
  maxGuests: true,
  bedrooms: true,
  bathrooms: true,
  hasPool: true,
  breakfastAvailable: true,
  beachDistanceM: true,
} as const;

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ villaId?: string; checkIn?: string; checkOut?: string }>;
}) {
  // 수동 예약 = 판매가 설정. 재무 권한자(OWNER/MANAGER/ADMIN)만 — STAFF 차단(layout과 이중화).
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  const params = await searchParams;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const [initialVillas, areaRows] = await Promise.all([
    // 초기 시드(날짜·필터 없음) — 마운트 시 클라이언트가 /api/villas/bookable로 즉시 재조회해 대체.
    prisma.villa.findMany({
      where: { status: VillaStatus.ACTIVE, isSellable: true },
      orderBy: [{ complex: "asc" }, { name: "asc" }],
      take: 100,
      select: RESULT_SELECT,
    }) as Promise<VillaResult[]>,
    // 지역(area) 옵션 = 판매가능 빌라의 단지명(complex) distinct — /villas 지역 필터와 동일 개념
    prisma.villa.findMany({
      where: { status: VillaStatus.ACTIVE, isSellable: true, complex: { not: null } },
      distinct: ["complex"],
      orderBy: { complex: "asc" },
      select: { complex: true },
    }),
  ]);

  const areaOptions = areaRows.map((r) => r.complex).filter((c): c is string => !!c);

  // 프리필(공실보드·빌라 상세에서 옴) — 형식만 검증. villaId 유효성은 클라이언트가 검색 결과로 판정.
  const prefill = {
    villaId: params.villaId || undefined,
    checkIn: params.checkIn && DATE_RE.test(params.checkIn) ? params.checkIn : undefined,
    checkOut: params.checkOut && DATE_RE.test(params.checkOut) ? params.checkOut : undefined,
  };

  return (
    <ManualBookingForm initialVillas={initialVillas} areaOptions={areaOptions} prefill={prefill} />
  );
}
