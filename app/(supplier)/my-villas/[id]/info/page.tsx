// 공급자 빌라 정보(이용규칙·위치/규모) 수정 페이지 (테오 요청: 규칙은 공급자 영역)
// 소유 검증: villa.supplierId !== 세션 → notFound(존재 비노출). 비SUPPLIER redirect.
// 누수 0: 판매가·마진·요율 미조회. 공급자 사실 속성 필드만 prefill.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatVillaName } from "@/lib/villa-name";
import VillaInfoEditor, { type InfoInitial } from "./info-editor";

export const metadata: Metadata = {
  title: "Quy định sử dụng",
};

export default async function VillaInfoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const { id } = await params;

  const villa = await prisma.villa.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      name: true,
      nameVi: true,
      checkInTime: true,
      checkOutTime: true,
      smokingAllowed: true,
      petsAllowed: true,
      partyAllowed: true,
      parkingSlots: true,
      baseDepositVnd: true,
      extraBedAvailable: true,
      googleMapUrl: true,
      beachDistanceM: true,
      areaSqm: true,
      floors: true,
    },
  });
  // 타인 빌라·미존재는 동일하게 404 (존재 비노출)
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const t = await getTranslations({ locale, namespace: "supplierInfo" });

  const initial: InfoInitial = {
    checkInTime: villa.checkInTime,
    checkOutTime: villa.checkOutTime,
    smokingAllowed: villa.smokingAllowed,
    petsAllowed: villa.petsAllowed,
    partyAllowed: villa.partyAllowed,
    parkingSlots: villa.parkingSlots,
    baseDepositVnd: villa.baseDepositVnd ? villa.baseDepositVnd.toString() : "",
    extraBedAvailable: villa.extraBedAvailable,
    googleMapUrl: villa.googleMapUrl ?? "",
    beachDistanceM: villa.beachDistanceM != null ? String(villa.beachDistanceM) : "",
    areaSqm: villa.areaSqm != null ? String(villa.areaSqm) : "",
    floors: villa.floors != null ? String(villa.floors) : "",
  };

  return (
    <div className="mx-auto w-full max-w-[420px]">
      {/* TopAppBar — 뒤로가기 + 제목 (브랜드는 /my-villas/ 하위라 레이아웃에서 숨김) */}
      <header className="sticky top-0 z-40 flex h-14 w-full items-center bg-white px-2 shadow-sm">
        <Link
          href={`/my-villas/${villa.id}`}
          aria-label={t("back")}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:bg-neutral-50 active:scale-95"
        >
          <span className="material-symbols-outlined text-teal-600">arrow_back</span>
        </Link>
        <h1 className="flex-1 truncate px-1 text-center text-lg font-semibold text-teal-600">
          {t("title")}
        </h1>
        <div className="h-10 w-10" />
      </header>

      <main className="px-4 pb-28 pt-4">
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-teal-100 bg-teal-50 p-3 text-[12px] leading-relaxed text-teal-800">
          <span className="material-symbols-outlined text-[18px] text-teal-600">info</span>
          {t("intro", { villa: formatVillaName({ name: villa.name, nameVi: villa.nameVi }) })}
        </p>
        <VillaInfoEditor villaId={villa.id} initial={initial} />
      </main>
    </div>
  );
}
