// 공급자 빌라 상세 판매정보 표시 섹션 (ADR-0011, a16-sales-info-vi 변환 — 라이트 teal, vi, 읽기 전용)
// /my-villas/[id] 기존 섹션(기본정보·사진·비품·원가) 아래에 렌더. 공급자가 보는 vi 읽기전용 표시.
// ⚠ 와이파이(wifiSsid·wifiPassword) 절대 렌더 금지 — BE select에서 이미 제외(데이터에 없음), FE도 참조 안 함.
// ⚠ 판매가(KRW)·마진 절대 없음 — VND 현지 보증금만(고객 안내용). 사업원칙 2 준수.
// 서버 컴포넌트: 라벨은 부모 page.tsx의 getTranslations(vi) 번역자를 주입받아 사용 (client 직렬화 없음).
import { formatThousands } from "@/lib/format";
import {
  formatDistanceM,
  minutesToHHMM,
  aggregateBeds,
  countBedrooms,
} from "@/lib/sales-display";
import { BED_TYPE_META, type BedTypeKey } from "@/lib/bedding";
import { FEATURE_ITEMS, type FeatureCategoryKey } from "@/lib/features";
import MapEmbed from "@/components/villa/map-embed";

// featureKey → 아이콘 (사전 평탄화). 알 수 없는 키는 칩 자체를 숨김(라벨 사전에도 없음).
const FEATURE_ICON: Record<string, string> = Object.fromEntries(
  Object.values(FEATURE_ITEMS).flatMap((items) =>
    items.map((f) => [f.featureKey, f.icon])
  )
);

export interface SupplierVillaSalesData {
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
  bedroomDetails: { roomIndex: number; bedType: BedTypeKey; bedCount: number }[];
  features: { category: FeatureCategoryKey; featureKey: string }[];
}

// 부모 page.tsx에서 주입하는 vi 번역자 (next-intl getTranslations 결과).
// villaDetail.sales / villaRules / bedding / features 4개 네임스페이스를 함수로 받아 하드코딩 회피.
export interface SupplierVillaSalesLabels {
  /** villaDetail.sales.<key> (count·value·amount 보간 지원) */
  s: (key: string, values?: Record<string, string | number>) => string;
  /** villaRules.<key> */
  rule: (key: string, values?: Record<string, string | number>) => string;
  /** bedding.<KING|QUEEN|...> */
  bed: (bedType: BedTypeKey) => string;
  /** features.items.<featureKey> */
  feature: (featureKey: string) => string;
}

export function SupplierVillaSalesSection({
  villa,
  labels,
}: {
  villa: SupplierVillaSalesData;
  labels: SupplierVillaSalesLabels;
}) {
  const { s, rule, bed, feature } = labels;

  const beds = aggregateBeds(villa.bedroomDetails);
  const bedroomCount = countBedrooms(villa.bedroomDetails);
  const distance = formatDistanceM(villa.beachDistanceM);

  const hasBedding = villa.bedroomDetails.length > 0;
  const hasLocation =
    !!villa.googleMapUrl ||
    !!distance ||
    villa.areaSqm != null ||
    villa.floors != null;
  // 셀링포인트 칩 띠 — 사전에 있는 키만(미정의 키 무시). 들어온 순서 보존
  const features = villa.features.filter((f) => FEATURE_ICON[f.featureKey]);

  // 빈 빌라 graceful: 표시할 내용이 하나도 없으면 섹션 전체 숨김
  const hasAnything =
    features.length > 0 ||
    hasBedding ||
    hasLocation ||
    villa.baseDepositVnd != null ||
    true; // ④ 이용규칙(체크인아웃·금연 등)은 default 값이 항상 존재 → 섹션은 항상 표시
  if (!hasAnything) return null;

  return (
    <section className="px-0 pt-0">
      {/* 섹션 헤더 — 제목 + "Chỉ xem" 잠금 칩 */}
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-base font-bold text-neutral-800">
          <span
            className="material-symbols-outlined text-teal-600"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            sell
          </span>
          {s("title")}
        </h2>
        <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-400">
          <span className="material-symbols-outlined text-[14px]">lock</span>
          {s("readOnly")}
        </span>
      </div>

      <article className="overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm">
        <div className="space-y-4 p-4">
          {/* ⑤ 셀링포인트 태그 띠 (강조, 가로 스크롤) */}
          {features.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {features.map((f, i) => (
                <span
                  key={f.featureKey}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold ${
                    i === 0
                      ? "bg-teal-600 text-white"
                      : "border border-teal-100 bg-teal-50 text-teal-700"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[16px]"
                    style={i === 0 ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {FEATURE_ICON[f.featureKey]}
                  </span>
                  {feature(f.featureKey)}
                </span>
              ))}
            </div>
          )}

          {/* ② 잠자리 구성 */}
          {hasBedding && (
            <section className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-neutral-800">
                  <span className="material-symbols-outlined text-[18px] text-teal-600">
                    king_bed
                  </span>
                  {s("bedding")}
                </h4>
                <span className="flex items-center gap-1 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-[12px] font-bold text-teal-700">
                  <span className="material-symbols-outlined text-[14px]">group</span>
                  {s("maxGuests", { count: villa.maxGuests })}
                </span>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-700">
                  {s("bedroomCount", { count: bedroomCount })}
                </span>
                {beds.map(({ bedType, count }) => (
                  <span
                    key={bedType}
                    className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-neutral-700"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {BED_TYPE_META[bedType].icon}
                    </span>
                    {bed(bedType)} {count}
                  </span>
                ))}
              </div>
              {villa.extraBedAvailable && (
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-teal-700">
                  <span className="material-symbols-outlined text-[16px]">add_circle</span>
                  {s("extraBed")}
                </div>
              )}
            </section>
          )}

          {/* ③ 위치 */}
          {hasLocation && (
            <section className="overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50">
              {villa.googleMapUrl && (
                <>
                  {/* 지도 임베드 — 좌표 추출 가능 시에만 렌더(불가하면 아래 링크 배너만) */}
                  <MapEmbed
                    googleMapUrl={villa.googleMapUrl}
                    title={s("viewMap")}
                    className="relative w-full overflow-hidden aspect-video bg-teal-600/5"
                  />
                  <a
                    className="group relative block h-20 bg-teal-600/5"
                    href={villa.googleMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-bold text-teal-700 shadow-sm">
                      <span className="material-symbols-outlined text-[14px]">map</span>
                      {s("viewMap")}
                    </span>
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-teal-600">
                      <span
                        className="material-symbols-outlined text-3xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        location_on
                      </span>
                    </div>
                  </a>
                </>
              )}
              {(distance || villa.areaSqm != null || villa.floors != null) && (
                <div className="grid grid-cols-3 divide-x divide-neutral-100 border-t border-neutral-100">
                  {distance && (
                    <div className="p-3 text-center">
                      <span className="material-symbols-outlined text-[20px] text-teal-600">
                        beach_access
                      </span>
                      <p className="mt-0.5 text-[11px] text-neutral-400">{s("beachDistance")}</p>
                      <p className="text-sm font-bold text-neutral-800 tabular-nums">{distance}</p>
                    </div>
                  )}
                  {villa.areaSqm != null && (
                    <div className="p-3 text-center">
                      <span className="material-symbols-outlined text-[20px] text-teal-600">
                        square_foot
                      </span>
                      <p className="mt-0.5 text-[11px] text-neutral-400">{s("area")}</p>
                      <p className="text-sm font-bold text-neutral-800 tabular-nums">
                        {s("areaValue", { value: villa.areaSqm })}
                      </p>
                    </div>
                  )}
                  {villa.floors != null && (
                    <div className="p-3 text-center">
                      <span className="material-symbols-outlined text-[20px] text-teal-600">
                        stairs
                      </span>
                      <p className="mt-0.5 text-[11px] text-neutral-400">{s("floors")}</p>
                      <p className="text-sm font-bold text-neutral-800 tabular-nums">
                        {s("floorsValue", { count: villa.floors })}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ④ 이용규칙 (⚠ 와이파이 항목 없음 — §4.3 누수 차단) */}
          <section className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
            <h4 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-neutral-800">
              <span className="material-symbols-outlined text-[18px] text-teal-600">schedule</span>
              {s("stay")}
            </h4>
            {/* 체크인/아웃 */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-neutral-100 bg-white p-3 text-center">
                <p className="flex items-center justify-center gap-1 text-[11px] text-neutral-400">
                  <span className="material-symbols-outlined text-[14px] text-teal-600">login</span>
                  {s("checkIn")}
                </p>
                <p className="mt-0.5 text-base font-bold text-neutral-800 tabular-nums">
                  {minutesToHHMM(villa.checkInTime)}
                </p>
              </div>
              <div className="rounded-lg border border-neutral-100 bg-white p-3 text-center">
                <p className="flex items-center justify-center gap-1 text-[11px] text-neutral-400">
                  <span className="material-symbols-outlined text-[14px] text-teal-600">logout</span>
                  {s("checkOut")}
                </p>
                <p className="mt-0.5 text-base font-bold text-neutral-800 tabular-nums">
                  {minutesToHHMM(villa.checkOutTime)}
                </p>
              </div>
            </div>
            {/* 규칙 아이콘 행 (on=teal 강조 / off=회색) */}
            <div className="mb-3 grid grid-cols-4 gap-2">
              <RuleTile
                icon="smoking_rooms"
                on={villa.smokingAllowed}
                label={rule(villa.smokingAllowed ? "smokingOk" : "smokingNo")}
              />
              <RuleTile
                icon="pets"
                on={villa.petsAllowed}
                label={rule(villa.petsAllowed ? "petsOk" : "petsNo")}
              />
              <RuleTile
                icon="celebration"
                on={villa.partyAllowed}
                label={rule(villa.partyAllowed ? "partyOk" : "partyNo")}
              />
              <RuleTile
                icon="local_parking"
                on={villa.parkingSlots > 0}
                label={
                  villa.parkingSlots > 0
                    ? rule("parkingOk", { count: villa.parkingSlots })
                    : rule("parkingNo")
                }
              />
            </div>
            {/* 기준 보증금 (KRW 아님 — VND 현지 보증금만, 마진/판매가 절대 없음) */}
            {villa.baseDepositVnd != null && (
              <div className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white p-3">
                <span className="material-symbols-outlined mt-0.5 text-[18px] text-teal-600">
                  account_balance_wallet
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-neutral-800">{s("depositTitle")}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                    {s("depositNote", { amount: formatThousands(villa.baseDepositVnd) })}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* 읽기전용 안내 (작게) — "정보 수정은 운영자에게" */}
          <div className="flex items-center gap-2 px-1 pt-1">
            <span className="material-symbols-outlined text-[16px] text-neutral-400">info</span>
            <p className="text-[11px] leading-snug text-neutral-400">{s("managedNote")}</p>
          </div>
        </div>
      </article>
    </section>
  );
}

/** 규칙 타일 — 가능(teal 강조) / 불가(회색) */
function RuleTile({ icon, on, label }: { icon: string; on: boolean; label: string }) {
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-lg border bg-white py-3 ${
        on ? "border-teal-100" : "border-neutral-100"
      }`}
    >
      <span
        className={`material-symbols-outlined text-[22px] ${on ? "text-teal-600" : "text-neutral-300"}`}
      >
        {icon}
      </span>
      <span
        className={`text-center text-[11px] ${on ? "font-semibold text-teal-700" : "text-neutral-400"}`}
      >
        {label}
      </span>
    </div>
  );
}
