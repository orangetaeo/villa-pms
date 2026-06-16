// B 사진 관리 (a12-photo-management) — 공간별 추가·삭제·정렬.
// 소유 검증 후 현재 사진 로드 → 클라 매니저. 누수 0: VillaRate 미조회, 금액 필드 없음.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import PhotoManager, { type ManagedPhoto } from "./photo-manager";

export const metadata: Metadata = {
  title: "Quản lý ảnh",
};

export default async function ManagePhotosPage({
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
      bedrooms: true,
      bathrooms: true,
      hasPool: true,
      photos: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, space: true, spaceLabel: true, url: true, isBaseline: true, sortOrder: true },
      },
    },
  });
  // 타인·부재 동일 404 (존재 비노출)
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "photoManage" });

  const photos: ManagedPhoto[] = villa.photos.map((p) => ({
    id: p.id,
    space: p.space,
    spaceLabel: p.spaceLabel,
    url: p.url,
    isBaseline: p.isBaseline,
    sortOrder: p.sortOrder,
  }));

  return (
    <div className="mx-auto w-full max-w-[420px]">
      {/* TopAppBar — 뒤로가기(상세) + 제목 */}
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

      <PhotoManager
        villaId={villa.id}
        bedrooms={villa.bedrooms}
        bathrooms={villa.bathrooms}
        hasPool={villa.hasPool}
        initialPhotos={photos}
      />
    </div>
  );
}
