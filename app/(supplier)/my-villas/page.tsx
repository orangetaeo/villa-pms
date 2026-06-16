// 공급자 내 빌라 홈 (T1.10, SPEC F1) — design/stitch/a6-my-villas 변환
// role 스코프: SUPPLIER=자기 빌라만 (supplierId). 읽기 전용 RSC — 신규 API 없음
// 누수 방지: rates·salePrice·margin 미조회. 카드에는 사진·이름·침실/욕실·상태 배지만 노출
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Villa } from "@prisma/client";

export const metadata: Metadata = {
  title: "Villa của tôi",
};

// 상태 배지 매핑. ACTIVE+isSellable=초록 / ACTIVE+미검수=빨강 외곽선 / 반려=빨강 / 대기=주황 / 중단=회색
// REJECTED는 T1.2b 머지 후 T1.10에서 전용 배지·재제출 진입 추가 (반려 사유는 상세에서 표시)
type BadgeKind = "active" | "notSellable" | "rejected" | "pending" | "inactive";

function resolveBadge(status: Villa["status"], isSellable: boolean): BadgeKind {
  if (status === "ACTIVE") return isSellable ? "active" : "notSellable";
  if (status === "REJECTED") return "rejected";
  if (status === "INACTIVE") return "inactive";
  return "pending"; // DRAFT · PENDING_REVIEW
}

const BADGE_CLASS: Record<BadgeKind, string> = {
  active: "bg-success text-white",
  notSellable: "border-2 border-error bg-white/90 text-error",
  rejected: "bg-error text-white",
  pending: "bg-secondary text-white",
  inactive: "bg-neutral-200 text-neutral-700",
};

export default async function MyVillasPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = session.user.locale === "ko" ? "ko" : "vi";
  const t = await getTranslations({ locale, namespace: "myVillas" });
  const { created } = await searchParams;

  // supplierId 스코프 — 자기 빌라만. 대표 사진(첫 isBaseline) 1장 + 상태 필드만 select (요율 미조회)
  const villas = await prisma.villa.findMany({
    where: { supplierId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      bedrooms: true,
      bathrooms: true,
      status: true,
      isSellable: true,
      photos: {
        where: { isBaseline: true },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { url: true },
      },
    },
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-28">
      {created === "1" && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50 p-4">
          <span className="material-symbols-outlined text-teal-600">check_circle</span>
          <p className="text-sm font-medium text-teal-900">{t("created")}</p>
        </div>
      )}

      <section className="mb-6">
        <p className="mb-1 text-sm text-neutral-500">
          {t("greeting", { name: session.user.name ?? "" })}
        </p>
        <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="text-sm text-neutral-500">{t("subtitle")}</p>
      </section>

      {villas.length === 0 ? (
        // 빈 상태 — 등록 유도
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-10 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">house</span>
          <p className="text-base font-bold text-neutral-700">{t("empty")}</p>
          <p className="text-sm text-neutral-500">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {villas.map((villa) => {
            const badge = resolveBadge(villa.status, villa.isSellable);
            const thumb = villa.photos[0]?.url;
            return (
              <div
                key={villa.id}
                className="overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm transition-transform duration-150 active:scale-[0.98]"
              >
                <Link href={`/my-villas/${villa.id}`} className="block">
                  <div className="relative h-56 w-full bg-neutral-100">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={villa.name}
                        fill
                        unoptimized
                        sizes="(max-width: 672px) 100vw, 672px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-neutral-300">
                        <span className="material-symbols-outlined text-6xl">house</span>
                      </div>
                    )}
                    <div className="absolute left-4 top-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold shadow-md ${BADGE_CLASS[badge]}`}
                      >
                        {t(`status.${badge}`)}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-xl font-bold text-neutral-900">{villa.name}</h2>
                      <span className="material-symbols-outlined text-neutral-500">
                        chevron_right
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-neutral-500">
                      <span className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-lg text-teal-600">bed</span>
                        <span className="text-sm font-medium">
                          {t("rooms", {
                            bedrooms: villa.bedrooms,
                            bathrooms: villa.bathrooms,
                          })}
                        </span>
                      </span>
                    </div>
                  </div>
                </Link>
                {/* ACTIVE 미검수 — 청소 보기 링크 (계약: /cleaning 유도) */}
                {badge === "notSellable" && (
                  <div className="px-4 pb-4">
                    <Link
                      href="/cleaning"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                    >
                      <span className="material-symbols-outlined text-lg">cleaning_services</span>
                      {t("viewCleaning")}
                    </Link>
                  </div>
                )}
                {/* 반려됨 — 수정·재제출 진입 (T1.2b 편집 라우트). 반려 사유는 상세에서 표시 */}
                {badge === "rejected" && (
                  <div className="px-4 pb-4">
                    <Link
                      href={`/my-villas/${villa.id}/edit`}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                      {t("editResubmit")}
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 마법사 진입 FAB — a6 디자인 톤 (teal 플로팅). 탭바 위로 띄움 */}
      <Link
        href="/my-villas/new"
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full bg-teal-600 px-6 py-4 text-white shadow-xl transition-all hover:bg-teal-700 active:scale-95"
      >
        <span className="material-symbols-outlined">add</span>
        <span className="font-bold">{t("add")}</span>
      </Link>
    </div>
  );
}
