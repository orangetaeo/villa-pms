"use client";

// app/g/_components/option-card.tsx — G4 부가옵션 카드 1개 (ADR-0019 S3)
//   variant(1택·가격대체) · addon(다중·가산, 13종 이상은 바텀시트) · modifier(토글·가산) · 수량 스테퍼.
//   합계 미리보기는 resolveOrderPricing(클라)로 — 서버가 최종 재계산(변조 방지).
import { useMemo, useState } from "react";
import {
  resolveOrderPricing,
  ServiceSelectionError,
  fulfillmentMode,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { catalogImage } from "@/lib/service-image";
import type { GuestLabels } from "@/lib/guest-i18n";
import { guestVndPrice, guestVndDelta } from "./guest-format";
import type { GuestCatalogView, GuestOption } from "./types";

export interface CardSelection {
  variantKey: string | null;
  addonKeys: string[];
  modifierKeys: string[];
  quantity: number;
  /** 희망 날짜(YYYY-MM-DD, 투숙기간 내). 미선택이면 null. (#3) */
  serviceDate: string | null;
  /** 희망 시간(HH:MM 자유 입력). 미선택이면 null. (#3) */
  serviceTime: string | null;
}

const TYPE_BADGE: Record<string, string> = {
  BBQ: "bg-orange-50 text-orange-600",
  TICKET: "bg-sky-50 text-sky-600",
  GUIDE: "bg-violet-50 text-violet-600",
  CAR_RENTAL: "bg-emerald-50 text-emerald-600",
  MOTORBIKE_RENTAL: "bg-rose-50 text-rose-600",
  MASSAGE: "bg-fuchsia-50 text-fuchsia-600",
  BARBER: "bg-amber-100 text-amber-700",
  BREAKFAST: "bg-teal-50 text-teal-600",
};

const toVndStr = (v: bigint | null): string | null => (v == null ? null : v.toString());

export function OptionCard({
  item,
  labels,
  selection,
  onChange,
  badgeText,
  dateMin,
  dateMax,
}: {
  item: GuestCatalogView;
  labels: GuestLabels["addons"];
  selection: CardSelection;
  onChange: (next: CardSelection) => void;
  badgeText: string;
  /** 희망 날짜 입력 가능 범위(YYYY-MM-DD) — 투숙 체크인~체크아웃. (#3) */
  dateMin: string;
  dateMax: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const options: CatalogOptions = useMemo(
    () => ({
      variants: item.variants.map((o) => optToDef(o)),
      addons: item.addons.map((o) => optToDef(o)),
      modifiers: item.modifiers.map((o) => optToDef(o)),
    }),
    [item]
  );

  // 합계 미리보기 — 수량 0이어도 현재 선택(variant·addon·modifier) 기준 "단가(1개)"를 표시한다.
  // (M1) 옛 동작: quantity<1이면 null→item.priceVnd(기본가) 폴백 → 선택한 variant 가격과 불일치.
  //   예) 두리안 200,000 선택인데 하단 50,000 표시. 수량을 1로 가정해 선택을 반영한다.
  const preview = useMemo(() => {
    const qty = Math.max(1, selection.quantity);
    try {
      return resolveOrderPricing(
        { priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
        options,
        {
          variantKey: selection.variantKey,
          addonKeys: selection.addonKeys,
          modifierKeys: selection.modifierKeys,
          quantity: qty,
        }
      );
    } catch (e) {
      if (e instanceof ServiceSelectionError) return null;
      throw e;
    }
  }, [item, options, selection]);

  const previewStr =
    preview != null
      ? guestVndPrice(toVndStr(preview.totalPriceVnd))
      : guestVndPrice(item.priceVnd);

  const selectedAddons = item.addons.filter((a) => selection.addonKeys.includes(a.key));

  const setQty = (delta: number) =>
    onChange({ ...selection, quantity: Math.max(0, selection.quantity + delta) });

  const pickVariant = (key: string) => onChange({ ...selection, variantKey: key });

  const toggleAddon = (key: string) => {
    const has = selection.addonKeys.includes(key);
    onChange({
      ...selection,
      addonKeys: has
        ? selection.addonKeys.filter((k) => k !== key)
        : [...selection.addonKeys, key],
    });
  };

  const toggleModifier = (key: string) => {
    const has = selection.modifierKeys.includes(key);
    onChange({
      ...selection,
      modifierKeys: has
        ? selection.modifierKeys.filter((k) => k !== key)
        : [...selection.modifierKeys, key],
    });
  };

  const badgeCls = TYPE_BADGE[item.type] ?? "bg-slate-100 text-slate-500";
  const active = selection.quantity > 0;
  // 이행 방식 안내(#5) — 배송형/예약형(픽업)/기타. 날짜·시간 입력과 함께 노출.
  const mode = fulfillmentMode(item.type);
  const fulfillNote =
    mode === "DELIVERY"
      ? labels.fulfillDelivery
      : mode === "APPOINTMENT"
        ? labels.fulfillAppointment
        : labels.fulfillOther;
  // 업로드 사진 우선, 없으면 타입 기본 이미지(폴백)
  const photo = catalogImage(item.type, item.photoUrl);

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm overflow-hidden ${
        active ? "border-2 border-teal-200" : "border border-slate-100"
      }`}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="w-full h-36 object-cover" alt={item.name} src={photo} loading="lazy" decoding="async" />
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-base text-slate-900">{item.name}</h3>
            {item.desc && <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>}
          </div>
          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badgeCls}`}>
            {badgeText}
          </span>
        </div>

        {/* variants — 1택, 가격 대체 */}
        {item.variants.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">{labels.timeLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              {item.variants.map((v) => {
                const on = selection.variantKey === v.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => pickVariant(v.key)}
                    className={`rounded-lg px-3 py-2.5 text-left ${
                      on ? "border-2 border-teal-500 bg-teal-50" : "border border-slate-200 bg-white"
                    }`}
                  >
                    <p className={`text-xs font-bold ${on ? "text-teal-700" : "text-slate-500"}`}>
                      {v.label}
                    </p>
                    <p
                      className={`text-sm font-extrabold tabular-nums ${
                        on ? "text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {guestVndPrice(v.priceVnd)}
                    </p>
                    {v.desc && (
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{v.desc}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* addons — 다중. ≤4면 인라인 토글, 그 이상은 바텀시트 */}
        {item.addons.length > 0 && item.addons.length <= 4 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-500">{labels.addonsLabel}</p>
            {item.addons.map((a) => (
              <label
                key={a.key}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selection.addonKeys.includes(a.key)}
                    onChange={() => toggleAddon(a.key)}
                    className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="text-sm text-slate-800 block">{a.label}</span>
                    {a.desc && <span className="text-[11px] text-slate-400 block leading-snug">{a.desc}</span>}
                  </span>
                </span>
                <span className="text-xs font-semibold text-teal-600 tabular-nums shrink-0">
                  {guestVndDelta(a.priceVnd)}
                </span>
              </label>
            ))}
          </div>
        )}
        {item.addons.length > 4 && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="w-full flex items-center justify-between rounded-lg border border-dashed border-teal-300 bg-teal-50/40 px-3 py-2.5 active:scale-[0.99]"
          >
            <span className="text-sm font-semibold text-teal-700">
              {labels.addonsTrigger(item.addons.length)}
            </span>
            <span className="flex items-center gap-2">
              {selection.addonKeys.length > 0 && (
                <span className="bg-teal-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums">
                  {labels.selectedCount(selection.addonKeys.length)}
                </span>
              )}
              <span className="material-symbols-outlined text-teal-600 text-[20px]">expand_more</span>
            </span>
          </button>
        )}
        {item.addons.length > 4 && selectedAddons.length > 0 && (
          <p className="text-[11px] text-slate-400">
            {selectedAddons.map((a) => a.label).join(" · ")}
          </p>
        )}

        {/* modifiers — 토글, 가산 */}
        {item.modifiers.map((m) => (
          <label
            key={m.key}
            className="flex items-center justify-between rounded-xl border border-fuchsia-100 bg-fuchsia-50/40 px-3 py-2.5 cursor-pointer"
          >
            <span className="min-w-0">
              <span className="text-sm font-semibold text-slate-800 block">{m.label}</span>
              {m.desc && <span className="text-[11px] text-slate-400 block leading-snug">{m.desc}</span>}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-teal-600 tabular-nums">
                {guestVndDelta(m.priceVnd)}
              </span>
              <input
                type="checkbox"
                checked={selection.modifierKeys.includes(m.key)}
                onChange={() => toggleModifier(m.key)}
                className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
            </span>
          </label>
        ))}

        {/* 희망 날짜·시간 (#3) — 수량 선택 시 노출. 필수(미입력 시 신청 차단). */}
        {active && (
          <>
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                mode === "APPOINTMENT"
                  ? "bg-fuchsia-50 text-fuchsia-700"
                  : "bg-teal-50 text-teal-700"
              }`}
            >
              <span className="material-symbols-outlined text-[16px] mt-0.5">
                {mode === "DELIVERY" ? "local_shipping" : mode === "APPOINTMENT" ? "directions_car" : "info"}
              </span>
              <p className="text-[11px] leading-snug">{fulfillNote}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                {labels.serviceDateLabel} <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                min={dateMin}
                max={dateMax}
                aria-label={labels.serviceDateLabel}
                title={labels.serviceDateLabel}
                value={selection.serviceDate ?? ""}
                onChange={(e) => onChange({ ...selection, serviceDate: e.target.value || null })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                {labels.serviceTimeLabel} <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                aria-label={labels.serviceTimeLabel}
                title={labels.serviceTimeLabel}
                value={selection.serviceTime ?? ""}
                onChange={(e) => onChange({ ...selection, serviceTime: e.target.value || null })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            </div>
          </>
        )}

        {/* 가격 + 수량 스테퍼 */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-extrabold text-slate-900 tabular-nums">{previewStr}</span>
            {item.unitLabel && (
              <span className="text-xs text-slate-400">{labels.perUnit(item.unitLabel)}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQty(-1)}
              className="w-9 h-9 rounded-full border border-slate-200 text-slate-400 flex items-center justify-center text-lg active:scale-95"
            >
              −
            </button>
            <span className="w-5 text-center font-bold tabular-nums">{selection.quantity}</span>
            <button
              type="button"
              onClick={() => setQty(1)}
              className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-lg active:scale-95"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* addons 바텀시트 (다중선택 체크리스트) */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[60] max-w-md mx-auto">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSheetOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">{labels.sheetTitle}</h3>
                <p className="text-[11px] text-slate-400">{labels.sheetHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="p-2 rounded-full hover:bg-slate-50 active:scale-95"
              >
                <span className="material-symbols-outlined text-slate-500">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 divide-y divide-slate-100">
              {item.addons.map((a) => (
                <label
                  key={a.key}
                  className="flex items-center justify-between px-2 py-3 cursor-pointer"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={selection.addonKeys.includes(a.key)}
                      onChange={() => toggleAddon(a.key)}
                      className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="text-sm text-slate-800 block">{a.label}</span>
                      {a.desc && <span className="text-[11px] text-slate-400 block leading-snug">{a.desc}</span>}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                    {guestVndDelta(a.priceVnd)}
                  </span>
                </label>
              ))}
            </div>
            <div className="border-t border-slate-100 px-5 py-4 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-[11px] text-slate-400">
                  {labels.selectedCount(selection.addonKeys.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="h-12 px-8 bg-teal-600 text-white font-bold rounded-xl active:scale-[0.98]"
              >
                {labels.apply}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function optToDef(o: GuestOption) {
  return { key: o.key, labelKo: o.label, priceVnd: o.priceVnd };
}
