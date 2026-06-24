"use client";

// 빌라 판매정보 입력 폼 (ADR-0011, b10-sales 변환 — 다크/한국어, ADMIN 전용)
// 상세 페이지 "판매정보" 탭 안에 통합. amenities-editor 칩/스테퍼 패턴 일관.
// PATCH /api/villas/[id]/sales (스칼라 14 + bedrooms[] + features[], 전체 교체).
// ⚠ 마진·판매가·KRW 절대 미포함 — 요율 탭과 분리. wifi는 ADMIN 입력 OK(공개페이지 select에서 제외됨).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FEATURE_CATEGORIES,
  FEATURE_ITEMS,
  type FeatureCategoryKey,
} from "@/lib/features";
import { BED_TYPES, type BedTypeKey } from "@/lib/bedding";
import { formatThousands } from "@/lib/format";
import {
  minutesToHHMM,
  hhmmToMinutes,
  buildTimeOptions,
  sumRoomCapacity,
} from "@/lib/sales-display";
import CollapsibleCard from "@/components/admin/collapsible-card";

// ── 클라이언트 폼 상태 타입 ────────────────────────────
interface BedRow {
  id: string; // 로컬 키
  bedType: BedTypeKey;
  bedCount: number;
}
interface BedroomCard {
  id: string; // 로컬 키
  roomLabel: string;
  capacity: number; // 0 = 미입력 취급
  bathroomCount: number; // 이 침실 전용욕실 개수 (0 = 없음)
  beds: BedRow[];
}

export interface SalesInitial {
  source: "SUPPLIER" | "DIRECT"; // 공급 출처 — DIRECT면 공실 보드에 우리 예약 표시
  googleMapUrl: string;
  beachDistanceM: string; // 숫자 문자열 (빈 = 미입력)
  areaSqm: string;
  floors: string;
  checkInTime: number; // 분 단위
  checkOutTime: number;
  smokingAllowed: boolean;
  petsAllowed: boolean;
  partyAllowed: boolean;
  parkingSlots: number;
  baseDepositVnd: string; // VND 동 단위 숫자 문자열
  wifiSsid: string;
  wifiPassword: string;
  extraBedAvailable: boolean;
  hasPool: boolean; // 수영장 유무 — 셀링포인트 풀 태그 체크 시 자동 ON (저장 시 보정)
  bedrooms: { roomIndex: number; roomLabel: string | null; bedType: BedTypeKey; bedCount: number; capacity: number | null; bathroomCount: number }[];
  features: { category: FeatureCategoryKey; featureKey: string }[];
}

interface Props {
  villaId: string;
  maxGuests: number;
  initial: SalesInitial;
}

// 체크인/아웃 30분 단위 드롭다운 옵션 (종일)
const TIME_OPTIONS = buildTimeOptions();

let localCounter = 0;
const localId = () => `r${Date.now()}_${localCounter++}`;

/** RSC가 로드한 평면 침실 행 → 침실 카드 그룹화 (roomIndex 기준) */
function groupBedrooms(rows: SalesInitial["bedrooms"]): BedroomCard[] {
  const byRoom = new Map<number, BedroomCard>();
  const order: number[] = [];
  for (const r of rows) {
    if (!byRoom.has(r.roomIndex)) {
      order.push(r.roomIndex);
      byRoom.set(r.roomIndex, {
        id: localId(),
        roomLabel: r.roomLabel ?? "",
        capacity: r.capacity ?? 0,
        bathroomCount: r.bathroomCount ?? 0,
        beds: [],
      });
    }
    byRoom.get(r.roomIndex)!.beds.push({ id: localId(), bedType: r.bedType, bedCount: r.bedCount });
  }
  return order.map((idx) => byRoom.get(idx)!);
}

export default function SalesEditor({ villaId, maxGuests, initial }: Props) {
  const t = useTranslations("adminVillas.sales");
  const tBed = useTranslations("bedding");
  const tFeat = useTranslations("features");
  const router = useRouter();

  const [rooms, setRooms] = useState<BedroomCard[]>(() => groupBedrooms(initial.bedrooms));
  const [extraBed, setExtraBed] = useState(initial.extraBedAvailable);
  const [hasPool, setHasPool] = useState(initial.hasPool);
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(
    () => new Set(initial.features.map((f) => f.featureKey))
  );

  // 셀링포인트에 풀 태그(프라이빗풀·키즈풀)가 켜지면 '수영장 있음'을 자동 반영(해제 시 자동 OFF는 안 함 — 수동 토글 존중)
  const poolFeatureOn = selectedFeatures.has("privatePool") || selectedFeatures.has("kidsPool");
  const effectiveHasPool = hasPool || poolFeatureOn;

  // ③ 위치
  const [googleMapUrl, setGoogleMapUrl] = useState(initial.googleMapUrl);
  const [beachDistanceM, setBeachDistanceM] = useState(initial.beachDistanceM);
  const [areaSqm, setAreaSqm] = useState(initial.areaSqm);
  const [floors, setFloors] = useState(initial.floors);

  // ④ 규칙
  const [checkInTime, setCheckInTime] = useState(minutesToHHMM(initial.checkInTime));
  const [checkOutTime, setCheckOutTime] = useState(minutesToHHMM(initial.checkOutTime));
  const [smokingAllowed, setSmokingAllowed] = useState(initial.smokingAllowed);
  const [petsAllowed, setPetsAllowed] = useState(initial.petsAllowed);
  const [partyAllowed, setPartyAllowed] = useState(initial.partyAllowed);
  const [parkingSlots, setParkingSlots] = useState(initial.parkingSlots);
  const [baseDepositVnd, setBaseDepositVnd] = useState(initial.baseDepositVnd);
  const [wifiSsid, setWifiSsid] = useState(initial.wifiSsid);
  const [wifiPassword, setWifiPassword] = useState(initial.wifiPassword);

  // 공급 출처 (SUPPLIER/DIRECT) — DIRECT면 공실 보드에 우리 판매예약이 표시됨
  const [source, setSource] = useState<"SUPPLIER" | "DIRECT">(initial.source);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // ── 침실 조작 ──────────────────────────────
  function addRoom() {
    setRooms((prev) => [
      ...prev,
      { id: localId(), roomLabel: "", capacity: 2, bathroomCount: 1, beds: [{ id: localId(), bedType: "KING", bedCount: 1 }] },
    ]);
  }
  function removeRoom(roomId: string) {
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
  }
  function patchRoom(roomId: string, patch: Partial<BedroomCard>) {
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r)));
  }
  function addBed(roomId: string) {
    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId ? { ...r, beds: [...r.beds, { id: localId(), bedType: "SINGLE", bedCount: 1 }] } : r
      )
    );
  }
  function patchBed(roomId: string, bedId: string, patch: Partial<BedRow>) {
    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId
          ? { ...r, beds: r.beds.map((b) => (b.id === bedId ? { ...b, ...patch } : b)) }
          : r
      )
    );
  }
  function removeBed(roomId: string, bedId: string) {
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, beds: r.beds.filter((b) => b.id !== bedId) } : r))
    );
  }

  function toggleFeature(featureKey: string) {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(featureKey)) next.delete(featureKey);
      else next.add(featureKey);
      return next;
    });
  }

  // 수용 합계 vs maxGuests 대조 (경고만)
  const capacitySum = sumRoomCapacity(
    rooms.flatMap((r, i) => [{ roomIndex: i + 1, capacity: r.capacity }])
  );

  // 전용욕실 합계 — 저장 시 Villa.bathrooms로 자동 반영 (서버도 동일 합산)
  const bathroomTotal = rooms.reduce((sum, r) => sum + r.bathroomCount, 0);

  // 숫자 문자열 정규화 (음수·비숫자 제거)
  const digits = (v: string) => v.replace(/\D/g, "");

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    // ② 침실 → 평면 행 (roomIndex 1-base, 침대 없는 침실 스킵)
    const bedrooms: SalesInitial["bedrooms"] = [];
    rooms.forEach((room, i) => {
      const roomIndex = i + 1;
      const label = room.roomLabel.trim();
      const capacity = room.capacity > 0 ? room.capacity : null;
      for (const bed of room.beds) {
        if (bed.bedCount <= 0) continue;
        bedrooms.push({
          roomIndex,
          roomLabel: label || null,
          bedType: bed.bedType,
          bedCount: bed.bedCount,
          capacity,
          bathroomCount: room.bathroomCount,
        });
      }
    });

    // ⑤ 셀링포인트 (category 정합 — 사전에서 역참조)
    const features: SalesInitial["features"] = [];
    for (const category of FEATURE_CATEGORIES) {
      for (const item of FEATURE_ITEMS[category]) {
        if (selectedFeatures.has(item.featureKey)) {
          features.push({ category, featureKey: item.featureKey });
        }
      }
    }

    // 스칼라 — 빈 문자열은 null(클리어), 숫자는 number
    const num = (v: string): number | null => (v === "" ? null : Number(v));

    const body = {
      source,
      googleMapUrl: googleMapUrl.trim() || null,
      beachDistanceM: num(beachDistanceM),
      areaSqm: num(areaSqm),
      floors: num(floors),
      checkInTime: hhmmToMinutes(checkInTime) ?? 840,
      checkOutTime: hhmmToMinutes(checkOutTime) ?? 660,
      smokingAllowed,
      petsAllowed,
      partyAllowed,
      parkingSlots,
      baseDepositVnd: baseDepositVnd === "" ? null : baseDepositVnd,
      wifiSsid: wifiSsid.trim() || null,
      wifiPassword: wifiPassword.trim() || null,
      extraBedAvailable: extraBed,
      hasPool: effectiveHasPool, // 풀 태그 켜져 있으면 자동 true (서버에서도 동일 보정)
      bedrooms,
      features,
    };

    try {
      const res = await fetch(`/api/villas/${villaId}/sales`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 저장 바 (탭 상단) */}
      <div className="flex items-center justify-end gap-3">
        {message && (
          <span
            role="status"
            className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
          >
            {message.text}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg bg-admin-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-blue-900/20 transition-all whitespace-nowrap flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">save</span>
          {saving ? t("saving") : t("save")}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* LEFT: ② 잠자리 + ⑤ 셀링포인트 */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* ② 잠자리 구성 */}
          <CollapsibleCard
            title={t("bedding.title")}
            icon="king_bed"
            action={
              <>
                <span className="text-xs text-slate-400 whitespace-nowrap">{t("bedding.extraBed")}</span>
                <Toggle on={extraBed} onChange={setExtraBed} label={t("bedding.extraBed")} />
              </>
            }
          >
            <div className="space-y-4">
              {rooms.map((room, i) => (
                <div key={room.id} className="rounded-lg bg-slate-900/40 border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-600/15 text-admin-primary text-xs font-black flex items-center justify-center tabular-nums">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={room.roomLabel}
                        onChange={(e) => patchRoom(room.id, { roomLabel: e.target.value })}
                        placeholder={t("bedding.roomLabelPlaceholder")}
                        maxLength={60}
                        aria-label={t("bedding.roomLabel")}
                        className="bg-transparent border-0 border-b border-slate-700 focus:border-blue-500 focus:ring-0 text-sm font-bold text-slate-100 px-1 py-0.5 w-44 placeholder:text-slate-600"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRoom(room.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 text-[11px] whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      {t("bedding.removeRoom")}
                    </button>
                  </div>

                  {/* 침대 행들 */}
                  <div className="space-y-2.5 mb-3">
                    {room.beds.map((bed) => (
                      <div key={bed.id} className="flex items-center gap-2">
                        <select
                          value={bed.bedType}
                          onChange={(e) => patchBed(room.id, bed.id, { bedType: e.target.value as BedTypeKey })}
                          aria-label={t("bedding.bedType")}
                          className="flex-1 bg-slate-900 border-slate-700 rounded-lg text-xs text-slate-200 focus:ring-1 focus:ring-blue-500 h-10 px-3 py-0"
                        >
                          {BED_TYPES.map((bt) => (
                            <option key={bt} value={bt}>
                              {tBed(bt)}
                            </option>
                          ))}
                        </select>
                        <Stepper
                          value={bed.bedCount}
                          min={1}
                          onChange={(n) => patchBed(room.id, bed.id, { bedCount: n })}
                          ariaLabel={t("bedding.bedCount")}
                        />
                        <button
                          type="button"
                          onClick={() => removeBed(room.id, bed.id)}
                          aria-label={t("bedding.removeBed")}
                          className="w-9 h-9 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-800 flex items-center justify-center flex-shrink-0"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => addBed(room.id)}
                    className="text-xs font-bold text-admin-primary hover:text-blue-400 flex items-center gap-1 whitespace-nowrap mb-4"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    {t("bedding.addBed")}
                  </button>

                  {/* 수용인원 */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                    <span className="text-xs text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                      <span className="material-symbols-outlined text-sm">group</span>
                      {t("bedding.capacity")}
                    </span>
                    <Stepper
                      value={room.capacity}
                      min={0}
                      onChange={(n) => patchRoom(room.id, { capacity: n })}
                      ariaLabel={t("bedding.capacity")}
                    />
                  </div>

                  {/* 전용욕실 */}
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-xs text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                      <span className="material-symbols-outlined text-sm">bathroom</span>
                      {t("bedding.bathroom")}
                    </span>
                    <Stepper
                      value={room.bathroomCount}
                      min={0}
                      onChange={(n) => patchRoom(room.id, { bathroomCount: n })}
                      ariaLabel={t("bedding.bathroom")}
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addRoom}
                className="w-full rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/30 text-slate-400 hover:text-admin-primary py-3 text-sm font-bold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-base">add</span>
                {t("bedding.addRoom")}
              </button>

              {/* maxGuests 대조 (경고만) */}
              <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-500 text-sm mt-0.5">info</span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {t.rich("bedding.capacityNote", {
                    sum: capacitySum,
                    max: maxGuests,
                    b: (chunks) => <span className="font-bold text-slate-200 tabular-nums">{chunks}</span>,
                  })}
                </p>
              </div>

              {/* 전용욕실 합계 → 빌라 총 욕실수 자동 반영 안내 */}
              <div className="p-3 bg-blue-500/5 rounded-lg border border-blue-500/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-admin-primary text-sm mt-0.5">bathroom</span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {t.rich("bedding.bathroomNote", {
                    total: bathroomTotal,
                    b: (chunks) => <span className="font-bold text-slate-200 tabular-nums">{chunks}</span>,
                  })}
                </p>
              </div>
            </div>
          </CollapsibleCard>

          {/* ⑤ 셀링포인트 */}
          <CollapsibleCard
            title={t("features.title")}
            icon="sell"
            action={
              /* 수영장 유무 — 수동 토글. 풀 태그가 켜지면 자동 ON·잠금 (해제 불가, 태그를 끄면 풀린다) */
              <>
                <span className="text-xs text-slate-400 flex items-center gap-1 whitespace-nowrap">
                  <span className="material-symbols-outlined text-sm">pool</span>
                  {t("features.hasPool")}
                </span>
                <Toggle
                  on={effectiveHasPool}
                  onChange={poolFeatureOn ? () => {} : setHasPool}
                  label={t("features.hasPool")}
                />
              </>
            }
          >
            <p className="text-xs text-slate-500 mb-4">{t("features.subtitle")}</p>
            {poolFeatureOn && (
              <p className="text-[11px] text-admin-primary mb-4 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">info</span>
                {t("features.poolAutoNote")}
              </p>
            )}
            <div className="space-y-5">
              {FEATURE_CATEGORIES.map((category) => (
                <div key={category}>
                  <p className="text-xs font-bold text-slate-500 mb-2.5 uppercase tracking-wider whitespace-nowrap">
                    {tFeat(`categories.${category}`)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {FEATURE_ITEMS[category].map((item) => {
                      const on = selectedFeatures.has(item.featureKey);
                      return (
                        <button
                          key={item.featureKey}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleFeature(item.featureKey)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-all ${
                            on
                              ? "bg-blue-600/15 text-admin-primary border border-blue-500/40"
                              : "bg-slate-900/60 text-slate-400 border border-slate-700 hover:border-slate-500"
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">{item.icon}</span>
                          {tFeat(`items.${item.featureKey}`)}
                          {on && <span className="material-symbols-outlined text-sm">check</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleCard>
        </div>

        {/* RIGHT: 출처 + ③ 위치 + ④ 규칙 */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* 공급 출처 (SUPPLIER/DIRECT) */}
          <CollapsibleCard title={t("source.title")} icon="storefront">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(["SUPPLIER", "DIRECT"] as const).map((opt) => {
                  const on = source === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setSource(opt)}
                      aria-pressed={on}
                      className={`rounded-lg border px-3 py-3 text-left transition-all ${
                        on
                          ? "border-admin-primary bg-blue-600/15 ring-1 ring-admin-primary"
                          : "border-slate-700 bg-slate-900 hover:border-slate-600"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                        <span className="material-symbols-outlined text-base">
                          {opt === "DIRECT" ? "verified" : "handshake"}
                        </span>
                        {opt === "DIRECT" ? t("source.direct") : t("source.supplier")}
                      </span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                        {opt === "DIRECT" ? t("source.directDesc") : t("source.supplierDesc")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                <span className="material-symbols-outlined text-sm">info</span>
                {t("source.hint")}
              </p>
            </div>
          </CollapsibleCard>

          {/* ③ 위치·접근성 */}
          <CollapsibleCard title={t("location.title")} icon="location_on">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 whitespace-nowrap">
                  {t("location.mapUrl")}
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    map
                  </span>
                  <input
                    type="text"
                    value={googleMapUrl}
                    onChange={(e) => setGoogleMapUrl(e.target.value)}
                    placeholder="https://maps.app.goo.gl/..."
                    className="w-full bg-slate-900 border-slate-700 rounded-lg pl-9 pr-3 h-10 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <UnitInput
                  label={t("location.beachDistance")}
                  unit="m"
                  value={beachDistanceM}
                  onChange={(v) => setBeachDistanceM(digits(v))}
                />
                <UnitInput
                  label={t("location.area")}
                  unit="㎡"
                  value={areaSqm}
                  onChange={(v) => setAreaSqm(digits(v))}
                />
                <UnitInput
                  label={t("location.floors")}
                  unit={t("location.floorUnit")}
                  value={floors}
                  onChange={(v) => setFloors(digits(v))}
                />
              </div>
            </div>
          </CollapsibleCard>

          {/* ④ 이용규칙 */}
          <CollapsibleCard title={t("rules.title")} icon="gavel">
            <div className="space-y-5">
              {/* 체크인/아웃 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 whitespace-nowrap">
                    {t("rules.checkIn")}
                  </label>
                  <select
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    aria-label={t("rules.checkIn")}
                    className="w-full bg-slate-900 border-slate-700 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 h-10 px-3 py-0 tabular-nums"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 whitespace-nowrap">
                    {t("rules.checkOut")}
                  </label>
                  <select
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    aria-label={t("rules.checkOut")}
                    className="w-full bg-slate-900 border-slate-700 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 h-10 px-3 py-0 tabular-nums"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 토글 3개 */}
              <div className="space-y-2">
                <ToggleRow icon="smoking_rooms" label={t("rules.smoking")} on={smokingAllowed} onChange={setSmokingAllowed} />
                <ToggleRow icon="pets" label={t("rules.pets")} on={petsAllowed} onChange={setPetsAllowed} />
                <ToggleRow icon="celebration" label={t("rules.party")} on={partyAllowed} onChange={setPartyAllowed} />
              </div>

              {/* 주차 */}
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-900/40 border border-slate-800">
                <span className="text-sm text-slate-200 flex items-center gap-2 whitespace-nowrap">
                  <span className="material-symbols-outlined text-base text-slate-400">local_parking</span>
                  {t("rules.parking")}
                </span>
                <Stepper value={parkingSlots} min={0} onChange={setParkingSlots} ariaLabel={t("rules.parking")} />
              </div>

              {/* 기준 보증금 */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 whitespace-nowrap">
                  {t("rules.deposit")}
                </label>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg h-10 px-3 focus-within:ring-1 focus-within:ring-blue-500">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={baseDepositVnd ? formatThousands(baseDepositVnd) : ""}
                    onChange={(e) => setBaseDepositVnd(digits(e.target.value))}
                    aria-label={t("rules.deposit")}
                    className="flex-1 w-full bg-transparent border-0 focus:ring-0 text-sm text-slate-200 text-right tabular-nums p-0"
                  />
                  <span className="text-sm text-slate-500 ml-1 whitespace-nowrap">₫</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5">{t("rules.depositNote")}</p>
              </div>

              {/* 와이파이 (공개 안 됨 경고) */}
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-amber-500 text-base">lock</span>
                    <span className="text-xs font-bold text-amber-400 whitespace-nowrap">{t("rules.wifi")}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold whitespace-nowrap">
                    {t("rules.wifiBadge")}
                  </span>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1 whitespace-nowrap">{t("rules.wifiSsid")}</label>
                    <input
                      type="text"
                      value={wifiSsid}
                      onChange={(e) => setWifiSsid(e.target.value)}
                      maxLength={100}
                      aria-label={t("rules.wifiSsid")}
                      className="w-full bg-slate-900 border-slate-700 rounded-lg px-3 h-9 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1 whitespace-nowrap">{t("rules.wifiPassword")}</label>
                    <input
                      type="text"
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      maxLength={100}
                      aria-label={t("rules.wifiPassword")}
                      className="w-full bg-slate-900 border-slate-700 rounded-lg px-3 h-9 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-amber-400/70 mt-2.5 flex items-start gap-1">
                  <span className="material-symbols-outlined text-xs mt-0.5">visibility_off</span>
                  {t("rules.wifiHint")}
                </p>
              </div>
            </div>
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}

// ── 보조 컴포넌트 ──────────────────────────────

/** iOS 스타일 토글 (b10-sales .toggle) */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? "bg-admin-primary" : "bg-slate-700"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

/** 토글 + 아이콘 + 라벨 한 줄 (규칙 토글) */
function ToggleRow({
  icon,
  label,
  on,
  onChange,
}: {
  icon: string;
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-900/40 border border-slate-800">
      <span className="text-sm text-slate-200 flex items-center gap-2 whitespace-nowrap">
        <span className="material-symbols-outlined text-base text-slate-400">{icon}</span>
        {label}
      </span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

/** 숫자 스테퍼 (−/숫자/+) — b10-sales 다크 스타일 */
function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg h-9" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="−"
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span className="w-7 text-center text-sm font-bold text-slate-100 tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="+"
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-sm">add</span>
      </button>
    </div>
  );
}

/** 단위 접미 텍스트 입력 (해변거리·면적·층수) */
function UnitInput({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 mb-1.5 whitespace-nowrap">{label}</label>
      <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg h-10 px-3 focus-within:ring-1 focus-within:ring-blue-500">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="flex-1 w-full bg-transparent border-0 focus:ring-0 text-sm text-slate-200 tabular-nums p-0 min-w-0"
        />
        <span className="text-xs text-slate-500 ml-1 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}
