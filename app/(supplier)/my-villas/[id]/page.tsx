// 공급자 빌라 상세 (T1.10, SPEC F1) — design/stitch/a10-villa-detail 변환 (읽기 전용)
// 소유 검증: villa.supplierId !== 세션 → notFound() (존재 비노출). 비SUPPLIER redirect
// 누수 방지(leak-checklist): VillaRate는 supplierCostVnd만 select.
//   salePriceVnd·salePriceKrw·marginValue·marginType은 절대 미조회·미노출 (select 화이트리스트로 구조적 보장)
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { AmenityCategory, SeasonType } from "@prisma/client";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";
import { SPACE_ICON, SPACE_LABEL_KEY } from "@/lib/photo-spaces";
import PhotoGrid from "./photo-grid";
import type { LightboxPhoto } from "./photo-lightbox";
import {
  SupplierVillaSalesSection,
  type SupplierVillaSalesLabels,
} from "./villa-sales-section";
import type { BedTypeKey } from "@/lib/bedding";

// 시즌 표시 순서 (비수기 → 성수기 → 극성수기). PEAK는 강조색
const SEASON_ORDER: SeasonType[] = ["LOW", "HIGH", "PEAK"];

/** 빌라 조회 (소유 검증 포함). rates는 supplierCostVnd만 — 판매가·마진 미조회 */
async function getVilla(id: string, supplierId: string) {
  const villa = await prisma.villa.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      name: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      hasPool: true,
      breakfastAvailable: true,
      status: true,
      isSellable: true,
      rejectionReason: true, // 반려 사유 (T1.2b) — REJECTED일 때만 카드 표시
      photos: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, space: true, spaceLabel: true, url: true },
      },
      amenities: {
        select: { category: true },
      },
      // 누수 차단 — supplierCostVnd만. sale/margin 필드는 select에 부재
      rates: {
        select: { season: true, supplierCostVnd: true },
      },
      // 판매정보 표시 (ADR-0011, a16) — 누수 무관 필드만.
      // ⛔ wifiSsid·wifiPassword 미포함(§4.3 체크인 전용), salePriceVnd·salePriceKrw·marginType·marginValue 미포함(사업원칙 2)
      googleMapUrl: true,
      beachDistanceM: true,
      areaSqm: true,
      floors: true,
      checkInTime: true,
      checkOutTime: true,
      smokingAllowed: true,
      petsAllowed: true,
      partyAllowed: true,
      parkingSlots: true,
      baseDepositVnd: true,
      extraBedAvailable: true,
      bedroomDetails: {
        orderBy: [{ roomIndex: "asc" }],
        select: { roomIndex: true, bedType: true, bedCount: true },
      },
      features: {
        select: { category: true, featureKey: true },
      },
    },
  });
  // 존재 비노출: 없거나 타인 소유면 동일하게 404
  if (!villa || villa.supplierId !== supplierId) return null;
  return villa;
}

type BadgeKind = "active" | "notSellable" | "rejected" | "pending" | "inactive";

function resolveBadge(
  status: "DRAFT" | "PENDING_REVIEW" | "REJECTED" | "ACTIVE" | "INACTIVE",
  isSellable: boolean
): BadgeKind {
  if (status === "ACTIVE") return isSellable ? "active" : "notSellable";
  if (status === "REJECTED") return "rejected";
  if (status === "INACTIVE") return "inactive";
  return "pending"; // DRAFT · PENDING_REVIEW
}

const BADGE_CLASS: Record<BadgeKind, string> = {
  active: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  notSellable: "border border-rose-200 bg-rose-50 text-rose-700",
  rejected: "bg-rose-100 text-rose-800 border border-rose-300",
  pending: "bg-amber-50 text-amber-700 border border-amber-100",
  inactive: "bg-neutral-100 text-neutral-600 border border-neutral-200",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await auth();
  if (session?.user?.role !== "SUPPLIER" || !session.user.id) {
    return { title: "Villa" };
  }
  const { id } = await params;
  const villa = await getVilla(id, session.user.id);
  return { title: villa?.name ?? "Villa" };
}

export default async function VillaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const { id } = await params;
  const villa = await getVilla(id, session.user.id);
  if (!villa) notFound();

  const t = await getTranslations({ locale, namespace: "villaDetail" });
  const tPhoto = await getTranslations({ locale, namespace: "wizard.photos" });
  // 상태 라벨은 myVillas.status.* 재사용 (중복 정의 금지)
  const tStatus = await getTranslations({ locale, namespace: "myVillas.status" });
  // 판매정보 섹션 라벨 (a16) — sales/rules/bedding/features 4개 네임스페이스 번역자 주입
  const tSales = await getTranslations({ locale, namespace: "villaDetail.sales" });
  const tRule = await getTranslations({ locale, namespace: "villaRules" });
  const tBed = await getTranslations({ locale, namespace: "bedding" });
  const tFeature = await getTranslations({ locale, namespace: "features.items" });
  const salesLabels: SupplierVillaSalesLabels = {
    s: (key, values) => tSales(key, values),
    rule: (key, values) => tRule(key, values),
    bed: (bedType: BedTypeKey) => tBed(bedType),
    feature: (featureKey) => tFeature(featureKey),
  };

  const badge = resolveBadge(villa.status, villa.isSellable);

  // 비품 카테고리별 개수
  const amenityCount: Record<AmenityCategory, number> = {
    KITCHEN: 0,
    BATHROOM: 0,
    APPLIANCE: 0,
    MINIBAR: 0,
  };
  for (const a of villa.amenities) amenityCount[a.category] += 1;
  const amenityTotal = villa.amenities.length;

  // 침실/욕실 번호 매김 — 같은 공간 N번째 라벨 생성용. 라이트박스 캡션·아이콘 사전 계산.
  let bedroomNo = 0;
  let bathroomNo = 0;
  const lightboxPhotos: LightboxPhoto[] = villa.photos.map((photo) => {
    let caption: string;
    if (photo.space === "BEDROOM") {
      bedroomNo += 1;
      caption = photo.spaceLabel || tPhoto("bedroom", { n: bedroomNo });
    } else if (photo.space === "BATHROOM") {
      bathroomNo += 1;
      caption = photo.spaceLabel || tPhoto("bathroom", { n: bathroomNo });
    } else {
      const key = SPACE_LABEL_KEY[photo.space];
      caption = photo.spaceLabel || (key ? tPhoto(key) : "");
    }
    return {
      id: photo.id,
      url: photo.url,
      caption,
      icon: SPACE_ICON[photo.space] ?? "image",
    };
  });

  // 시즌 원가 — supplierCostVnd(BigInt) → 점 구분 문자열. 정의된 시즌만, 순서 고정
  const rateBySeason = new Map(villa.rates.map((r) => [r.season, r.supplierCostVnd]));

  return (
    <div className="mx-auto w-full max-w-[420px]">
      {/* TopAppBar (a10) — 뒤로가기 + 빌라명 */}
      <header className="sticky top-0 z-40 flex h-14 w-full items-center bg-white px-2 shadow-sm">
        <Link
          href="/my-villas"
          aria-label={t("basicInfo")}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:bg-neutral-50 active:scale-95"
        >
          <span className="material-symbols-outlined text-teal-600">arrow_back</span>
        </Link>
        <h1 className="flex-1 truncate px-1 text-center text-lg font-semibold text-teal-600">
          {villa.name}
        </h1>
        <div className="h-10 w-10" />
      </header>

      <main className="px-4 pb-28 pt-4">
        {/* 상태 배지 */}
        <div className="mb-4">
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${BADGE_CLASS[badge]}`}
          >
            {tStatus(badge)}
          </span>
        </div>

        {/* 반려 사유 + 수정·재제출 (T1.2b) — REJECTED일 때만. 사유는 운영자 입력, 재제출 시 클리어 */}
        {villa.status === "REJECTED" && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-center gap-2 text-rose-700">
              <span className="material-symbols-outlined icon-fill">error</span>
              <h3 className="font-semibold">{t("rejectionTitle")}</h3>
            </div>
            {villa.rejectionReason && (
              <p className="mt-2 whitespace-pre-line text-sm text-rose-800">
                {villa.rejectionReason}
              </p>
            )}
            <Link
              href={`/my-villas/${villa.id}/edit`}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-rose-700 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-lg">edit</span>
              {t("editResubmit")}
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {/* 1. 기본 정보 */}
          <div className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <span className="material-symbols-outlined icon-fill">info</span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-neutral-800">{t("basicInfo")}</h3>
                <p className="text-sm text-neutral-500">
                  {t("rooms", {
                    bedrooms: villa.bedrooms,
                    bathrooms: villa.bathrooms,
                    guests: villa.maxGuests,
                  })}
                </p>
              </div>
            </div>
            {(villa.hasPool || villa.breakfastAvailable) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {villa.hasPool && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
                    <span className="material-symbols-outlined text-base">pool</span>
                    {t("pool")}
                  </span>
                )}
                {villa.breakfastAvailable && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    <span className="material-symbols-outlined text-base">restaurant</span>
                    {t("breakfast")}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 2. 사진 그리드 — 탭 시 라이트박스(a11), "관리" 진입(a12) */}
          <div className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-teal-600">image</span>
                <h3 className="font-semibold text-neutral-800">{t("photos")}</h3>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">
                  {t("photoCount", { count: villa.photos.length })}
                </span>
              </div>
              <Link
                href={`/my-villas/${villa.id}/photos`}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
              >
                <span className="material-symbols-outlined text-base">photo_library</span>
                {t("managePhotos")}
              </Link>
            </div>
            {villa.photos.length === 0 ? (
              <p className="py-4 text-center text-sm text-neutral-400">{t("noPhotos")}</p>
            ) : (
              <PhotoGrid photos={lightboxPhotos} />
            )}
          </div>

          {/* 3. 비품 요약 — "수정" 진입(T6.4) */}
          <div className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <span className="material-symbols-outlined">countertops</span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-neutral-800">{t("amenities")}</h3>
                {amenityTotal === 0 ? (
                  <p className="text-xs text-neutral-400">{t("noAmenities")}</p>
                ) : (
                  <p className="text-xs leading-tight text-neutral-500">
                    {t("amenitySummary", {
                      kitchen: amenityCount.KITCHEN,
                      bathroom: amenityCount.BATHROOM,
                      appliance: amenityCount.APPLIANCE,
                      minibar: amenityCount.MINIBAR,
                    })}
                  </p>
                )}
              </div>
              <Link
                href={`/my-villas/${villa.id}/amenities`}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                {t("editAmenities")}
              </Link>
            </div>
          </div>

          {/* 4. 원가 (Giá gốc) — supplierCostVnd만. 판매가·마진 부재. "원가·시즌 관리" 진입(a15) */}
          <div className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-teal-600">payments</span>
                <h3 className="font-semibold text-neutral-800">{t("price")}</h3>
              </div>
              <Link
                href={`/my-villas/${villa.id}/cost`}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                {t("manageCost")}
              </Link>
            </div>
            <div className="space-y-1">
              {SEASON_ORDER.map((season, idx) => {
                const cost = rateBySeason.get(season);
                if (cost === undefined) return null;
                const isPeak = season === "PEAK";
                return (
                  <div
                    key={season}
                    className={`flex items-center justify-between py-2 ${
                      idx < SEASON_ORDER.length - 1 ? "border-b border-neutral-50" : ""
                    }`}
                  >
                    <span
                      className={`text-sm ${
                        isPeak ? "font-semibold text-neutral-700" : "text-neutral-600"
                      }`}
                    >
                      {t(`season.${season}`)}
                    </span>
                    <span
                      className={`font-bold tabular-nums ${
                        isPeak ? "text-amber-600" : "text-teal-700"
                      }`}
                    >
                      {formatVnd(cost.toString())}₫
                    </span>
                  </div>
                );
              })}
            </div>
            {/* 기간별 원가 (ADR-0014) — 같은 시즌을 여러 기간으로 나눠 원가 입력 */}
            <Link
              href={`/my-villas/${villa.id}/rate-periods`}
              className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-teal-200 py-2.5 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50"
            >
              <span className="material-symbols-outlined text-base">date_range</span>
              {t("manageRatePeriods")}
            </Link>
          </div>

          {/* 5. 판매정보 (읽기 전용, a16) — 기존 섹션 아래. 와이파이·판매가·마진 부재 */}
          <SupplierVillaSalesSection
            villa={{
              maxGuests: villa.maxGuests,
              googleMapUrl: villa.googleMapUrl,
              beachDistanceM: villa.beachDistanceM,
              areaSqm: villa.areaSqm,
              floors: villa.floors,
              checkInTime: villa.checkInTime,
              checkOutTime: villa.checkOutTime,
              smokingAllowed: villa.smokingAllowed,
              petsAllowed: villa.petsAllowed,
              partyAllowed: villa.partyAllowed,
              parkingSlots: villa.parkingSlots,
              baseDepositVnd: villa.baseDepositVnd,
              extraBedAvailable: villa.extraBedAvailable,
              bedroomDetails: villa.bedroomDetails as {
                roomIndex: number;
                bedType: BedTypeKey;
                bedCount: number;
              }[],
              features: villa.features as {
                category: import("@/lib/features").FeatureCategoryKey;
                featureKey: string;
              }[],
            }}
            labels={salesLabels}
          />
        </div>
      </main>
    </div>
  );
}
