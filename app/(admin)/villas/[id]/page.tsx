// /villas/[id] — 운영자 빌라 상세·승인·요율 편집 (T1.2, Stitch b10-villa-detail 변환)
// RSC: prisma 직접 조회. 요율 편집·승인 액션은 클라이언트 컴포넌트 + fetch
// 제외(계약): iCal URL 관리(T1.6), 사진 추가·교체, isSellable 토글(T3.4)
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatVnd, formatDateTime } from "@/lib/format";
import { minibarItemName } from "@/lib/minibar";
import type { PhotoSpace } from "@prisma/client";
import type { FeatureCategoryKey } from "@/lib/features";
import type { BedTypeKey } from "@/lib/bedding";
import RatePeriodEditor, { type RatePeriodInitial } from "./rate-period-editor";
import VillaActions from "./villa-actions";
import ForceSellableAction from "./force-sellable-action";
import DetailTabs from "./detail-tabs";
import { CoachMark, TourHelpButton } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";
import SalesEditor, { type SalesInitial } from "./sales-editor";
import AdminAmenitiesEditor from "./amenities-editor";
import MinibarStockEditor, { type MinibarStockItem } from "./minibar-stock-editor";
import NameViEditor from "./name-vi-editor";
import CleaningInfoEditor from "./cleaning-info-editor";
import CleanerAssignEditor from "./cleaner-assign-editor";
import PhotoGallery from "./photo-gallery";
import CollapsibleCard from "@/components/admin/collapsible-card";

const SPACE_ORDER: PhotoSpace[] = [
  "EXTERIOR",
  "LIVING",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "BALCONY",
  "POOL",
  "ETC",
];

const STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
  ACTIVE: "bg-green-500/10 text-green-500 border border-green-500/20",
  INACTIVE: "bg-slate-500/10 text-slate-400 border border-slate-500/20",
  DRAFT: "bg-slate-500/10 text-slate-400 border border-slate-500/20",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("pageTitles");
  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { name: true },
  });
  return {
    title: villa ? `${villa.name} — Villa Go` : `${t("villaDetail")} — Villa Go`,
  };
}

export default async function VillaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // S-RBAC-3: STAFF는 요율의 판매가·마진 비공개(원가만) — select·렌더 모두에서 제외 (1차 서버 방어)
  const session = await auth();
  const showFinance = canViewFinance(session?.user?.role);
  // tTour — 코치마크 문구(RSC 번역 → props, ADMIN_CLIENT_NAMESPACES 무변경)
  const [t, tList, tTour, locale, villa, fxSetting, auditLogs, minibarStandard] = await Promise.all([
    getTranslations("adminVillas.detail"),
    getTranslations("adminVillas.list"),
    getTranslations("tour"),
    getLocale(),
    prisma.villa.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true, phone: true, zaloUserId: true } },
        photos: {
          orderBy: [{ space: "asc" }, { sortOrder: "asc" }],
          select: { id: true, space: true, spaceLabel: true, url: true },
        },
        amenities: {
          orderBy: { category: "asc" },
          // unitPrice(미니바 고객청구가)·note는 관리자 편집용으로 포함 (원가·마진 아님 — 누수 무관)
          // customLabelKo = custom 라벨 ko 저장형 번역(null=미번역). 편집기에서 "번역 (vi원문)" 병기용.
          select: { id: true, category: true, itemKey: true, customLabel: true, customLabelKo: true, quantity: true, unitPrice: true, note: true },
        },
        // 판매정보 (ADR-0011) — ADMIN 상세는 wifi 포함 OK (운영 화면, /p 공개페이지만 제외)
        bedroomDetails: {
          orderBy: { roomIndex: "asc" },
          select: { roomIndex: true, roomLabel: true, bedType: true, bedCount: true, capacity: true, bathroomCount: true },
        },
        features: { select: { category: true, featureKey: true } },
        // #2c 빌라별 미니바 비치수량 오버라이드 — 가격 아님(수량만), 누수 무관
        minibarStocks: { select: { minibarItemId: true, qty: true } },
      },
    }),
    prisma.appSetting.findUnique({ where: { key: "FX_VND_PER_KRW" } }),
    prisma.auditLog.findMany({
      where: { entity: "Villa", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        action: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    // 회사표준 미니바(#2b, ADR-0016) — 전 빌라 공통 1세트. 빌라와 무관하게 active 품목을 읽어 상세에 표시.
    //   unitPriceVnd(=우리 판매가)는 RSC에서 canViewFinance일 때만 렌더 → 클라이언트로 직렬화되지 않음(원칙2).
    prisma.minibarItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, nameKo: true, nameVi: true, unitPriceVnd: true, stockQty: true },
    }),
  ]);

  if (!villa) notFound();

  // 청소 담당자 지정용 CLEANER 목록(미삭제) — 빌라 단위 배정 select 옵션
  const cleanerOptions = await prisma.user.findMany({
    where: { role: "CLEANER", deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true },
  });

  // 사진을 공간별로 그룹화 (b10 — 공간별 섹션)
  const photoGroups = SPACE_ORDER.map((space) => ({
    space,
    photos: villa.photos.filter((p) => p.space === space),
  })).filter((g) => g.photos.length > 0);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // STAFF용 원가 읽기뷰 행 (판매가·마진 없음). ADR-0014 — VillaRatePeriod 원가(기본요금+웃돈기간).
  //   원가 전용 select(supplierCostVnd만) — STAFF 누수 불변식 유지.
  //   showFinance면 우측 편집기가 기간을 보여주므로 이 읽기뷰 쿼리는 생략(불필요 조회 방지).
  const costRatePeriods = showFinance
    ? []
    : await prisma.villaRatePeriod.findMany({
        where: { villaId: id },
        orderBy: [{ isBase: "desc" }, { startDate: "asc" }],
        select: { id: true, season: true, isBase: true, startDate: true, endDate: true, supplierCostVnd: true },
      });
  const costOnlyRows = costRatePeriods.map((r) => ({
    key: r.id,
    season: r.season,
    dateRange: r.startDate && r.endDate ? `${iso(r.startDate)} ~ ${iso(r.endDate)}` : null,
    supplierCostVnd: r.supplierCostVnd,
  }));

  const fxVndPerKrw = fxSetting ? Number.parseFloat(fxSetting.value) || null : null;

  // 기간별 요금 (ADR-0014) — 판매가 포함이라 canViewFinance(showFinance)일 때만 로드(누수 차단).
  // 초기값: VillaRatePeriod 기본요금(base) 행. 없으면 빈 폼(공급자 원가 입력 전 빌라).
  let ratePeriodInitial: RatePeriodInitial = { base: null, periods: [] };
  if (showFinance) {
    const rpRows = await prisma.villaRatePeriod.findMany({
      where: { villaId: id },
      orderBy: [{ isBase: "desc" }, { startDate: "asc" }],
      select: {
        season: true, isBase: true, startDate: true, endDate: true, label: true,
        supplierCostVnd: true, marginType: true, marginValue: true, salePriceVnd: true, salePriceKrw: true,
        // ADR-0031 소비자 직판가 (운영자 전용 — showFinance 게이트 안, 누수 아님)
        consumerMarginType: true, consumerMarginValue: true, consumerSalePriceVnd: true, consumerSalePriceKrw: true,
      },
    });
    // ADR-0031 — 소비자가 필드 매핑(null=빈값 → 편집기에서 Net 폴백 표기)
    const consumerFields = (r: (typeof rpRows)[number]) => ({
      consumerMarginType: r.consumerMarginType,
      consumerMarginValue: r.consumerMarginValue.toString(),
      consumerSalePriceVnd: r.consumerSalePriceVnd != null ? r.consumerSalePriceVnd.toString() : "",
      consumerSalePriceKrw: r.consumerSalePriceKrw ?? 0,
    });
    const baseRow = rpRows.find((r) => r.isBase);
    ratePeriodInitial = {
      base: baseRow
        ? {
            season: baseRow.season,
            supplierCostVnd: baseRow.supplierCostVnd.toString(),
            marginType: baseRow.marginType,
            marginValue: baseRow.marginValue.toString(),
            salePriceVnd: baseRow.salePriceVnd.toString(),
            salePriceKrw: baseRow.salePriceKrw,
            ...consumerFields(baseRow),
            label: baseRow.label ?? "",
          }
        : null,
      periods: rpRows
        .filter((r) => !r.isBase)
        .map((r) => ({
          season: r.season,
          startDate: r.startDate ? iso(r.startDate) : "",
          endDate: r.endDate ? iso(r.endDate) : "",
          supplierCostVnd: r.supplierCostVnd.toString(),
          marginType: r.marginType,
          marginValue: r.marginValue.toString(),
          salePriceVnd: r.salePriceVnd.toString(),
          salePriceKrw: r.salePriceKrw,
          ...consumerFields(r),
          label: r.label ?? "",
        })),
    };
  }

  // 비품 편집기 초기값 (Batch A — 관리자 CRUD). 사전 항목 수량 맵 + custom 행 배열.
  //   #2b: 미니바는 회사표준(MinibarItem)으로 분리 — 빌라별 미니바 행은 편집 대상 아님(스킵).
  //   ★ custom(공급자 직접입력) 행은 별도 배열로 넘겨 편집기가 전체교체 PATCH에 반드시 되돌려 보내게 한다
  //     (빠뜨리면 관리자 저장 시 공급자가 입력한 custom이 삭제됨 — 계약 완료기준 3).
  const amenityQuantities: Record<string, number> = {};
  const initialCustoms: {
    label: string;
    labelKo: string | null;
    quantity: number;
    category: string;
  }[] = [];
  for (const a of villa.amenities) {
    if (a.category === "MINIBAR") continue;
    if (a.itemKey === "custom") {
      // customLabel 없는 레거시/오염 행은 식별 불가 → 스킵(서버는 custom에 customLabel 필수)
      if (a.customLabel) {
        initialCustoms.push({
          label: a.customLabel,
          labelKo: a.customLabelKo,
          quantity: a.quantity,
          category: a.category,
        });
      }
      continue;
    }
    amenityQuantities[`${a.category}:${a.itemKey}`] = a.quantity;
  }

  // 회사표준 미니바 + 빌라별 수량 오버라이드(#2c) — 편집기 초기값.
  //   qty = 이 빌라의 오버라이드(있으면) ?? 회사표준 stockQty. 가격은 finance 권한자만 문자열로 전달(원칙2).
  const villaStockMap = new Map(villa.minibarStocks.map((s) => [s.minibarItemId, s.qty]));
  const minibarEditorItems: MinibarStockItem[] = minibarStandard.map((m) => ({
    id: m.id,
    label: minibarItemName(m, locale),
    standardQty: m.stockQty,
    qty: villaStockMap.get(m.id) ?? m.stockQty,
    priceLabel: showFinance ? `${formatVnd(m.unitPriceVnd)}` : null,
  }));

  // 판매정보 폼 초기값 (ADR-0011) — BigInt·정수는 문자열 변환(클라이언트 경계 직렬화)
  const salesInitial: SalesInitial = {
    source: villa.source,
    googleMapUrl: villa.googleMapUrl ?? "",
    beachDistanceM: villa.beachDistanceM != null ? String(villa.beachDistanceM) : "",
    areaSqm: villa.areaSqm != null ? String(villa.areaSqm) : "",
    floors: villa.floors != null ? String(villa.floors) : "",
    checkInTime: villa.checkInTime,
    checkOutTime: villa.checkOutTime,
    smokingAllowed: villa.smokingAllowed,
    petsAllowed: villa.petsAllowed,
    partyAllowed: villa.partyAllowed,
    parkingSlots: villa.parkingSlots,
    baseDepositVnd: villa.baseDepositVnd != null ? villa.baseDepositVnd.toString() : "",
    wifiSsid: villa.wifiSsid ?? "",
    wifiPassword: villa.wifiPassword ?? "",
    extraBedAvailable: villa.extraBedAvailable,
    hasPool: villa.hasPool,
    commonBathrooms: villa.commonBathrooms,
    bedrooms: villa.bedroomDetails.map((b) => ({
      roomIndex: b.roomIndex,
      roomLabel: b.roomLabel,
      bedType: b.bedType as BedTypeKey,
      bedCount: b.bedCount,
      capacity: b.capacity,
      bathroomCount: b.bathroomCount,
    })),
    features: villa.features.map((f) => ({
      category: f.category as FeatureCategoryKey,
      featureKey: f.featureKey,
    })),
  };

  const header = (
    <div>
      {/* 상세 헤더 (b10) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <Link
            href="/villas"
            className="inline-flex items-center gap-1 text-xs text-admin-muted hover:text-white transition-colors mb-3"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            {t("back")}
          </Link>
          {/* 코치마크 앵커 — 제목+상태 배지 행(항상 렌더) */}
          <div data-tour="vdetail-title" className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-black text-white tracking-tight">{villa.name}</h1>
            <span
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold shrink-0 ${STATUS_BADGE_CLASS[villa.status]}`}
            >
              {tList(`status.${villa.status}`)}
            </span>
            {villa.status === "ACTIVE" && !villa.isSellable && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold shrink-0 bg-red-500/10 text-red-500 border border-red-500/20">
                {tList("notSellable")}
              </span>
            )}
            {villa.status === "ACTIVE" && villa.isSellable && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold shrink-0 bg-green-500/10 text-green-500 border border-green-500/20">
                {tList("sellable")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="material-symbols-outlined text-sm">person</span>
              <span>{villa.supplier?.name ?? tList("noSupplier")}</span>
            </div>
            <div className="w-px h-3 bg-slate-700" />
            {villa.supplier?.zaloUserId ? (
              <div className="flex items-center gap-1.5 text-admin-primary whitespace-nowrap">
                <span className="material-symbols-outlined text-sm">chat_bubble</span>
                <span>{t("zaloConnected")}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500 whitespace-nowrap">
                <span className="material-symbols-outlined text-sm">chat_bubble</span>
                <span>{t("zaloNotConnected")}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2">
          <div className="flex items-center gap-2">
            {/* 코치마크 "?" — 동적 route라 사이드바 공용 매핑이 못 잡음 → tourId 명시(T-7) */}
            <TourHelpButton
              tourId="villaDetail"
              label={tTour("help")}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white active:scale-95"
            />
            {/* 강제 판매가능 (ADR-0012) — ACTIVE이며 아직 판매불가일 때만 노출 */}
            {villa.status === "ACTIVE" && !villa.isSellable && (
              <ForceSellableAction villaId={villa.id} />
            )}
            <VillaActions villaId={villa.id} status={villa.status} />
          </div>
        </div>
      </div>
    </div>
  );

  const overview = (
    <div>
      {/* 2단 레이아웃 (b10) */}
      <div className="grid grid-cols-12 gap-8">
        {/* 좌측: 사진 + 기본 정보 */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* 공간별 사진 그리드 — 기본 펼침 */}
          <CollapsibleCard
            title={t("photos.title")}
            icon="collections"
            defaultOpen
            headerMeta={
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {t("photos.count", { count: villa.photos.length })}
              </span>
            }
          >
            {photoGroups.length === 0 ? (
              <p className="text-sm text-admin-muted py-6 text-center">{t("photos.empty")}</p>
            ) : (
              <PhotoGallery groups={photoGroups} />
            )}
          </CollapsibleCard>

          {/* 기본 정보 요약 */}
          <CollapsibleCard title={t("info.title")} icon="info">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-center">
                <span className="material-symbols-outlined text-slate-400 block mb-1">bed</span>
                <span className="text-xs text-slate-300 font-medium whitespace-nowrap">
                  {t("info.bedrooms", { n: villa.bedrooms })}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-center">
                <span className="material-symbols-outlined text-slate-400 block mb-1">bathroom</span>
                <span className="text-xs text-slate-300 font-medium whitespace-nowrap">
                  {t("info.bathrooms", { n: villa.bathrooms })}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-center">
                <span className="material-symbols-outlined text-slate-400 block mb-1">group</span>
                <span className="text-xs text-slate-300 font-medium whitespace-nowrap">
                  {t("info.maxGuests", { n: villa.maxGuests })}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-center">
                <span className="material-symbols-outlined text-slate-400 block mb-1">pool</span>
                <span className="text-xs text-slate-300 font-medium whitespace-nowrap">
                  {villa.hasPool ? t("info.poolYes") : t("info.poolNo")}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-center">
                <span className="material-symbols-outlined text-slate-400 block mb-1">restaurant</span>
                <span className="text-xs text-slate-300 font-medium whitespace-nowrap">
                  {villa.breakfastAvailable ? t("info.breakfastYes") : t("info.breakfastNo")}
                </span>
              </div>
            </div>
            {/* 승인 판단용 보조 정보 — 단지·주소·월 임대 시세 */}
            {(villa.complex || villa.address || villa.monthlyRentVnd != null) && (
              <dl className="mt-5 pt-5 border-t border-slate-800 space-y-2 text-sm">
                {villa.complex && (
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-slate-500">{t("info.complex")}</dt>
                    <dd className="text-slate-300">{villa.complex}</dd>
                  </div>
                )}
                {villa.address && (
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-slate-500">{t("info.address")}</dt>
                    <dd className="text-slate-300">{villa.address}</dd>
                  </div>
                )}
                {villa.monthlyRentVnd != null && (
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-slate-500">{t("info.monthlyRent")}</dt>
                    <dd className="text-slate-300 tabular-nums">
                      {formatVnd(villa.monthlyRentVnd)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </CollapsibleCard>

          {/* 베트남어 병기명 (ADR-0020) — Gemini 제안 + ADMIN 확정. 비운영자 화면에 병기 */}
          <NameViEditor villaId={villa.id} name={villa.name} initialNameVi={villa.nameVi} />

          {/* 청소 담당자 지정 (T-villa-cleaner-assign) — 빌라별 담당 CLEANER. 미지정이면 공급자 담당 */}
          <CleanerAssignEditor
            villaId={villa.id}
            initialCleanerId={villa.cleanerId}
            cleaners={cleanerOptions}
          />

          {/* 청소직원용 운영정보 (T-cleaner-features C·D) — 주소·출입정보·청소 특이사항. 배정 청소직원 전용 */}
          <CleaningInfoEditor
            villaId={villa.id}
            initialAddress={villa.address}
            initialAccessType={villa.accessType}
            initialAccessInfo={villa.accessInfo}
            initialCleaningNotes={villa.cleaningNotes}
          />
        </div>

        {/* 우측: 요율 + 비품 + 수정 이력 */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* 기간별 요금 (ADR-0014) — 편집은 가격설정 권한(canViewFinance). STAFF는 원가 읽기뷰로 강등 */}
          {showFinance ? (
            <RatePeriodEditor villaId={villa.id} fxVndPerKrw={fxVndPerKrw} initial={ratePeriodInitial} />
          ) : (
            <CollapsibleCard
              title={t("rates.title")}
              icon="payments"
              headerMeta={
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 text-[10px] font-bold whitespace-nowrap">
                  {t("amenitiesCard.readOnly")}
                </span>
              }
            >
              {costOnlyRows.length === 0 ? (
                <p className="text-sm text-admin-muted text-center">{t("rates.empty")}</p>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/50 text-slate-500 uppercase">
                      <th className="px-3 py-3 font-bold border-b border-slate-800">
                        {t("rates.colSeason")}
                      </th>
                      <th className="px-3 py-3 font-bold border-b border-slate-800 text-right">
                        {t("rates.colCost")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {costOnlyRows.map((row) => (
                      <tr key={row.key}>
                        <td className="px-3 py-4">
                          <span className="px-2 py-0.5 rounded font-bold whitespace-nowrap bg-slate-800 text-slate-300">
                            {t(`rates.seasons.${row.season}`)}
                          </span>
                          {row.dateRange && (
                            <span className="ml-2 text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                              {row.dateRange}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-4 text-right text-slate-300 whitespace-nowrap tabular-nums">
                          {formatVnd(row.supplierCostVnd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CollapsibleCard>
          )}

          {/* 비품 현황 — 관리자 편집 가능 (Batch A). 미니바는 회사표준(#2b)으로 분리 */}
          <AdminAmenitiesEditor
            villaId={villa.id}
            initialQuantities={amenityQuantities}
            initialCustoms={initialCustoms}
          />

          {/* 회사표준 미니바 + 빌라별 수량 (#2b/#2c) — 품목·단가는 회사표준 1세트(설정→미니바),
              비치 수량만 이 빌라에 맞게 조정(냉장고 크기·재고 차이). 단가는 finance 권한자만 표시(원칙2). */}
          <MinibarStockEditor villaId={villa.id} items={minibarEditorItems} />

          {/* 수정 이력 (AuditLog — b10 Action Log) */}
          {auditLogs.length > 0 && (
            <CollapsibleCard title={t("history.title")} icon="history">
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-slate-400 italic whitespace-nowrap tabular-nums">
                      {formatDateTime(log.createdAt)}
                    </span>
                    <span className="text-slate-200 truncate">
                      {log.user?.name ?? t("history.system")}:{" "}
                      {["CREATE", "UPDATE", "DELETE"].includes(log.action)
                        ? t(`history.actions.${log.action}`)
                        : log.action}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          )}
        </div>
      </div>
    </div>
  );

  const sales = <SalesEditor villaId={villa.id} maxGuests={villa.maxGuests} initial={salesInitial} />;

  return (
    <div>
      {header}
      <DetailTabs overview={overview} sales={sales} />
      {/* 코치마크 투어 — 테오 7기능(요금·비품·미니바·청소담당·운영정보·wifi·잠자리) 안내(T-7) */}
      <CoachMark
        tourId="villaDetail"
        steps={buildTourSteps(tTour, "villaDetail")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}
