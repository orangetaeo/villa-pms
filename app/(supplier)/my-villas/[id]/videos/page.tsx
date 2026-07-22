// 공급자 영상 클립 관리 (villa-clip-narration P1) — 촬영 영상 업로드·검수 상태 확인.
// 소유 검증 후 현재 클립 로드 → 클라 매니저. 누수 0: VillaRate 미조회, 금액 필드 없음.
// ?created=1 — 빌라 등록 직후 온보딩 진입(마법사 다음 화면). "나중에 하기"로 건너뛸 수 있다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { loadVillaClipPolicy } from "@/lib/villa-clip";
import ClipManager, { type ManagedClip } from "./clip-manager";

export const metadata: Metadata = {
  title: "Video villa",
};

export default async function ManageVideosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const { id } = await params;
  const { created } = await searchParams;

  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, supplierId: true, name: true },
  });
  // 타인·부재 동일 404 (존재 비노출)
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const [rows, policy] = await Promise.all([
    prisma.villaClip.findMany({
      where: { villaId: villa.id, status: { not: "UPLOADING" } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        url: true,
        durationSec: true,
        sizeBytes: true,
        width: true,
        height: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    }),
    loadVillaClipPolicy(prisma),
  ]);

  const clips: ManagedClip[] = rows.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "clipManage" });

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

      <ClipManager
        villaId={villa.id}
        initialClips={clips}
        policy={{
          maxBytes: policy.maxBytes,
          maxDurationSec: policy.maxDurationSec,
          maxPerVilla: policy.maxPerVilla,
        }}
        onboarding={created === "1"}
      />
    </div>
  );
}
