"use client";

// app/g/_components/guest-options.tsx — 부가 옵션 신청 폼 (ADR-0019 v2 게스트 UI 개편, 별도 라우트)
//   체크인과 독립(/g/[token]/options) — 투숙 중 언제든 접근. 카탈로그 카드 + 희망 날짜/시간(#3)만.
//   ★요청 내역은 별도 페이지(/g/[token]/orders)로 분리 — 신청 후 그쪽으로 이동(router.push). 옵션이 많아져도 확인·정산이 쉽게.
//   ★결제통화: 가격은 항상 VND 기본 표기(VND 우선 수납). 하단 합계에만 언어 모국통화로 "오늘 환율 기준" 환산액 보조 표기(vi=없음).
//   ★마진 비공개: 판매가만(원가·마진 0). 환산값은 표시용 근사치.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  resolveOrderPricing,
  ServiceSelectionError,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { formatConverted } from "@/lib/fx-rates";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { OptionCard, type CardSelection } from "./option-card";
import { guestVnd } from "./guest-format";
import type { GuestOptionsProps } from "./types";

/** ISO → YYYY-MM-DD (UTC, @db.Date 자정 기준) — date input min/max용. */
function isoToDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function emptySelection(variantKey: string | null): CardSelection {
  return { variantKey, addonKeys: [], modifierKeys: [], quantity: 0, serviceDate: null, serviceTime: null, guestNote: null, ticketGuestIdxs: [] };
}

export default function GuestOptions(props: GuestOptionsProps) {
  const { token, lang, booking, catalog, convert, checkedInGuests } = props;
  const L = GUEST_LABELS[lang];
  const router = useRouter();
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;
  const ordersHref = `/g/${token}/orders${suffix}`;

  const dateMin = isoToDateInput(booking.checkIn);
  const dateMax = isoToDateInput(booking.checkOut);

  const [selections, setSelections] = useState<Record<string, CardSelection>>(() =>
    Object.fromEntries(catalog.map((c) => [c.id, emptySelection(c.variants[0]?.key ?? null)]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // ★이용자 이름 — 서비스 받으실 분(묶음 공통 1값). 예약 대표자 이름 prefill, 수정 가능. 빈값이면 서버가 대표자 폴백.
  const [customerName, setCustomerName] = useState<string>(booking.guestName ?? "");

  // ── 합계 미리보기(선택 항목 VND 합산 → KRW 파생) ──
  const cardOptions = useMemo(() => {
    const map: Record<string, CatalogOptions> = {};
    for (const c of catalog) {
      map[c.id] = {
        variants: c.variants.map((o) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd })),
        addons: c.addons.map((o) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd })),
        modifiers: c.modifiers.map((o) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd })),
      };
    }
    return map;
  }, [catalog]);

  const grandTotal = useMemo(() => {
    let vnd = 0n;
    let has = false;
    for (const c of catalog) {
      const sel = selections[c.id];
      if (!sel || sel.quantity < 1) continue;
      try {
        const p = resolveOrderPricing(
          { priceVnd: c.priceVnd ? BigInt(c.priceVnd) : null },
          cardOptions[c.id],
          { variantKey: sel.variantKey, addonKeys: sel.addonKeys, modifierKeys: sel.modifierKeys, quantity: sel.quantity }
        );
        vnd += p.totalPriceVnd;
        has = true;
      } catch (e) {
        if (!(e instanceof ServiceSelectionError)) throw e;
      }
    }
    return { vnd, has };
  }, [catalog, selections, cardOptions]);

  const anySelected = catalog.some((c) => (selections[c.id]?.quantity ?? 0) > 0);
  // 선택한 항목은 희망 날짜 필수. 시간은 TICKET 제외 필수(TICKET은 이용일만, 테오 2026-07-12). 서버도 동일 검증.
  const missingDateTime = catalog.some((c) => {
    const sel = selections[c.id];
    if (!sel || sel.quantity <= 0) return false;
    if (!sel.serviceDate) return true;
    return c.type !== "TICKET" && !sel.serviceTime;
  });
  const canSubmit = anySelected && !missingDateTime;
  // 합계는 항상 VND 기본. convert 있으면 하단에 "오늘 환율 기준" 모국통화 환산 보조 표기.
  const grandTotalStr = guestVnd(grandTotal.vnd.toString());
  const convertedStr =
    convert && grandTotal.vnd > 0n
      ? formatConverted(grandTotal.vnd, convert.currency, convert.vndPerUnit)
      : null;

  const submitOrders = async () => {
    if (submitting) return;
    const chosen = catalog.filter((c) => (selections[c.id]?.quantity ?? 0) > 0);
    if (chosen.length === 0) return;
    setSubmitting(true);
    setOrdersError(null);
    try {
      for (const c of chosen) {
        const sel = selections[c.id];
        // TICKET 이용자 선택(ADR-0036) — 선택 인덱스를 {name,birthDate} 스냅샷으로 해석해 전송.
        //   체크인 명단이 있고 선택이 있을 때만. 서버가 확정본과 대조 검증(불일치 400).
        const ticketGuests =
          c.type === "TICKET" && checkedInGuests.length > 0 && sel.ticketGuestIdxs.length > 0
            ? sel.ticketGuestIdxs.map((i) => checkedInGuests[i]).filter(Boolean)
            : undefined;
        const res = await fetch(`/api/g/${token}/service-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalogItemId: c.id,
            variantKey: sel.variantKey ?? undefined,
            addonKeys: sel.addonKeys,
            modifierKeys: sel.modifierKeys,
            quantity: sel.quantity,
            serviceDate: sel.serviceDate ?? undefined,
            // TICKET은 시간 미포함(이용일만). 그 외는 희망 시간 전송.
            serviceTime: c.type === "TICKET" ? undefined : sel.serviceTime ?? undefined,
            guestNote: sel.guestNote ?? undefined,
            // ★이용자 이름 — 묶음 공통 1값(빈값이면 서버가 예약 대표자 폴백)
            customerName: customerName.trim() || undefined,
            // TICKET 이용자 선택 스냅샷(이름·생년월일만) — 있을 때만
            ...(ticketGuests ? { ticketGuests } : {}),
          }),
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
      }
      // 신청 완료 → 신청 내역 페이지로 이동(서버 렌더로 최신 목록·옵션 상세 표시) + 성공 배너(ordered=1)
      router.push(ordersHref + (suffix ? "&" : "?") + "ordered=1");
    } catch {
      setOrdersError(L.addons.error);
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col shadow-2xl relative">
      <header className="w-full sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="flex items-center h-14 px-3 gap-1.5">
          <a href={ordersHref} className="p-2 rounded-full hover:bg-slate-50 active:scale-95">
            <span className="material-symbols-outlined text-slate-600">arrow_back</span>
          </a>
          <h1 className="font-bold text-base text-slate-900">{L.addons.title}</h1>
          <span className="ml-auto flex items-center gap-2 pr-0.5">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark className="text-sm" villa="text-slate-900" go="text-teal-600" />
            <PublicLangSelector current={lang} />
          </span>
        </div>
      </header>

      <main className="flex-grow px-4 py-5 space-y-4 pb-40">
        <p className="text-sm text-slate-500 leading-relaxed">{L.addons.pageIntro}</p>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-amber-500 text-[20px]">info</span>
          <p className="text-xs text-amber-800 leading-relaxed">{L.addons.banner}</p>
        </div>

        {catalog.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">{L.addons.empty}</p>
        ) : (
          catalog.map((c) => (
            <OptionCard
              key={c.id}
              item={c}
              labels={L.addons}
              selection={selections[c.id] ?? emptySelection(c.variants[0]?.key ?? null)}
              onChange={(next) => setSelections((prev) => ({ ...prev, [c.id]: next }))}
              badgeText={typeBadgeLabel(c.type)}
              dateMin={dateMin}
              dateMax={dateMax}
              checkedInGuests={checkedInGuests}
            />
          ))
        )}

        {/* 이용자 이름 — 서비스 받으실 분(묶음 공통). 대표자 이름 prefill, 수정 가능. 빈값 허용(서버 폴백). */}
        {catalog.length > 0 && (
          <div className="bg-white border border-slate-100 rounded-xl p-4 space-y-2 shadow-sm">
            <label
              htmlFor="guest-customer-name"
              className="flex items-center gap-1.5 text-sm font-bold text-slate-700"
            >
              <span className="material-symbols-outlined text-teal-600 text-[18px]">person</span>
              {L.addons.customerNameLabel}
            </label>
            <input
              id="guest-customer-name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={80}
              placeholder={L.addons.customerNamePlaceholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:ring-teal-500 focus:border-teal-500"
            />
            <p className="text-[11px] text-slate-400 leading-snug">{L.addons.customerNameHint}</p>
          </div>
        )}

        {ordersError && <p className="text-xs text-red-500 text-center">{ordersError}</p>}

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-slate-400 text-[20px]">payments</span>
          <p className="text-xs text-slate-500 leading-relaxed">{L.result.settleNote}</p>
        </div>
      </main>

      {/* 하단 합계 + 요청 버튼 */}
      {catalog.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 py-3.5 space-y-3 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
          {anySelected && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-500 shrink-0">{L.addons.estTotal}</span>
              <div className="text-right min-w-0">
                <span className="text-xl font-extrabold text-teal-600 tabular-nums block">
                  {grandTotalStr}
                </span>
                {convertedStr && (
                  <span className="text-[11px] text-slate-400 tabular-nums block leading-tight">
                    {convertedStr} · {L.addons.rateNote}
                  </span>
                )}
              </div>
            </div>
          )}
          {anySelected && missingDateTime && (
            <p className="text-xs text-amber-600 text-center flex items-center justify-center gap-1">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
              {L.addons.dateTimeRequired}
            </p>
          )}
          <button
            type="button"
            disabled={submitting || !canSubmit}
            onClick={submitOrders}
            className="w-full h-14 bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
          >
            {submitting ? L.addons.requesting : L.addons.requestCta}
          </button>
        </div>
      )}
    </div>
  );
}

function typeBadgeLabel(type: string): string {
  const map: Record<string, string> = {
    MASSAGE: "SPA",
    BARBER: "BARBER",
    CAR_RENTAL: "CAR",
    MOTORBIKE_RENTAL: "BIKE",
    BBQ: "BBQ",
    TICKET: "TICKET",
    GUIDE: "GUIDE",
    BREAKFAST: "BREAKFAST",
  };
  return map[type] ?? type;
}

