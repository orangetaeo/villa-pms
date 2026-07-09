// 공급자 내 빌라 홈 (T1.10, SPEC F1) — design/stitch/a6-my-villas 변환
// role 스코프: SUPPLIER=자기 빌라만 (supplierId). 읽기 전용 RSC — 신규 API 없음
// 누수 방지: rates·salePrice·margin 미조회. 행에는 사진·단지·이름·침실/수영장/조식·상태 배지만 노출
// 레이아웃: 관리자 /villas 컴팩트 행(좌측 썸네일 + details 접기/펴기) 구조 차용, 색은 공급자 라이트 유지
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Villa } from "@prisma/client";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";
import { formatVillaName } from "@/lib/villa-name";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

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

// 색 토큰 주의: 이 프로젝트 Tailwind에는 success/error 토큰이 없다(primary·secondary만 정의).
// 과거 큰-카드 시절 bg-success/bg-error는 투명으로 떨어졌으나 사진 위라 안 들켰던 잠복 버그 →
// 흰 카드 위 컴팩트 행에서는 표준 팔레트(emerald/rose/amber/neutral)로 명시 지정한다.
const BADGE_CLASS: Record<BadgeKind, string> = {
  active: "bg-emerald-500 text-white",
  notSellable: "border border-rose-300 bg-rose-50 text-rose-600",
  rejected: "bg-rose-500 text-white",
  pending: "bg-amber-500 text-white",
  inactive: "bg-neutral-200 text-neutral-700",
};

export default async function MyVillasPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; page?: string; pageSize?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "myVillas" });
  // 코치마크 문구 — RSC 번역 → props (화이트리스트 비의존, cleaning-submit 패턴)
  const tTour = await getTranslations({ locale, namespace: "tour" });
  const params = await searchParams;
  const { created } = params;
  const { page, pageSize, skip, take } = parsePageParams(params);

  // supplierId 스코프 — 자기 빌라만. 대표 사진(첫 isBaseline) 1장 + 상태 필드만 select (요율 미조회)
  const villas = await prisma.villa.findMany({
    where: { supplierId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      nameVi: true,
      complex: true,
      bedrooms: true,
      bathrooms: true,
      hasPool: true,
      breakfastAvailable: true,
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
  // 페이지네이션 — 자기 빌라 수는 적어 take:200 캡 내에서 메모리 슬라이스로 충분
  const totalVillas = villas.length;
  const pagedVillas = villas.slice(skip, skip + take);

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
        <div className="flex flex-col gap-3">
          {/* 좌측 썸네일 + 접기/펴기 컴팩트 행 (관리자 /villas 구조 차용, 라이트 테마) */}
          {pagedVillas.map((villa, villaIdx) => {
            const badge = resolveBadge(villa.status, villa.isSellable);
            const thumb = villa.photos[0]?.url;
            const needsCleaning = badge === "notSellable";
            const inactive = badge === "inactive";
            return (
              <details
                key={villa.id}
                className={`group overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm ${
                  inactive ? "opacity-80" : ""
                }`}
              >
                <summary className="flex cursor-pointer select-none list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                  {/* 왼쪽 썸네일 */}
                  <div
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-100 sm:h-20 sm:w-20 ${
                      inactive ? "grayscale" : ""
                    }`}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={villa.name}
                        fill
                        unoptimized
                        sizes="(min-width: 640px) 80px, 64px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-neutral-300">
                        <span className="material-symbols-outlined">house</span>
                      </div>
                    )}
                  </div>
                  {/* 본문 */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {villa.complex && (
                          <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                            {villa.complex}
                          </span>
                        )}
                        <h2 className="truncate text-sm font-bold text-neutral-900 sm:text-base">
                          {formatVillaName({ name: villa.name, nameVi: villa.nameVi })}
                        </h2>
                      </div>
                      <span
                        // 코치마크 앵커 — 첫 행 상태 배지만. 빈 목록이면 이 스텝은 자동 스킵(신규자는 등록만 강조)
                        data-tour={villaIdx === 0 ? "villa-status" : undefined}
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${BADGE_CLASS[badge]}`}
                      >
                        {t(`status.${badge}`)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                      <span className="inline-flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[16px] text-teal-600">bed</span>
                        {villa.bedrooms}
                      </span>
                      {villa.hasPool && (
                        <span className="material-symbols-outlined text-[16px] text-teal-600">pool</span>
                      )}
                      {villa.breakfastAvailable && (
                        <span className="material-symbols-outlined text-[16px] text-teal-600">
                          restaurant
                        </span>
                      )}
                      {needsCleaning && (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-600">
                          <span className="material-symbols-outlined text-[14px]">cleaning_services</span>
                          {t("cleaningPending")}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* chevron */}
                  <span
                    className="material-symbols-outlined shrink-0 text-xl text-neutral-400 transition-transform group-open:rotate-180"
                    aria-hidden
                  >
                    expand_more
                  </span>
                </summary>
                {/* 펼침 상세 — 상세 보기 + 상태별 액션(청소 보기·재제출) */}
                <div className="flex flex-col gap-2 border-t border-neutral-100 px-3 pb-3 pt-2">
                  <Link
                    href={`/my-villas/${villa.id}`}
                    className="block w-full rounded-lg border border-neutral-200 py-2.5 text-center text-sm font-bold text-neutral-800 transition-colors hover:bg-neutral-50"
                  >
                    {t("detail")}
                  </Link>
                  {badge === "notSellable" && (
                    <Link
                      href="/cleaning"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-50 py-2.5 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                    >
                      <span className="material-symbols-outlined text-lg">cleaning_services</span>
                      {t("viewCleaning")}
                    </Link>
                  )}
                  {badge === "rejected" && (
                    <Link
                      href={`/my-villas/${villa.id}/edit`}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-50 py-2.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                      {t("editResubmit")}
                    </Link>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트) */}
      <PaginationBar total={totalVillas} page={page} pageSize={pageSize} light />

      {/* 마법사 진입 FAB — a6 디자인 톤 (teal 플로팅). 탭바 위로 띄움 */}
      <Link
        href="/my-villas/new"
        data-tour="villa-add"
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full bg-teal-600 px-6 py-4 text-white shadow-xl transition-all hover:bg-teal-700 active:scale-95"
      >
        <span className="material-symbols-outlined">add</span>
        <span className="font-bold">{t("add")}</span>
      </Link>

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 헤더 "?"로 재생 */}
      <CoachMark
        tourId="myVillas"
        steps={buildTourSteps(tTour, "myVillas")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}
