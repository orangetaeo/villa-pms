"use client";

// 2 잠자리 구성 (T-bedroom-composition-sync) — 방별 구성이 진실의 원천.
// "침실 몇 개?" 스테퍼 → 방 카드 자동 생성 → 침대종류 아이콘 칩+개수 스테퍼(셀렉트 금지, sales-editor 칩 차용).
// capacity 자동 추론(펼침에서만 수동), 전용욕실 토글, 방 밖 공용욕실 스테퍼, 읽기전용 요약 배지.
// 서버 파생 규칙(lib/bedding)과 동일 계산으로 침실·욕실·인원을 파생 — maxGuests 스테퍼 없음.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BED_TYPES, BED_TYPE_META, type BedTypeKey } from "@/lib/bedding";
import {
  autoRoomCapacity,
  defaultRoom,
  deriveWizardScalars,
  type BedRowState,
  type BedroomCardState,
  type WizardState,
} from "./wizard-types";
import { InlineGuide } from "@/components/inline-guide";

const MAX_ROOMS = 20;
const MAX_ENSUITE = 5;
const MAX_COMMON = 10;

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}

export default function StepBedding({ state, update, onNext }: Props) {
  const t = useTranslations("wizard.bedding");
  const tw = useTranslations("wizard");
  const tBed = useTranslations("bedding");

  const rooms = state.rooms;
  const common = state.commonBathrooms;

  // 방·공용욕실 변경 시 파생 스칼라(bedrooms/bathrooms/maxGuests)를 함께 갱신 —
  // 사진 슬롯 수·body 스칼라가 항상 방 구성과 일치하도록.
  function commit(nextRooms: BedroomCardState[], nextCommon: number) {
    update({
      rooms: nextRooms,
      commonBathrooms: nextCommon,
      ...deriveWizardScalars(nextRooms, nextCommon),
    });
  }

  // ── 침실 수 스테퍼 ──────────────────────────────
  function setRoomCount(n: number) {
    const count = Math.max(1, Math.min(MAX_ROOMS, n));
    let next: BedroomCardState[];
    if (count > rooms.length) {
      next = [...rooms];
      while (next.length < count) next.push(defaultRoom());
    } else {
      next = rooms.slice(0, count); // 축소 시 뒤 방부터 제거
    }
    commit(next, common);
  }

  // ── 방 카드 조작 ────────────────────────────────
  function patchRoom(id: string, mutate: (r: BedroomCardState) => BedroomCardState) {
    const next = rooms.map((r) => {
      if (r.id !== id) return r;
      const m = mutate(r);
      // 수동 조정 전이면 침대 기준으로 capacity 자동 재계산
      return m.capacityManual ? m : { ...m, capacity: autoRoomCapacity(m.beds) };
    });
    commit(next, common);
  }

  function toggleBed(roomId: string, bedType: BedTypeKey) {
    patchRoom(roomId, (r) => {
      const has = r.beds.some((b) => b.bedType === bedType);
      if (has) {
        // 마지막 남은 침대는 제거 불가(방엔 침대 최소 1개)
        if (r.beds.length <= 1) return r;
        return { ...r, beds: r.beds.filter((b) => b.bedType !== bedType) };
      }
      return { ...r, beds: [...r.beds, { bedType, bedCount: 1 }] };
    });
  }

  function setBedCount(roomId: string, bedType: BedTypeKey, n: number) {
    patchRoom(roomId, (r) => {
      if (n < 1) {
        if (r.beds.length <= 1) return r; // 마지막 침대는 0으로 못 내림
        return { ...r, beds: r.beds.filter((b) => b.bedType !== bedType) };
      }
      const beds: BedRowState[] = r.beds.map((b) =>
        b.bedType === bedType ? { ...b, bedCount: Math.min(20, n) } : b
      );
      return { ...r, beds };
    });
  }

  function setEnsuite(roomId: string, on: boolean) {
    patchRoom(roomId, (r) => ({ ...r, bathroomCount: on ? Math.max(1, r.bathroomCount) : 0 }));
  }
  function setEnsuiteCount(roomId: string, n: number) {
    patchRoom(roomId, (r) => ({ ...r, bathroomCount: Math.max(1, Math.min(MAX_ENSUITE, n)) }));
  }

  function setCapacity(roomId: string, n: number) {
    patchRoom(roomId, (r) => ({ ...r, capacity: Math.max(1, Math.min(50, n)), capacityManual: true }));
  }
  function resetCapacity(roomId: string) {
    patchRoom(roomId, (r) => ({ ...r, capacityManual: false, capacity: autoRoomCapacity(r.beds) }));
  }

  const scalars = deriveWizardScalars(rooms, common);

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-32 pt-6">
        <h2 className="mb-4 px-1 text-2xl font-bold text-neutral-900">{t("title")}</h2>

        {/* 인라인 가이드 — 침실·침대·욕실이 사진 슬롯 수를 결정하는 의존성 예고(step-basic에서 이동) */}
        <InlineGuide text={t("guide")} />

        {/* 읽기전용 요약 배지 — 서버 파생 규칙과 동일 계산 */}
        <div className="mt-5 flex items-center gap-2 rounded-xl border-2 border-teal-100 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-800">
          <span className="material-symbols-outlined text-teal-600">summarize</span>
          <span className="tabular-nums">
            {t("summary", { b: scalars.bedrooms, ba: scalars.bathrooms, g: scalars.maxGuests })}
          </span>
        </div>

        {/* 침실 수 스테퍼 */}
        <section className="mt-6 flex items-center justify-between rounded-xl border-2 border-neutral-100 bg-white p-5">
          <div>
            <h3 className="font-semibold text-neutral-800">{t("roomCount")}</h3>
            <p className="text-xs text-neutral-400">{t("roomCountHint")}</p>
          </div>
          <Stepper value={rooms.length} min={1} max={MAX_ROOMS} onChange={setRoomCount} ariaLabel={t("roomCount")} big />
        </section>

        {/* 방 카드 목록 */}
        <div className="mt-5 space-y-5">
          {rooms.map((room, i) => (
            <div key={room.id} className="rounded-2xl border-2 border-neutral-100 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-sm font-black tabular-nums text-teal-700">
                  {i + 1}
                </span>
                <h3 className="text-base font-bold text-neutral-800">{t("roomTitle", { n: i + 1 })}</h3>
              </div>

              {/* 침대종류 아이콘 칩 + 개수 스테퍼 */}
              <p className="mb-2 px-0.5 text-xs font-semibold text-neutral-500">{t("bedTypeTitle")}</p>
              <div className="flex flex-wrap gap-2">
                {BED_TYPES.map((bt) => {
                  const bed = room.beds.find((b) => b.bedType === bt);
                  const on = !!bed;
                  return on ? (
                    // 선택됨 — 칩 안에 −/개수/+ (셀렉트 없음)
                    <span
                      key={bt}
                      className="flex items-center gap-1 rounded-full border-2 border-teal-500 bg-teal-50 py-1 pl-3 pr-1 text-sm font-semibold text-teal-700"
                    >
                      <span className="material-symbols-outlined text-base">{BED_TYPE_META[bt].icon}</span>
                      <span className="whitespace-nowrap">{tBed(bt)}</span>
                      <button
                        type="button"
                        onClick={() => setBedCount(room.id, bt, bed.bedCount - 1)}
                        aria-label={`${tBed(bt)} −`}
                        className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-teal-600 active:scale-90"
                      >
                        <span className="material-symbols-outlined text-lg">remove</span>
                      </button>
                      <span className="w-5 text-center text-base font-bold tabular-nums">{bed.bedCount}</span>
                      <button
                        type="button"
                        onClick={() => setBedCount(room.id, bt, bed.bedCount + 1)}
                        aria-label={`${tBed(bt)} +`}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white active:scale-90"
                      >
                        <span className="material-symbols-outlined text-lg">add</span>
                      </button>
                    </span>
                  ) : (
                    // 미선택 — 탭하면 추가
                    <button
                      key={bt}
                      type="button"
                      onClick={() => toggleBed(room.id, bt)}
                      className="flex items-center gap-1.5 rounded-full border-2 border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-500 active:scale-95"
                    >
                      <span className="material-symbols-outlined text-base">{BED_TYPE_META[bt].icon}</span>
                      <span className="whitespace-nowrap">{tBed(bt)}</span>
                    </button>
                  );
                })}
              </div>

              {/* 전용욕실 토글 (+ 2개 이상 펼침 스테퍼) */}
              <div className="mt-4 rounded-xl bg-neutral-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                    <span className={`material-symbols-outlined ${room.bathroomCount > 0 ? "text-teal-600" : "text-neutral-400"}`}>
                      bathroom
                    </span>
                    {t("ensuite")}
                  </span>
                  <Toggle on={room.bathroomCount > 0} onChange={(v) => setEnsuite(room.id, v)} label={t("ensuite")} />
                </div>
                {room.bathroomCount > 0 && (
                  <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3">
                    <span className="text-xs text-neutral-500">{t("ensuiteCount")}</span>
                    <Stepper
                      value={room.bathroomCount}
                      min={1}
                      max={MAX_ENSUITE}
                      onChange={(n) => setEnsuiteCount(room.id, n)}
                      ariaLabel={t("ensuiteCount")}
                    />
                  </div>
                )}
              </div>

              {/* 기준 인원 — 자동 표시 + "인원 조정" 펼침 */}
              <CapacityRow
                capacity={room.capacity}
                manual={room.capacityManual}
                labels={{
                  capacity: t("capacity"),
                  auto: t("capacityAuto"),
                  adjust: t("capacityAdjust"),
                  reset: t("capacityReset"),
                }}
                onChange={(n) => setCapacity(room.id, n)}
                onReset={() => resetCapacity(room.id)}
              />
            </div>
          ))}
        </div>

        {/* 공용 욕실 (방 카드 밖) */}
        <section className="mt-5 flex items-center justify-between rounded-xl border-2 border-neutral-100 bg-white p-5">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-neutral-800">
              <span className="material-symbols-outlined text-teal-600">wc</span>
              {t("commonBathrooms")}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-400">{t("commonBathroomsHint")}</p>
          </div>
          <Stepper
            value={common}
            min={0}
            max={MAX_COMMON}
            onChange={(n) => commit(rooms, Math.max(0, Math.min(MAX_COMMON, n)))}
            ariaLabel={t("commonBathrooms")}
          />
        </section>
      </main>

      {/* 하단 고정: 계속 */}
      <footer className="pb-safe fixed bottom-0 left-0 z-50 w-full border-t border-neutral-100 bg-white p-4 shadow-[0_-8px_20px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={onNext}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-lg font-bold text-white shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98]"
          >
            <span>{tw("continue")}</span>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </footer>
    </>
  );
}

// ── 보조 컴포넌트 (라이트) ─────────────────────────

function CapacityRow({
  capacity,
  manual,
  labels,
  onChange,
  onReset,
}: {
  capacity: number;
  manual: boolean;
  labels: { capacity: string; auto: string; adjust: string; reset: string };
  onChange: (n: number) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-xl bg-neutral-50 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <span className="material-symbols-outlined text-teal-600">group</span>
          {labels.capacity}
          <span className="text-base font-bold tabular-nums text-neutral-900">{capacity}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-0.5 text-xs font-semibold text-teal-600 active:scale-95"
        >
          {labels.adjust}
          <span className="material-symbols-outlined text-base">{open ? "expand_less" : "expand_more"}</span>
        </button>
      </div>
      {open && (
        <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3">
          <button
            type="button"
            onClick={onReset}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              manual ? "bg-white text-neutral-500 ring-1 ring-neutral-200" : "bg-teal-100 text-teal-700"
            }`}
          >
            {labels.auto}
          </button>
          <Stepper value={capacity} min={1} max={50} onChange={onChange} ariaLabel={labels.capacity} />
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-teal-600" : "bg-neutral-300"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  ariaLabel,
  big = false,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  ariaLabel: string;
  big?: boolean;
}) {
  const size = big ? "h-12 w-12" : "h-10 w-10";
  const num = big ? "w-8 text-2xl" : "w-7 text-base";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={`${ariaLabel} −`}
        className={`flex ${size} items-center justify-center rounded-full border-2 border-teal-600 text-teal-600 transition-transform active:scale-90`}
      >
        <span className="material-symbols-outlined">remove</span>
      </button>
      <span className={`${num} text-center font-bold tabular-nums text-neutral-900`}>{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={`${ariaLabel} +`}
        className={`flex ${size} items-center justify-center rounded-full bg-teal-600 text-white transition-transform active:scale-90`}
      >
        <span className="material-symbols-outlined">add</span>
      </button>
    </div>
  );
}
