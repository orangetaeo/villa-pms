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
      complexAreaId: true,
      complex: true,
      address: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      hasPool: true,
      breakfastAvailable: true,
      monthlyRentVnd: true,
      // 이용 규칙 — 재제출 마법사 prefill (미반영 방지)
      checkInTime: true,
      checkOutTime: true,
      smokingAllowed: true,
      petsAllowed: true,
      partyAllowed: true,
      parkingSlots: true,
      baseDepositVnd: true,
      extraBedAvailable: true,
      // v1.5 잠자리 구성·판매정보 prefill (명시 select — include 금지).
      //   wifiPassword·accessInfo는 비공개 필드지만 자기 빌라(아래 supplierId 스코프 확인)라 허용.
      //   출입정보는 기존 accessType/accessInfo 재사용(신규 doorAccess 컬럼 없음 — TDA 결정).
      commonBathrooms: true,
      googleMapUrl: true,
      beachDistanceM: true,
      wifiSsid: true,
      wifiPassword: true,
      accessType: true,
      accessInfo: true,
      bedroomDetails: {
        orderBy: { roomIndex: "asc" },
        select: {
          roomIndex: true,
          roomLabel: true,
          bedType: true,
          bedCount: true,
          capacity: true,
          bathroomCount: true,
        },
      },
      features: { select: { category: true, featureKey: true } },
      photos: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { space: true, spaceLabel: true, url: true },
      },
      // customLabel 포함 — 직접입력(custom) 항목 prefill 누락 시 재제출에서 유실됨 (T-amenity-quantity-custom)
      amenities: { select: { category: true, itemKey: true, quantity: true, customLabel: true } },
      // 누수 차단 — supplierCostVnd만 (마진·판매가 미조회, ADR-0014 VillaRatePeriod)
      ratePeriods: { select: { season: true, isBase: true, supplierCostVnd: true } },
    },
  });

  // 타인 빌라·미존재는 동일하게 404 (존재 비노출)
  if (!villa || villa.supplierId !== session.user.id) notFound();
  // 본인이지만 REJECTED가 아니면 수정 불가 → 상세로 (QA 조건 5)
  if (villa.status !== "REJECTED") redirect(`/my-villas/${id}`);

  // 단지 마스터 — active만 (마법사 드롭다운 소스). ADR-0046
  const activeAreas = await prisma.complexArea.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameKo: true },
  });
  // 재제출 안전장치: 이 빌라의 현재 단지가 비활성으로 빠졌으면 옵션에 보존 —
  // 없으면 재제출 시 선택이 조용히 해제(complexAreaId="")되어 단지가 지워질 위험.
  let complexAreas = activeAreas;
  if (villa.complexAreaId && !activeAreas.some((a) => a.id === villa.complexAreaId)) {
    const current = await prisma.complexArea.findUnique({
      where: { id: villa.complexAreaId },
      select: { id: true, name: true, nameKo: true },
    });
    if (current) complexAreas = [...activeAreas, current];
  }
  // 이 화면은 공급자 전용(위 role 가드) — nameKo(한글 병기)는 운영자 전용이므로
  //   flight data에도 싣지 않도록 null로 걷어낸다(D6, 역할별 불필요 노출 최소화).
  complexAreas = complexAreas.map((a) => ({ ...a, nameKo: null }));

  const forEdit: VillaForEdit = {
    name: villa.name,
    complexAreaId: villa.complexAreaId,
    complex: villa.complex,
    address: villa.address,
    bedrooms: villa.bedrooms,
    bathrooms: villa.bathrooms,
    maxGuests: villa.maxGuests,
    hasPool: villa.hasPool,
    breakfastAvailable: villa.breakfastAvailable,
    monthlyRentVnd: villa.monthlyRentVnd ? villa.monthlyRentVnd.toString() : null,
    rules: {
      checkInTime: villa.checkInTime,
      checkOutTime: villa.checkOutTime,
      smokingAllowed: villa.smokingAllowed,
      petsAllowed: villa.petsAllowed,
      partyAllowed: villa.partyAllowed,
      parkingSlots: villa.parkingSlots,
      baseDepositVnd: villa.baseDepositVnd ? villa.baseDepositVnd.toString() : "",
      extraBedAvailable: villa.extraBedAvailable,
    },
    photos: villa.photos,
    amenities: villa.amenities,
    // v1.5 잠자리 구성·판매정보 — UX-VN이 villaToWizardState에서 WizardState로 매핑
    commonBathrooms: villa.commonBathrooms,
    accessType: villa.accessType,
    accessInfo: villa.accessInfo,
    wifiSsid: villa.wifiSsid,
    wifiPassword: villa.wifiPassword,
    googleMapUrl: villa.googleMapUrl,
    beachDistanceM: villa.beachDistanceM,
    bedroomDetails: villa.bedroomDetails,
    features: villa.features,
    // 마법사 rates 입력 prefill — LOW=base, HIGH/PEAK=그 시즌 첫 기간.
    //   ⚠️ prefill은 base(LOW) 폴백이 필요하다(표시·경보와 상반): 마법사는 필수 3시즌(LOW/HIGH/PEAK)
    //   원가를 모두 받아 비면 제출 잠김(step-rates allEntered). HIGH/PEAK 기간이 아직 없는 빌라
    //   (전역 시즌 미설정 시 생성분 등)는 base 원가로 채워 재제출을 막지 않는다.
    //   representativeRatesBySeason 자체는 폴백 없음(디버깅 수정) — 여기서만 명시적 폴백.
    //   SHOULDER(준성수기)는 선택 필드 — 실제 SHOULDER 기간이 있을 때만 prefill(base 폴백 없음, 비면 미입력).
    rates: (() => {
      const rep = representativeRatesBySeason(villa.ratePeriods);
      const base = rep.LOW ?? null;
      const out: { season: "LOW" | "SHOULDER" | "HIGH" | "PEAK"; supplierCostVnd: string }[] = [];
      for (const season of ["LOW", "HIGH", "PEAK"] as const) {
        const r = rep[season] ?? base;
        if (r) out.push({ season, supplierCostVnd: r.supplierCostVnd.toString() });
      }
      // 선택 시즌: 실제 값이 있을 때만(폴백 없음)
      if (rep.SHOULDER) {
        out.push({ season: "SHOULDER", supplierCostVnd: rep.SHOULDER.supplierCostVnd.toString() });
      }
      return out;
    })(),
  };

  return (
    <VillaWizard
      villaId={villa.id}
      initialState={villaToWizardState(forEdit)}
      complexAreas={complexAreas}
    />
  );
}
