// /villas — 운영자 빌라 목록 (T1.2, Stitch b9-villas-list 변환)
// RSC: prisma 직접 조회. 상태 필터 탭 + 승인 대기 카운트 + 카드 그리드(b9, 모바일 1열 카드)
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { BedType, Prisma, VillaStatus } from "@prisma/client";
import VillasFilters from "./villas-filters";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";
import { findFreeVillaIds } from "@/lib/availability";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { BED_TYPES } from "@/lib/bedding";
import { FEATURE_ITEMS } from "@/lib/features";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("villas")} — Villa Go` };
}


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

/** 사전 화이트리스트 — URL로 들어온 임의 태그 키 주입 차단 */
const VALID_FEATURE_KEYS = new Set(
  Object.values(FEATURE_ITEMS).flat().map((f) => f.featureKey)
);

/** 양수 정수만 통과(그 외 undefined) — minBedrooms·minGuests·beach 파싱 */
function toPosInt(v?: string): number | undefined {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default async function VillasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getTranslations("adminVillas.list");
  // 코치마크 문구 — RSC 번역 → props (ADMIN_CLIENT_NAMESPACES 무변경)
  const tTour = await getTranslations("tour");
  const params = await searchParams;
  const tab = params.status && params.status in TAB_STATUS ? params.status : "all";
  const statusFilter = TAB_STATUS[tab];
  const area = params.area?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const supplierId = params.supplier?.trim() || undefined;
  const { page, pageSize, skip, take } = parsePageParams(params);

  // ── 상세·판매정보 필터 (T-villa-search-expansion §A) ──
  const minBedrooms = toPosInt(params.minBedrooms);
  const minGuests = toPosInt(params.minGuests);
  const pool = params.pool === "1";
  const breakfast = params.breakfast === "1";
  const sellable = params.sellable === "1";
  const bedType =
    params.bedType && (BED_TYPES as readonly string[]).includes(params.bedType)
      ? (params.bedType as BedType)
      : undefined;
  const beach = toPosInt(params.beach); // 해변거리 상한(m). null(미입력) 빌라는 lte가 자동 제외
  const tags = (params.tags?.split(",").map((s) => s.trim()).filter((k) => VALID_FEATURE_KEYS.has(k))) ?? [];

  // 날짜별 공실 — ci/co 둘 다 유효하고 ci<co 일 때만 적용(한쪽만·역전이면 무시, 500 금지)
  const ci = params.ci ? parseUtcDateOnly(params.ci) : null;
  const co = params.co ? parseUtcDateOnly(params.co) : null;
  const dateRangeValid = !!(ci && co && ci.getTime() < co.getTime());

  // 검색 조건 — 공급자(정확 id) + 지역(단지명 complex) + 텍스트(빌라명·베트남명·단지·주소·공급자명) + 상세 필터.
  // 상태와 분리해 두어 탭 카운트도 검색 범위 안에서 집계한다.
  const searchWhere: Prisma.VillaWhereInput = {
    ...(supplierId ? { supplierId } : {}),
    ...(area ? { complex: area } : {}),
    ...(minBedrooms ? { bedrooms: { gte: minBedrooms } } : {}),
    ...(minGuests ? { maxGuests: { gte: minGuests } } : {}),
    ...(pool ? { hasPool: true } : {}),
    ...(breakfast ? { breakfastAvailable: true } : {}),
    // "판매가능만" — 날짜 무관하게도 판매가능(검수 게이트 통과) 빌라만. isSellable=true는 ACTIVE에서만 참.
    ...(sellable ? { isSellable: true } : {}),
    ...(bedType ? { bedroomDetails: { some: { bedType } } } : {}),
    ...(beach ? { beachDistanceM: { lte: beach } } : {}),
    // 셀링포인트 태그 — 각각 features some (다중 AND, 모두 보유한 빌라만)
    ...(tags.length ? { AND: tags.map((k) => ({ features: { some: { featureKey: k } } })) } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { nameVi: { contains: q, mode: "insensitive" as const } },
            { complex: { contains: q, mode: "insensitive" as const } },
            { address: { contains: q, mode: "insensitive" as const } },
            { supplier: { is: { name: { contains: q, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  // 날짜별 공실 freeIds 를 searchWhere 에 접어 넣어 목록·total·groupBy 3자가 동일 결과를 공유한다.
  // freeIds 후보 선정에 searchWhere(q·속성)를 선반영해 결과를 축소(성능·정합). requireSellable=sellable 토글.
  let freeIds: string[] | null = null;
  if (dateRangeValid) {
    freeIds = await findFreeVillaIds(
      prisma,
      { checkIn: ci!, checkOut: co! },
      { requireSellable: sellable, villaWhere: searchWhere }
    );
  }
  const scopedWhere: Prisma.VillaWhereInput =
    freeIds !== null ? { ...searchWhere, id: { in: freeIds } } : searchWhere;

  const where: Prisma.VillaWhereInput = {
    ...scopedWhere,
    ...(statusFilter ? { status: statusFilter } : { status: { in: LISTED_STATUSES } }),
  };

  const [villas, total, statusCounts, complexRows, supplierCountRows] = await Promise.all([
    prisma.villa.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        name: true,
        complex: true,
        status: true,
        isSellable: true,
        bedrooms: true,
        hasPool: true,
        breakfastAvailable: true,
        supplier: { select: { id: true, name: true, deletedAt: true } },
        // 첫 사진 — PhotoSpace enum 정의 순서상 EXTERIOR 우선
        photos: {
          orderBy: [{ space: "asc" }, { sortOrder: "asc" }],
          take: 1,
          select: { url: true },
        },
        _count: { select: { ratePeriods: true } },
      },
    }),
    prisma.villa.count({ where }),
    prisma.villa.groupBy({
      by: ["status"],
      where: { status: { in: LISTED_STATUSES }, ...scopedWhere },
      _count: { _all: true },
    }),
    // 지역(area) 옵션 = 운영 목록 대상 빌라의 단지명(complex) distinct
    prisma.villa.findMany({
      where: { status: { in: LISTED_STATUSES }, complex: { not: null } },
      distinct: ["complex"],
      orderBy: { complex: "asc" },
      select: { complex: true },
    }),
    // 공급자 필터 옵션 = 운영 목록 대상 빌라의 공급자별 빌라 수 (현재 필터와 무관하게 전체 목록 제공)
    prisma.villa.groupBy({
      by: ["supplierId"],
      where: { status: { in: LISTED_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const areaOptions = complexRows
    .map((r) => r.complex)
    .filter((c): c is string => !!c);

  // 공급자 옵션 — id별 빌라 수 + 이름·삭제여부 병합 (이름순). 베트남 이름 타이핑 회피용 드롭다운.
  const supplierUsers = await prisma.user.findMany({
    where: { id: { in: supplierCountRows.map((r) => r.supplierId) } },
    select: { id: true, name: true, deletedAt: true },
  });
  const supplierOptions = supplierCountRows
    .map((r) => {
      const u = supplierUsers.find((s) => s.id === r.supplierId);
      return u ? { id: u.id, name: u.name, count: r._count._all, deleted: !!u.deletedAt } : null;
    })
    .filter((o): o is { id: string; name: string; count: number; deleted: boolean } => o !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const countOf = (s: VillaStatus) =>
    statusCounts.find((c) => c.status === s)?._count._all ?? 0;
  const tabCounts: Record<string, number> = {
    all: statusCounts.reduce((sum, c) => sum + c._count._all, 0),
    pending: countOf("PENDING_REVIEW"),
    active: countOf("ACTIVE"),
    inactive: countOf("INACTIVE"),
  };

  // 탭 링크 — 기존 searchParams 를 전부 복제한 뒤 status·page 만 조정한다.
  // (신규 필터 파라미터 ci/co·minBedrooms·tags 등 유실 방지 — 완료기준 9)
  const tabHref = (key: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (k === "status" || k === "page") continue; // status 는 아래서 설정, page 는 1 리셋
      sp.set(k, v);
    }
    if (key !== "all") sp.set("status", key);
    const qs = sp.toString();
    return qs ? `/villas?${qs}` : "/villas";
  };

  // 필터가 하나라도 걸려 있으면 빈 결과 문구를 "검색 조건" 버전으로
  const hasAnyFilter = Boolean(
    area || q || supplierId || minBedrooms || minGuests || pool || breakfast ||
      sellable || bedType || beach || tags.length || dateRangeValid
  );

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
          <div className="flex shrink-0 items-center justify-between gap-3">
            {/* 필터 행이 넓어져도 제목이 두 줄로 꺾이지 않게 — 축소·줄바꿈 금지 */}
            <h1 className="whitespace-nowrap text-2xl font-bold text-white">{t("title")}</h1>
            {/* 대행 등록 — 운영자가 공급자 명의로 신규 빌라 등록(마법사 isAdmin 모드 → PENDING_REVIEW) */}
            <Link
              href="/my-villas/new"
              // 코치마크 이중앵커(모바일 쪽) — 데스크톱에선 display:none → 비가시 스킵, 가시 쪽 자동 선택
              data-tour="villas-new"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-admin-primary-dark lg:hidden"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t("newVilla")}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <VillasFilters areas={areaOptions} suppliers={supplierOptions} />
            <Link
              href="/my-villas/new"
              data-tour="villas-new"
              className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-admin-primary-dark lg:inline-flex"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t("newVilla")}
            </Link>
          </div>
        </div>
        <div
          data-tour="villas-tabs"
          className="flex items-center gap-2 border-b border-admin-card overflow-x-auto scrollbar-none"
        >
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
          {hasAnyFilter ? t("emptyFiltered") : t("empty")}
          {beach ? (
            <p className="mt-2 text-xs text-admin-muted">{t("beachDistanceNote")}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 왼쪽 썸네일 + 접기/펴기 리스트 (PC·모바일 공통, Nike 패턴) */}
          {villas.map((villa, villaIdx) => {
            const inactive = villa.status === "INACTIVE";
            const pending = villa.status === "PENDING_REVIEW";
            const photoUrl = villa.photos[0]?.url;
            const needsCleaning = villa.status === "ACTIVE" && !villa.isSellable;
            const noRates = villa._count.ratePeriods === 0;
            return (
              <details
                key={villa.id}
                // 코치마크 앵커 — 첫 카드만. 빈 목록이면 자동 스킵
                data-tour={villaIdx === 0 ? "villas-row" : undefined}
                className={`group bg-admin-card rounded-xl border border-slate-800 overflow-hidden ${
                  inactive ? "opacity-80" : ""
                }`}
              >
                <summary className="list-none cursor-pointer select-none flex items-center gap-3 sm:gap-4 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
                  {/* 왼쪽 썸네일 */}
                  <div
                    className={`relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg overflow-hidden bg-slate-800 ${
                      inactive ? "grayscale" : ""
                    }`}
                  >
                    {photoUrl ? (
                      <Image
                        src={photoUrl}
                        alt={villa.name}
                        fill
                        sizes="(min-width: 640px) 80px, 64px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <span className="material-symbols-outlined">villa</span>
                      </div>
                    )}
                  </div>
                  {/* 본문 */}
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {villa.complex && (
                          <span className="block text-[10px] text-admin-muted uppercase tracking-wider font-bold truncate">
                            {villa.complex}
                          </span>
                        )}
                        <h3 className="text-sm sm:text-base font-bold text-white truncate">{villa.name}</h3>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded uppercase ${STATUS_BADGE_CLASS[villa.status] ?? "bg-admin-inactive text-white"}`}
                      >
                        {t(`status.${villa.status}`)}
                      </span>
                    </div>
                    <span className="text-xs text-admin-muted truncate">
                      {villa.supplier?.name ?? t("noSupplier")}
                      {villa.supplier?.deletedAt && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 text-[9px] font-bold align-middle whitespace-nowrap">
                          {t("supplierDeleted")}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] text-admin-muted">
                      <span className="inline-flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">bed</span>
                        {villa.bedrooms}
                      </span>
                      {villa.hasPool && (
                        <span className="material-symbols-outlined text-[14px]">pool</span>
                      )}
                      {villa.breakfastAvailable && (
                        <span className="material-symbols-outlined text-[14px]">restaurant</span>
                      )}
                      {needsCleaning && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/20 text-admin-alert font-medium">
                          <span className="material-symbols-outlined text-[14px]">cleaning_services</span>
                          {t("cleaningPending")}
                        </span>
                      )}
                      {noRates && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-900/20 text-admin-pending font-medium">
                          <span className="material-symbols-outlined text-[14px]">payments</span>
                          {t("noRates")}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* chevron */}
                  <span
                    className="material-symbols-outlined shrink-0 text-slate-500 text-xl transition-transform group-open:rotate-180"
                    aria-hidden
                  >
                    expand_more
                  </span>
                </summary>
                {/* 펼침 상세 — 상세/검수 버튼.
                    경고(청소 검수·요율 미설정)는 요약 행 뱃지에서 항상 보이므로 여기선 중복 제거. */}
                <div className="px-3 pb-3 pt-1 border-t border-slate-800/60 flex flex-col gap-2">
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
              </details>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(10/20/30/50/100) + 숫자 페이지 */}
      <PaginationBar total={total} page={page} pageSize={pageSize} />

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-5) */}
      <CoachMark
        tourId="adminVillas"
        steps={buildTourSteps(tTour, "adminVillas")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}
