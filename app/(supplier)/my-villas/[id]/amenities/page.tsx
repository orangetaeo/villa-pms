// 공급자 비품 수정 (T6.4) — 소유 검증 후 현재 비품 prefill → 클라 에디터.
// 누수 0: VillaRate(판매가·마진) 미조회. 비품만 로드.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import AmenitiesEditor from "./amenities-editor";

export const metadata: Metadata = {
  title: "Tiện nghi & đồ dùng",
};

export default async function EditAmenitiesPage({
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
      name: true,
      // 미니바는 회사 직접운영(#2a) — 공급자 prefill에서 제외. unitPrice(고객 청구가=우리 판매가)는
      // 공급자 페이지에서 아예 조회하지 않는다(비-MINIBAR 수량만 필요).
      amenities: {
        where: { category: { not: "MINIBAR" } },
        select: {
          category: true,
          itemKey: true,
          quantity: true,
        },
      },
    },
  });
  // 타인·부재 동일 404 (존재 비노출)
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "amenities" });

  // 현재 비품(미니바 제외) → 사전 항목 수량 맵. key: `category:itemKey` → 수량.
  const initialQuantities: Record<string, number> = {};
  for (const a of villa.amenities) {
    initialQuantities[`${a.category}:${a.itemKey}`] = a.quantity;
  }

  return (
    <div className="mx-auto w-full max-w-[420px]">
      {/* TopAppBar — 뒤로가기(상세) + 제목 */}
      <header className="sticky top-0 z-40 flex h-14 w-full items-center bg-white px-2 shadow-sm">
        <Link
          href={`/my-villas/${villa.id}`}
          aria-label={t("cancel")}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:bg-neutral-50 active:scale-95"
        >
          <span className="material-symbols-outlined text-teal-600">arrow_back</span>
        </Link>
        <h1 className="flex-1 truncate px-1 text-center text-lg font-semibold text-teal-600">
          {t("editTitle")}
        </h1>
        <div className="h-10 w-10" />
      </header>

      <AmenitiesEditor villaId={villa.id} initialQuantities={initialQuantities} />
    </div>
  );
}
