// 공개 제안페이지 빌라 판매정보 표시 섹션 (ADR-0011, c1-villa-details 변환 — 라이트, 읽기전용)
// #5: 5개 언어(lib/public-i18n). lang prop으로 라벨 주입. 빌라명·면적 등 데이터는 원문 유지.
// ⚠ 와이파이(wifiSsid·wifiPassword) 절대 렌더 금지 — BE select에서 이미 제외(데이터에 없음), FE도 참조 안 함.
import { formatThousands } from "@/lib/format";
import {
  formatDistanceM,
  minutesToHHMM,
  aggregateBeds,
  countBedrooms,
} from "@/lib/sales-display";
import type { BedTypeKey } from "@/lib/bedding";
import type { FeatureCategoryKey } from "@/lib/features";
import {
  cancellationTierParts,
  cancellationTiers,
  type CancellationPolicy,
} from "@/lib/cancellation-policy";
import { PUBLIC_LABELS, BED_LABELS, FEATURE_LABELS, type PublicLang } from "@/lib/public-i18n";
import MapEmbed from "@/components/villa/map-embed";

// 아이콘만 (텍스트 아님 — 언어 무관). 라벨은 lib/public-i18n BED_LABELS/FEATURE_LABELS.
const BED_ICON: Record<BedTypeKey, string> = {
  KING: "king_bed",
  QUEEN: "bed",
  DOUBLE: "bed",
  SINGLE: "single_bed",
  TWIN: "single_bed",
  BUNK: "bed", // Material Symbols에 bunk_bed 글리프 없음 (lib/bedding.ts와 동일 사유)
};
const FEATURE_ICON: Record<string, string> = {
  viewSea: "waves",
  viewMountain: "landscape",
  viewCity: "location_city",
  bbq: "outdoor_grill",
  elevator: "elevator",
  generator: "bolt",
  kidsPool: "pool",
  privatePool: "pool",
  gym: "fitness_center",
  golfNearby: "golf_course",
  beachFront: "beach_access",
  marketNearby: "storefront",
};

export interface VillaSalesData {
  maxGuests: number;
  googleMapUrl: string | null;
  beachDistanceM: number | null;
  areaSqm: number | null;
  floors: number | null;
  checkInTime: number;
  checkOutTime: number;
  smokingAllowed: boolean;
  petsAllowed: boolean;
  partyAllowed: boolean;
  parkingSlots: number;
  baseDepositVnd: bigint | null;
  extraBedAvailable: boolean;
  bedrooms: { roomIndex: number; bedType: BedTypeKey; bedCount: number }[];
  features: { category: FeatureCategoryKey; featureKey: string }[];
}

export function VillaSalesSection({
  villa,
  cancellationPolicy,
  approxLocationName,
  lang,
}: {
  villa: VillaSalesData;
  /** 전 빌라 공용 취소·환불 정책 (#6b) — enabled일 때만 표시 */
  cancellationPolicy?: CancellationPolicy;
  /** 지도 대략 위치 캡션에 표기할 단지명(예: "Sonasea"). null이면 단지명 없이 캡션만. */
  approxLocationName?: string | null;
  lang: PublicLang;
}) {
  const t = PUBLIC_LABELS[lang].sales;
  const bedLabel = BED_LABELS[lang];
  const featLabel = FEATURE_LABELS[lang];
  const beds = aggregateBeds(villa.bedrooms);
  const bedroomCount = countBedrooms(villa.bedrooms);
  const distance = formatDistanceM(villa.beachDistanceM);

  const hasBedding = villa.bedrooms.length > 0;
  const hasLocation = villa.googleMapUrl || distance || villa.areaSqm != null || villa.floors != null;
  // 셀링포인트 칩 띠 — 사전 순서 무관, 들어온 순서대로
  const features = villa.features.filter((f) => featLabel[f.featureKey]);

  return (
    <div className="space-y-4">
      {/* ⑤ 셀링포인트 태그 띠 (강조) */}
      {features.length > 0 && (
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {features.map((f, i) => (
            <span
              key={f.featureKey}
              className={`shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
                i === 0
                  ? "bg-teal-600 text-white"
                  : "bg-teal-50 text-teal-700 border border-teal-100"
              }`}
            >
              <span
                className="material-symbols-outlined text-[16px]"
                style={i === 0 ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {FEATURE_ICON[f.featureKey]}
              </span>
              {featLabel[f.featureKey]}
            </span>
          ))}
        </div>
      )}

      {/* ② 잠자리 요약 */}
      {hasBedding && (
        <section className="rounded-xl bg-neutral-50 border border-neutral-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-neutral-800 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-teal-600">king_bed</span>
              {t.beddingTitle}
            </h4>
            <span className="text-[12px] font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-full flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">group</span>
              {t.maxGuests(villa.maxGuests)}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-[12px] font-medium bg-white border border-neutral-200 px-2.5 py-1 rounded-md text-neutral-700">
              {t.bedroomCount(bedroomCount)}
            </span>
            {beds.map(({ bedType, count }) => (
              <span
                key={bedType}
                className="text-[12px] font-medium bg-white border border-neutral-200 px-2.5 py-1 rounded-md text-neutral-700 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">{BED_ICON[bedType]}</span>
                {bedLabel[bedType]} {count}
              </span>
            ))}
          </div>
          {villa.extraBedAvailable && (
            <div className="flex items-center gap-1.5 text-[12px] text-teal-700 font-medium">
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              {t.extraBed}
            </div>
          )}
        </section>
      )}

      {/* ③ 위치 */}
      {hasLocation && (
        <section className="rounded-xl bg-neutral-50 border border-neutral-100 overflow-hidden">
          {villa.googleMapUrl && (
            <>
              {/* 지도 임베드 — 대략 위치 모드(approximate): 비로그인 열람자에게 건물 단위 핀을 주면
                  공급자 특정 → 우회예약 위험(원칙1). 좌표를 뭉개고 줌을 낮춰 "이 동네"까지만 보여준다.
                  ★ 정확 좌표로 나가던 "구글지도에서 열기" 외부 링크는 제거했다(정확 위치 유출 경로).
                  좌표 추출 가능 시에만 렌더(불가하면 아래 캡션만). */}
              <MapEmbed
                googleMapUrl={villa.googleMapUrl}
                title={t.mapView}
                approximate
                className="relative w-full overflow-hidden aspect-video bg-teal-600/5"
              />
              <div className="flex items-start gap-1.5 bg-teal-600/5 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-500">
                <span className="material-symbols-outlined text-[14px] text-teal-600 shrink-0 mt-px">
                  info
                </span>
                <span>
                  {approxLocationName && (
                    <span className="font-bold text-neutral-700">{approxLocationName} · </span>
                  )}
                  {t.mapApprox}
                </span>
              </div>
            </>
          )}
          {(distance || villa.areaSqm != null || villa.floors != null) && (
            <div className="grid grid-cols-3 divide-x divide-neutral-100 border-t border-neutral-100">
              {distance && (
                <div className="p-3 text-center">
                  <span className="material-symbols-outlined text-teal-600 text-[20px]">beach_access</span>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{t.beach}</p>
                  <p className="text-sm font-bold text-neutral-800 tabular-nums">{distance}</p>
                </div>
              )}
              {villa.areaSqm != null && (
                <div className="p-3 text-center">
                  <span className="material-symbols-outlined text-teal-600 text-[20px]">square_foot</span>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{t.area}</p>
                  <p className="text-sm font-bold text-neutral-800 tabular-nums">{villa.areaSqm}㎡</p>
                </div>
              )}
              {villa.floors != null && (
                <div className="p-3 text-center">
                  <span className="material-symbols-outlined text-teal-600 text-[20px]">stairs</span>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{t.floors}</p>
                  <p className="text-sm font-bold text-neutral-800 tabular-nums">{t.floorUnit(villa.floors)}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ④ 이용안내 (⚠ 와이파이 항목 없음 — §4.3 누수 차단) */}
      <section className="rounded-xl bg-neutral-50 border border-neutral-100 p-4">
        <h4 className="text-sm font-bold text-neutral-800 flex items-center gap-1.5 mb-3">
          <span className="material-symbols-outlined text-[18px] text-teal-600">schedule</span>
          {t.rulesTitle}
        </h4>
        {/* 체크인/아웃 */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-white rounded-lg border border-neutral-100 p-3 text-center">
            <p className="text-[11px] text-neutral-400">{t.checkIn}</p>
            <p className="text-base font-bold text-neutral-800 tabular-nums">{minutesToHHMM(villa.checkInTime)}</p>
          </div>
          <div className="bg-white rounded-lg border border-neutral-100 p-3 text-center">
            <p className="text-[11px] text-neutral-400">{t.checkOut}</p>
            <p className="text-base font-bold text-neutral-800 tabular-nums">{minutesToHHMM(villa.checkOutTime)}</p>
          </div>
        </div>
        {/* 규칙 아이콘 행 */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <RuleTile
            icon="smoking_rooms"
            on={villa.smokingAllowed}
            label={villa.smokingAllowed ? t.smokingOn : t.smokingOff}
          />
          <RuleTile
            icon="pets"
            on={villa.petsAllowed}
            label={villa.petsAllowed ? t.petsOn : t.petsOff}
          />
          <RuleTile
            icon="celebration"
            on={villa.partyAllowed}
            label={villa.partyAllowed ? t.partyOn : t.partyOff}
          />
          <RuleTile
            icon="local_parking"
            on={villa.parkingSlots > 0}
            label={villa.parkingSlots > 0 ? t.parkingOn(villa.parkingSlots) : t.parkingOff}
          />
        </div>
        {/* 보증금 안내 */}
        {villa.baseDepositVnd != null && (
          <div className="flex items-start gap-2 bg-white rounded-lg border border-neutral-100 p-3">
            <span className="material-symbols-outlined text-[18px] text-teal-600 mt-0.5">
              account_balance_wallet
            </span>
            <div>
              <p className="text-[12px] font-semibold text-neutral-800">{t.depositTitle}</p>
              <p className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">
                {t.depositBefore}
                <span className="font-bold text-neutral-700 tabular-nums">
                  {formatThousands(villa.baseDepositVnd)}₫
                </span>
                {t.depositAfter}
              </p>
            </div>
          </div>
        )}
        {/* 취소·환불 정책 (#6b) — 전 빌라 공용, enabled일 때만 */}
        {cancellationPolicy?.enabled && (
          <div className="flex items-start gap-2 bg-white rounded-lg border border-neutral-100 p-3 mt-3">
            <span className="material-symbols-outlined text-[18px] text-teal-600 mt-0.5">
              event_busy
            </span>
            <div>
              <p className="text-[12px] font-semibold text-neutral-800">{t.cancelTitle}</p>
              <ul className="text-[11px] text-neutral-500 leading-relaxed mt-1 space-y-0.5">
                {/* S3: N단계 가변 — 문구 조립은 cancellationTierLabel 한 곳(동의 화면과 공유) */}
                {cancellationTiers(cancellationPolicy).map((tier, i) => (
                  <li key={`${tier.kind}-${i}`} className="flex items-baseline gap-1.5">
                    <span className="text-teal-600 leading-none">·</span>
                    <span>
                      {cancellationTierParts(tier, t).map((part, k) => {
                        if (part.kind === "text") return <span key={k}>{part.text}</span>;
                        // 숫자·"환불 불가"는 강조 — 고지문에서 고객이 실제로 읽는 부분
                        const cls =
                          part.kind === "days"
                            ? "font-semibold text-neutral-700 tabular-nums"
                            : part.kind === "pct"
                              ? "font-bold text-neutral-700 tabular-nums"
                              : "font-bold text-neutral-700";
                        return (
                          <span key={k} className={cls}>
                            {part.text}
                          </span>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** 규칙 타일 — 가능(teal 강조) / 불가(회색) */
function RuleTile({ icon, on, label }: { icon: string; on: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 bg-white rounded-lg border border-neutral-100 py-2.5 px-1">
      <span className={`material-symbols-outlined text-[20px] ${on ? "text-teal-600" : "text-neutral-300"}`}>
        {icon}
      </span>
      <span className={`text-[11px] text-center ${on ? "font-semibold text-teal-700" : "text-neutral-500"}`}>
        {label}
      </span>
    </div>
  );
}
