// /villas — 운영자 빌라 목록 (T1.2, Stitch b9-villas-list 변환)
// RSC: prisma 직접 조회. 상태 필터 탭 + 승인 대기 카운트 + 카드 그리드(b9, 모바일 1열 카드)
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { Prisma, VillaStatus } from "@prisma/client";
import VillasFilters from "./villas-filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("villas")} — Villa PMS` };
}

const PAGE_SIZE = 12;

// 탭 키 ↔ Villa.status 매핑 (DRAFT는 등록 미완료 — 운영자 목록에서 제외)
const TAB_STATUS: Record<string, VillaStatus | undefined> = {
  all: undefined,
  pending: "PENDING_REVIEW",
  active: "ACTIVE",
  inactive: "INACTIVE",
};
const LISTED_STATUSES: VillaStatus[] = ["PENDING_REVIEW", "ACTIVE", "INACTIVE"];

const STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING_REVIEW: "bg-admin-pending text-black",
  ACTIVE: "bg-admin-active text-white",
  INACTIVE: "bg-admin-inactive text-white",
};

export default async function VillasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; area?: string; q?: string }>;
}) {
  const t = await getTranslations("adminVillas.list");
  const params = await searchParams;
  const tab = params.status && params.status in TAB_STATUS ? params.status : "all";
  const statusFilter = TAB_STATUS[tab];
  const area = params.area?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  // 검색 조건 — 지역(단지명 complex 정확 일치) + 텍스트(빌라명·단지·주소·공급자명).
  // 상태와 분리해 두어 탭 카운트도 검색 범위 안에서 집계한다.
  const searchWhere: Prisma.VillaWhereInput = {
    ...(area ? { complex: area } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { complex: { contains: q, mode: "insensitive" as const } },
            { address: { contains: q, mode: "insensitive" as const } },
            { supplier: { is: { name: { contains: q, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
  const where: Prisma.VillaWhereInput = {
    ...searchWhere,
    ...(statusFilter ? { status: statusFilter } : { status: { in: LISTED_STATUSES } }),
  };

  const [villas, total, statusCounts, complexRows] = await Promise.all([
    prisma.villa.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        complex: true,
        status: true,
        isSellable: true,
        bedrooms: true,
        hasPool: true,
        breakfastAvailable: true,
        supplier: { select: { name: true } },
        // 첫 사진 — PhotoSpace enum 정의 순서상 EXTERIOR 우선
        photos: {
          orderBy: [{ space: "asc" }, { sortOrder: "asc" }],
          take: 1,
          select: { url: true },
        },
        _count: { select: { rates: true } },
      },
    }),
    prisma.villa.count({ where }),
    prisma.villa.groupBy({
      by: ["status"],
      where: { status: { in: LISTED_STATUSES }, ...searchWhere },
      _count: { _all: true },
    }),
    // 지역(area) 옵션 = 운영 목록 대상 빌라의 단지명(complex) distinct
    prisma.villa.findMany({
      where: { status: { in: LISTED_STATUSES }, complex: { not: null } },
      distinct: ["complex"],
      orderBy: { complex: "asc" },
      select: { complex: true },
    }),
  ]);

  const areaOptions = complexRows
    .map((r) => r.complex)
    .filter((c): c is string => !!c);

  const countOf = (s: VillaStatus) =>
    statusCounts.find((c) => c.status === s)?._count._all ?? 0;
  const tabCounts: Record<string, number> = {
    all: statusCounts.reduce((sum, c) => sum + c._count._all, 0),
    pending: countOf("PENDING_REVIEW"),
    active: countOf("ACTIVE"),
    inactive: countOf("INACTIVE"),
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  // 탭·페이지 링크는 검색(area·q) 조건을 보존한다
  const buildHref = (next: { status?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (next.status && next.status !== "all") sp.set("status", next.status);
    if (area) sp.set("area", area);
    if (q) sp.set("q", q);
    if (next.page && next.page > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/villas?${qs}` : "/villas";
  };
  const tabHref = (key: string) => buildHref({ status: key });
  const pageHref = (p: number) => buildHref({ status: tab, page: p });

  const tabs = [
    { key: "all", label: t("tabs.all") },
    { key: "pending", label: t("tabs.pending") },
    { key: "active", label: t("tabs.active") },
    { key: "inactive", label: t("tabs.inactive") },
  ];

  return (
    <div>
      {/* 페이지 헤더 + 필터 탭 (b9) */}
      <div className="flex flex-col gap-6 mb-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
          <VillasFilters areas={areaOptions} />
        </div>
        <div className="flex items-center gap-2 border-b border-admin-card overflow-x-auto">
          {tabs.map(({ key, label }) => {
            const active = tab === key;
            return (
              <Link
                key={key}
                href={tabHref(key)}
                className={
                  active
                    ? "px-4 py-3 text-sm font-bold text-admin-primary border-b-2 border-admin-primary flex items-center gap-2 whitespace-nowrap"
                    : "px-4 py-3 text-sm font-medium text-admin-muted hover:text-white transition-colors flex items-center gap-2 relative whitespace-nowrap"
                }
              >
                {label}
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] bg-admin-card ${
                    active ? "text-admin-primary" : "text-admin-muted"
                  }`}
                >
                  {tabCounts[key]}
                </span>
                {/* 승인 대기 주황 점 (b9) */}
                {key === "pending" && !active && tabCounts.pending > 0 && (
                  <span className="absolute top-3 right-1.5 w-1.5 h-1.5 bg-admin-pending rounded-full" />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 빌라 카드 그리드 (b9 — 모바일 1열 카드 전환) */}
      {villas.length === 0 ? (
        <div className="bg-admin-card rounded-xl border border-slate-800 p-12 text-center text-sm text-admin-muted">
          {area || q ? t("emptyFiltered") : t("empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {villas.map((villa) => {
            const inactive = villa.status === "INACTIVE";
            const pending = villa.status === "PENDING_REVIEW";
            const photoUrl = villa.photos[0]?.url;
            return (
              <div
                key={villa.id}
                className={`bg-admin-card rounded-xl overflow-hidden group hover:ring-1 hover:ring-admin-primary/50 transition-all ${
                  inactive ? "opacity-80" : ""
                }`}
              >
                <div className={`relative h-48 ${inactive ? "grayscale" : ""}`}>
                  {photoUrl ? (
                    <Image
                      src={photoUrl}
                      alt={villa.name}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-600">
                      <span className="material-symbols-outlined text-5xl">villa</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                  <div className="absolute top-4 left-4 flex gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${STATUS_BADGE_CLASS[villa.status] ?? "bg-admin-inactive text-white"}`}
                    >
                      {t(`status.${villa.status}`)}
                    </span>
                    {villa.status === "ACTIVE" && !villa.isSellable && (
                      <span className="bg-transparent border border-admin-alert text-admin-alert text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                        {t("notSellable")}
                      </span>
                    )}
                  </div>
                  <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                    <div className="flex flex-col">
                      {villa.complex && (
                        <span className="text-[10px] text-white/70 uppercase tracking-widest font-bold">
                          {villa.complex}
                        </span>
                      )}
                      <h3 className="text-lg font-bold text-white">{villa.name}</h3>
                    </div>
                  </div>
                </div>
                <div className="p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-admin-muted min-w-0">
                      <span className="material-symbols-outlined text-sm shrink-0">person</span>
                      <span className="font-medium text-slate-50 truncate">
                        {villa.supplier?.name ?? t("noSupplier")}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <span className="flex items-center gap-1 text-[11px] bg-admin-bg px-2 py-1 rounded text-admin-muted">
                        <span className="material-symbols-outlined text-[14px]">bed</span>{" "}
                        {villa.bedrooms}
                      </span>
                      {villa.hasPool && (
                        <span className="flex items-center gap-1 text-[11px] bg-admin-bg px-2 py-1 rounded text-admin-muted">
                          <span className="material-symbols-outlined text-[14px]">pool</span>
                        </span>
                      )}
                      {villa.breakfastAvailable && (
                        <span className="flex items-center gap-1 text-[11px] bg-admin-bg px-2 py-1 rounded text-admin-muted">
                          <span className="material-symbols-outlined text-[14px]">restaurant</span>
                        </span>
                      )}
                    </div>
                  </div>
                  {villa.status === "ACTIVE" && !villa.isSellable && (
                    <div className="flex items-center gap-2 p-2 rounded bg-red-900/20 border border-red-900/30">
                      <span className="material-symbols-outlined text-admin-alert text-sm">
                        cleaning_services
                      </span>
                      <span className="text-[11px] text-admin-alert font-medium">
                        {t("cleaningPending")}
                      </span>
                    </div>
                  )}
                  {villa._count.rates === 0 && (
                    <div className="flex items-center gap-2 p-2 rounded bg-amber-900/20 border border-amber-900/30">
                      <span className="material-symbols-outlined text-admin-pending text-sm">
                        payments
                      </span>
                      <span className="text-[11px] text-admin-pending font-medium">
                        {t("noRates")}
                      </span>
                    </div>
                  )}
                  <div className="pt-4 border-t border-admin-bg">
                    <Link
                      href={`/villas/${villa.id}`}
                      className={
                        pending
                          ? "block text-center w-full bg-admin-primary hover:bg-admin-primary-dark text-white font-bold py-2.5 rounded-lg text-sm transition-colors"
                          : "block text-center w-full border border-admin-border text-white hover:bg-admin-border font-bold py-2.5 rounded-lg text-sm transition-colors"
                      }
                    >
                      {pending ? t("review") : t("detail")}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 (b9) */}
      {total > 0 && (
        <div className="mt-12 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <span className="text-sm text-admin-muted">
            {t("count", { total, from, to })}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Link
                href={pageHref(Math.max(1, page - 1))}
                aria-label={t("prevPage")}
                className="w-8 h-8 flex items-center justify-center rounded bg-admin-card text-admin-muted hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-sm">chevron_left</span>
              </Link>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Link
                  key={p}
                  href={pageHref(p)}
                  className={
                    p === page
                      ? "w-8 h-8 flex items-center justify-center rounded bg-admin-primary text-white font-bold text-xs"
                      : "w-8 h-8 flex items-center justify-center rounded bg-admin-card text-admin-muted hover:text-white font-bold text-xs"
                  }
                >
                  {p}
                </Link>
              ))}
              <Link
                href={pageHref(Math.min(totalPages, page + 1))}
                aria-label={t("nextPage")}
                className="w-8 h-8 flex items-center justify-center rounded bg-admin-card text-admin-muted hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
