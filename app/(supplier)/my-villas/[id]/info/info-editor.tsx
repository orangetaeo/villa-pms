"use client";

// 공급자 이용규칙·위치/규모 자가 편집기 (라이트·vi) — PATCH /api/villas/[id]/info
// 운영자 SalesEditor(다크)와 분리. 공급자가 만질 수 있는 사실 속성만:
//   체크인/아웃·금연/반려동물/파티·주차·보증금·엑스트라베드 + 지도·해변거리·면적·층수.
// 누수 0: 판매가·마진·요율 미참조. source·features·wifi는 폼에 없음(운영자 영역).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { minutesToHHMM, hhmmToMinutes, buildTimeOptions } from "@/lib/sales-display";
import { formatThousands } from "@/lib/format";
import MapEmbed from "@/components/villa/map-embed";

const TIME_OPTIONS = buildTimeOptions();

export interface InfoInitial {
  checkInTime: number;
  checkOutTime: number;
  smokingAllowed: boolean;
  petsAllowed: boolean;
  partyAllowed: boolean;
  parkingSlots: number;
  baseDepositVnd: string; // VND 동 단위 숫자 문자열 (빈 = 미입력)
  extraBedAvailable: boolean;
  googleMapUrl: string;
  beachDistanceM: string;
  areaSqm: string;
  floors: string;
}

export default function VillaInfoEditor({
  villaId,
  initial,
}: {
  villaId: string;
  initial: InfoInitial;
}) {
  const t = useTranslations("supplierInfo");
  const router = useRouter();

  const [checkInTime, setCheckInTime] = useState(minutesToHHMM(initial.checkInTime));
  const [checkOutTime, setCheckOutTime] = useState(minutesToHHMM(initial.checkOutTime));
  const [smokingAllowed, setSmokingAllowed] = useState(initial.smokingAllowed);
  const [petsAllowed, setPetsAllowed] = useState(initial.petsAllowed);
  const [partyAllowed, setPartyAllowed] = useState(initial.partyAllowed);
  const [parkingSlots, setParkingSlots] = useState(initial.parkingSlots);
  const [baseDepositVnd, setBaseDepositVnd] = useState(initial.baseDepositVnd);
  const [extraBedAvailable, setExtraBedAvailable] = useState(initial.extraBedAvailable);
  const [googleMapUrl, setGoogleMapUrl] = useState(initial.googleMapUrl);
  const [beachDistanceM, setBeachDistanceM] = useState(initial.beachDistanceM);
  const [areaSqm, setAreaSqm] = useState(initial.areaSqm);
  const [floors, setFloors] = useState(initial.floors);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const digits = (v: string) => v.replace(/\D/g, "");
  const numOrNull = (v: string): number | null => (v === "" ? null : Number(v));

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const body = {
      checkInTime: hhmmToMinutes(checkInTime) ?? 840,
      checkOutTime: hhmmToMinutes(checkOutTime) ?? 660,
      smokingAllowed,
      petsAllowed,
      partyAllowed,
      parkingSlots,
      baseDepositVnd: baseDepositVnd === "" ? null : baseDepositVnd,
      extraBedAvailable,
      googleMapUrl: googleMapUrl.trim() || null,
      beachDistanceM: numOrNull(beachDistanceM),
      areaSqm: numOrNull(areaSqm),
      floors: numOrNull(floors),
    };
    try {
      const res = await fetch(`/api/villas/${villaId}/info`, {
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
    <div className="space-y-5 pb-32">
      {/* ④ 이용규칙 */}
      <section className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-neutral-800">
          <span className="material-symbols-outlined text-teal-600">schedule</span>
          {t("rulesTitle")}
        </h2>

        {/* 체크인/아웃 */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-500">
              {t("checkIn")}
            </span>
            <select
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              className="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800 tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-500">
              {t("checkOut")}
            </span>
            <select
              value={checkOutTime}
              onChange={(e) => setCheckOutTime(e.target.value)}
              className="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800 tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 토글 3개 */}
        <div className="space-y-2">
          <ToggleRow icon="smoking_rooms" label={t("smoking")} on={smokingAllowed} onChange={setSmokingAllowed} />
          <ToggleRow icon="pets" label={t("pets")} on={petsAllowed} onChange={setPetsAllowed} />
          <ToggleRow icon="celebration" label={t("party")} on={partyAllowed} onChange={setPartyAllowed} />
          <ToggleRow icon="add_circle" label={t("extraBed")} on={extraBedAvailable} onChange={setExtraBedAvailable} />
        </div>

        {/* 주차 */}
        <div className="mt-3 flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <span className="material-symbols-outlined text-base text-teal-600">local_parking</span>
            {t("parking")}
          </span>
          <Stepper value={parkingSlots} min={0} onChange={setParkingSlots} ariaLabel={t("parking")} />
        </div>

        {/* 기준 보증금 */}
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("deposit")}</span>
          <div className="flex h-11 items-center rounded-lg border border-neutral-200 bg-white px-3 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
            <input
              type="text"
              inputMode="numeric"
              value={baseDepositVnd ? formatThousands(baseDepositVnd) : ""}
              onChange={(e) => setBaseDepositVnd(digits(e.target.value))}
              placeholder="0"
              aria-label={t("deposit")}
              className="w-full flex-1 border-0 bg-transparent p-0 text-right text-sm tabular-nums text-neutral-800 focus:ring-0"
            />
            <span className="ml-1 text-sm text-neutral-400">₫</span>
          </div>
          <span className="mt-1 block text-[11px] text-neutral-400">{t("depositNote")}</span>
        </label>
      </section>

      {/* ③ 위치·규모 */}
      <section className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-neutral-800">
          <span className="material-symbols-outlined text-teal-600">location_on</span>
          {t("locationTitle")}
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("mapUrl")}</span>
          <input
            type="text"
            value={googleMapUrl}
            onChange={(e) => setGoogleMapUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/..."
            inputMode="url"
            className="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
          <MapEmbed
            googleMapUrl={googleMapUrl}
            title={t("mapPreview")}
            className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50"
          />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <UnitInput label={t("beachDistance")} unit="m" value={beachDistanceM} onChange={(v) => setBeachDistanceM(digits(v))} />
          <UnitInput label={t("area")} unit="㎡" value={areaSqm} onChange={(v) => setAreaSqm(digits(v))} />
          <UnitInput label={t("floors")} unit={t("floorUnit")} value={floors} onChange={(v) => setFloors(digits(v))} />
        </div>
      </section>

      {/* 저장 바 (하단 고정) */}
      <div className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-[420px] px-4">
        <div className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-white/95 p-2 shadow-lg backdrop-blur">
          {message && (
            <span
              role="status"
              className={`flex-1 px-2 text-xs font-medium ${message.ok ? "text-emerald-600" : "text-rose-500"}`}
            >
              {message.text}
            </span>
          )}
          {!message && <span className="flex-1" />}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">save</span>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 보조 컴포넌트 (라이트) ──────────────────────────
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-teal-600" : "bg-neutral-300"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

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
    <div className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
        <span className={`material-symbols-outlined text-base ${on ? "text-teal-600" : "text-neutral-400"}`}>
          {icon}
        </span>
        {label}
      </span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

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
    <div className="flex h-10 items-center rounded-lg border border-neutral-200 bg-white" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="−"
        className="flex h-10 w-9 items-center justify-center text-neutral-500 hover:text-teal-600"
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span className="w-7 text-center text-sm font-bold tabular-nums text-neutral-800">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="+"
        className="flex h-10 w-9 items-center justify-center text-neutral-500 hover:text-teal-600"
      >
        <span className="material-symbols-outlined text-sm">add</span>
      </button>
    </div>
  );
}

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
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-neutral-500">{label}</span>
      <div className="flex h-11 items-center rounded-lg border border-neutral-200 bg-white px-3 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm tabular-nums text-neutral-800 focus:ring-0"
        />
        <span className="ml-1 whitespace-nowrap text-xs text-neutral-400">{unit}</span>
      </div>
    </label>
  );
}
