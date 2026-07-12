// /bookings/new — 관리자 수동 예약 생성 (T-admin-manual-booking, 운영자 다크 ko)
// RSC: 판매가능 빌라 목록만 조회(ACTIVE + isSellable — 검수 게이트, 사업원칙 3)해 폼에 전달.
//   재고 비공개 원칙 하 운영자 전용. 가격 설정을 수반하므로 canViewFinance 게이트(제안 생성과 동일).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VillaStatus } from "@prisma/client";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import ManualBookingForm, { type VillaOption } from "./manual-booking-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBookings");
  return { title: `${t("create.title")} — Villa Go` };
}

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

  const villas: VillaOption[] = await prisma.villa.findMany({
    // 판매가능(검수 통과) 빌라만 — 우회 없이 게이트 유지
    where: { status: VillaStatus.ACTIVE, isSellable: true },
    orderBy: [{ complex: "asc" }, { name: "asc" }],
    select: { id: true, name: true, complex: true, maxGuests: true },
  });

  // 프리필(공실보드에서 옴) — 유효한 값만 통과 (villaId 는 판매가능 목록에 있어야 반영)
  const prefillVillaId =
    params.villaId && villas.some((v) => v.id === params.villaId) ? params.villaId : undefined;
  const prefill = {
    villaId: prefillVillaId,
    checkIn: params.checkIn && DATE_RE.test(params.checkIn) ? params.checkIn : undefined,
    checkOut: params.checkOut && DATE_RE.test(params.checkOut) ? params.checkOut : undefined,
  };

  return <ManualBookingForm villas={villas} prefill={prefill} />;
}
