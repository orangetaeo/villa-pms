// /villas/[id] — 운영자 빌라 상세·승인·요율 편집 (T1.2, Stitch b10-villa-detail 변환)
// RSC: prisma 직접 조회. 요율 편집·승인 액션은 클라이언트 컴포넌트 + fetch
// 제외(계약): iCal URL 관리(T1.6), 사진 추가·교체, isSellable 토글(T3.4)
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatVnd, formatDateTime } from "@/lib/format";
import type { PhotoSpace, SeasonType } from "@prisma/client";
import type { FeatureCategoryKey } from "@/lib/features";
import type { BedTypeKey } from "@/lib/bedding";
import RatePeriodEditor, { type RatePeriodInitial } from "./rate-period-editor";
import VillaActions from "./villa-actions";
import ForceSellableAction from "./force-sellable-action";
import DetailTabs from "./detail-tabs";
import SalesEditor, { type SalesInitial } from "./sales-editor";
import AdminAmenitiesEditor, { type AmenityCustomRow } from "./amenities-editor";
import PhotoGallery from "./photo-gallery";

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

const SEASON_ORDER: SeasonType[] = ["LOW", "HIGH", "PEAK"];

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
    title: villa ? `${villa.name} — Villa PMS` : `${t("villaDetail")} — Villa PMS`,
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
  const [t, tList, villa, fxSetting, auditLogs] = await Promise.all([
    getTranslations("adminVillas.detail"),
    getTranslations("adminVillas.list"),
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
          select: { id: true, category: true, itemKey: true, customLabel: true, quantity: true, unitPrice: true, note: true },
        },
        rates: {
          // 판매가·마진은 canViewFinance만 — STAFF면 supplierCostVnd만 select
          select: {
            season: true,
            supplierCostVnd: true,
            ...(showFinance
              ? {
                  marginType: true,
                  marginValue: true,
                  salePriceVnd: true,
                  salePriceKrw: true,
                }
              : {}),
          },
        },
        // 판매정보 (ADR-0011) — ADMIN 상세는 wifi 포함 OK (운영 화면, /p 공개페이지만 제외)
        bedroomDetails: {
          orderBy: { roomIndex: "asc" },
          select: { roomIndex: true, roomLabel: true, bedType: true, bedCount: true, capacity: true, bathroomCount: true },
        },
        features: { select: { category: true, featureKey: true } },
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
  ]);

  if (!villa) notFound();

  // 사진을 공간별로 그룹화 (b10 — 공간별 섹션)
  const photoGroups = SPACE_ORDER.map((space) => ({
    space,
    photos: villa.photos.filter((p) => p.space === space),
  })).filter((g) => g.photos.length > 0);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // STAFF용 원가 읽기뷰 행 (판매가·마진 없음).
  // ADR-0014 dual-read: 변환된 빌라는 VillaRatePeriod 원가(기본요금+웃돈기간), 미변환은
  // 기존 시즌별 VillaRate. 원가 전용 select(supplierCostVnd만) — STAFF 누수 불변식 유지.
  // showFinance면 우측 편집기가 기간을 보여주므로 이 읽기뷰 쿼리는 생략(불필요 조회 방지).
  const costRatePeriods = showFinance
    ? []
    : await prisma.villaRatePeriod.findMany({
        where: { villaId: id },
        orderBy: [{ isBase: "desc" }, { startDate: "asc" }],
        select: { id: true, season: true, isBase: true, startDate: true, endDate: true, supplierCostVnd: true },
      });
  const costOnlyRows =
    costRatePeriods.length > 0
      ? costRatePeriods.map((r) => ({
          key: r.id,
          season: r.season,
          dateRange: r.startDate && r.endDate ? `${iso(r.startDate)} ~ ${iso(r.endDate)}` : null,
          supplierCostVnd: r.supplierCostVnd,
        }))
      : SEASON_ORDER.flatMap((season) => {
          const rate = villa.rates.find((r) => r.season === season);
          if (!rate) return [];
          return [{ key: season as string, season, dateRange: null, supplierCostVnd: rate.supplierCostVnd }];
        });

  const fxVndPerKrw = fxSetting ? Number.parseFloat(fxSetting.value) || null : null;

  // 기간별 요금 (ADR-0014) — 판매가 포함이라 canViewFinance(showFinance)일 때만 로드(누수 차단).
  // 초기값: 기존 VillaRatePeriod 우선, 없으면 기존 LOW VillaRate에서 기본요금 시드(빈 폼 방지).
  let ratePeriodInitial: RatePeriodInitial = { base: null, periods: [] };
  if (showFinance) {
    const rpRows = await prisma.villaRatePeriod.findMany({
      where: { villaId: id },
      orderBy: [{ isBase: "desc" }, { startDate: "asc" }],
      select: {
        season: true, isBase: true, startDate: true, endDate: true, label: true,
        supplierCostVnd: true, marginType: true, marginValue: true, salePriceVnd: true, salePriceKrw: true,
      },
    });
    const baseRow = rpRows.find((r) => r.isBase);
    const seedLow = villa.rates.find((r) => r.season === "LOW" && "marginType" in r);
    ratePeriodInitial = {
      base: baseRow
        ? {
            season: baseRow.season,
            supplierCostVnd: baseRow.supplierCostVnd.toString(),
            marginType: baseRow.marginType,
            marginValue: baseRow.marginValue.toString(),
            salePriceVnd: baseRow.salePriceVnd.toString(),
            salePriceKrw: baseRow.salePriceKrw,
            label: baseRow.label ?? "",
          }
        : seedLow && "marginType" in seedLow
          ? {
              season: "LOW",
              supplierCostVnd: seedLow.supplierCostVnd.toString(),
              marginType: seedLow.marginType,
              marginValue: seedLow.marginValue.toString(),
              salePriceVnd: seedLow.salePriceVnd.toString(),
              salePriceKrw: seedLow.salePriceKrw,
              label: "",
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
          label: r.label ?? "",
        })),
    };
  }

  // 비품 편집기 초기값 (Batch A — 관리자 CRUD). 사전 항목은 수량 맵, 미니바는 단가 맵, custom은 별도 행.
  const amenityQuantities: Record<string, number> = {};
  const amenityUnitPrices: Record<string, string> = {};
  const amenityCustom: AmenityCustomRow[] = [];
  for (const a of villa.amenities) {
    if (a.itemKey === "custom") {
      amenityCustom.push({
        id: a.id,
        label: a.customLabel ?? "",
        quantity: a.quantity,
        unitPrice: a.unitPrice != null ? a.unitPrice.toString() : "",
      });
    } else {
      amenityQuantities[`${a.category}:${a.itemKey}`] = a.quantity;
      if (a.category === "MINIBAR" && a.unitPrice != null) {
        amenityUnitPrices[`MINIBAR:${a.itemKey}`] = a.unitPrice.toString();
      }
    }
  }

  // 판매정보 폼 초기값 (ADR-0011) — BigInt·정수는 문자열 변환(클라이언트 경계 직렬화)
  const salesInitial: SalesInitial = {
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
          <div className="flex items-center gap-3 mb-2">
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
          {/* 공간별 사진 그리드 */}
          <div className="bg-admin-card rounded-xl p-6 border border-slate-800 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold flex items-center gap-2 whitespace-nowrap">
                <span className="material-symbols-outlined text-admin-primary">collections</span>
                {t("photos.title")}
              </h2>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {t("photos.count", { count: villa.photos.length })}
              </span>
            </div>
            {photoGroups.length === 0 ? (
              <p className="text-sm text-admin-muted py-6 text-center">{t("photos.empty")}</p>
            ) : (
              <PhotoGallery groups={photoGroups} />
            )}
          </div>

          {/* 기본 정보 요약 */}
          <div className="bg-admin-card rounded-xl p-6 border border-slate-800 shadow-xl">
            <h2 className="text-lg font-bold mb-5 flex items-center gap-2 whitespace-nowrap">
              <span className="material-symbols-outlined text-admin-primary">info</span>
              {t("info.title")}
            </h2>
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
          </div>
        </div>

        {/* 우측: 요율 + 비품 + 수정 이력 */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* 기간별 요금 (ADR-0014) — 편집은 가격설정 권한(canViewFinance). STAFF는 원가 읽기뷰로 강등 */}
          {showFinance ? (
            <RatePeriodEditor villaId={villa.id} fxVndPerKrw={fxVndPerKrw} initial={ratePeriodInitial} />
          ) : (
            <div className="bg-admin-card rounded-xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex items-center gap-2">
                <h2 className="text-lg font-bold flex items-center gap-2 whitespace-nowrap">
                  <span className="material-symbols-outlined text-admin-primary">payments</span>
                  {t("rates.title")}
                </h2>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 text-[10px] font-bold whitespace-nowrap">
                  {t("amenitiesCard.readOnly")}
                </span>
              </div>
              {costOnlyRows.length === 0 ? (
                <p className="p-6 text-sm text-admin-muted text-center">{t("rates.empty")}</p>
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
            </div>
          )}

          {/* 비품 현황 — 관리자 편집 가능 (Batch A) */}
          <AdminAmenitiesEditor
            villaId={villa.id}
            initialQuantities={amenityQuantities}
            initialUnitPrices={amenityUnitPrices}
            initialCustom={amenityCustom}
          />

          {/* 수정 이력 (AuditLog — b10 Action Log) */}
          {auditLogs.length > 0 && (
            <div className="bg-admin-card/50 rounded-xl p-4 border border-slate-800/50">
              <p className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-widest whitespace-nowrap">
                {t("history.title")}
              </p>
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
            </div>
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
    </div>
  );
}
