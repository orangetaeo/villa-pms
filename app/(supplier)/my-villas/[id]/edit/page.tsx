// 공급자 반려 빌라 수정·재제출 (T1.2b) — 마법사 edit mode prefill
// 가드: 타인 빌라 404(존재 비노출) / 본인이지만 REJECTED 아니면 상세로 redirect (QA 조건 5)
// 누수 방지: rates는 supplierCostVnd만 select (마진·판매가 미조회)
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { representativeRatesBySeason } from "@/lib/pricing";
import VillaWizard from "@/app/(supplier)/my-villas/new/villa-wizard";
import {
  villaToWizardState,
  type VillaForEdit,
} from "@/app/(supplier)/my-villas/new/wizard-types";

export default async function EditVillaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const { id } = await params;
  const villa = await prisma.villa.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      status: true,
      name: true,
      complex: true,
      address: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      hasPool: true,
      breakfastAvailable: true,
      monthlyRentVnd: true,
      photos: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { space: true, spaceLabel: true, url: true },
      },
      amenities: { select: { category: true, itemKey: true, quantity: true } },
      // 누수 차단 — supplierCostVnd만 (마진·판매가 미조회, ADR-0014 VillaRatePeriod)
      ratePeriods: { select: { season: true, isBase: true, supplierCostVnd: true } },
    },
  });

  // 타인 빌라·미존재는 동일하게 404 (존재 비노출)
  if (!villa || villa.supplierId !== session.user.id) notFound();
  // 본인이지만 REJECTED가 아니면 수정 불가 → 상세로 (QA 조건 5)
  if (villa.status !== "REJECTED") redirect(`/my-villas/${id}`);

  const forEdit: VillaForEdit = {
    name: villa.name,
    complex: villa.complex,
    address: villa.address,
    bedrooms: villa.bedrooms,
    bathrooms: villa.bathrooms,
    maxGuests: villa.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    monthlyRentVnd: villa.monthlyRentVnd ? villa.monthlyRentVnd.toString() : null,
    photos: villa.photos,
    amenities: villa.amenities,
    // 시즌 대표 원가행(LOW=base, HIGH/PEAK=그 시즌 첫 기간 없으면 base) → 마법사 rates 입력 prefill.
    rates: (() => {
      const rep = representativeRatesBySeason(villa.ratePeriods);
      return (["LOW", "HIGH", "PEAK"] as const).flatMap((season) => {
        const r = rep[season];
        return r ? [{ season, supplierCostVnd: r.supplierCostVnd.toString() }] : [];
      });
    })(),
  };

  return <VillaWizard villaId={villa.id} initialState={villaToWizardState(forEdit)} />;
}
