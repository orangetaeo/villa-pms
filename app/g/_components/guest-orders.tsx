"use client";

// app/g/_components/guest-orders.tsx — 신청 내역 페이지 (/g/[token]/orders)
//   ★요청한 옵션을 부가 옵션 신청 화면과 분리 — 옵션이 많아져도 확인·체크아웃 정산이 쉽게(테오 요청).
//   요청 목록(옵션 상세 + 희망 날짜·시간 + 이행 안내) + 정산 안내 + 하단 "부가 옵션 신청" 진입 버튼.
//   ★마진 비공개: 판매가만(원가·마진 0). 헤더 뒤로가기 없음(허브 페이지 — 체크인 시작으로 가는 혼선 방지, #3).
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { fulfillmentMode } from "@/lib/service-catalog";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { guestVndPrice } from "./guest-format";
import type { GuestOrdersProps } from "./types";

export default function GuestOrders({ token, lang, requestedOrders }: GuestOrdersProps) {
  const L = GUEST_LABELS[lang];
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;
  const optionsHref = `/g/${token}/options${suffix}`;

  const statusLabel = (s: string) =>
    s === "REQUESTED" ? L.result.statusPending : s === "CONFIRMED" ? L.result.statusConfirmed : L.result.statusOther;

  const fulfillNote = (type: string) => {
    const m = fulfillmentMode(type);
    return m === "DELIVERY"
      ? L.addons.fulfillDelivery
      : m === "APPOINTMENT"
        ? L.addons.fulfillAppointment
        : L.addons.fulfillOther;
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col shadow-2xl relative">
      <header className="w-full sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="flex items-center h-14 px-4 gap-1.5">
          <h1 className="font-bold text-base text-slate-900">{L.addons.myOrders}</h1>
          <span className="ml-auto flex items-center gap-2 pr-0.5">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark className="text-sm" villa="text-slate-900" go="text-teal-600" />
            <PublicLangSelector current={lang} />
          </span>
        </div>
      </header>

      <main className="flex-grow px-4 py-5 space-y-4 pb-32">
        {requestedOrders.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <span className="material-symbols-outlined text-slate-300 text-[44px]">receipt_long</span>
            <p className="text-sm text-slate-400">{L.result.empty}</p>
          </div>
        ) : (
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">{L.result.requestedTitle}</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {requestedOrders.map((o) => {
                const when = [o.serviceDate, o.serviceTime].filter(Boolean).join(" ");
                return (
                  <div key={o.id} className="px-4 py-3.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {o.name} <span className="text-slate-400 font-normal">× {o.quantity}</span>
                        </p>
                        {o.optionLabels.length > 0 && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {o.optionLabels.join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="bg-amber-50 text-amber-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {statusLabel(o.status)}
                        </span>
                        <span className="text-sm font-bold text-slate-900 tabular-nums">
                          {guestVndPrice(o.priceVnd)}
                        </span>
                      </div>
                    </div>
                    {/* 희망 날짜·시간(#2) + 이행 안내(#5) */}
                    {when && (
                      <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px] text-slate-400">schedule</span>
                        <span className="tabular-nums">{when}</span>
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400 leading-snug">{fulfillNote(o.type)}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-slate-400 text-[20px]">payments</span>
          <p className="text-xs text-slate-500 leading-relaxed">{L.result.settleNote}</p>
        </div>
      </main>

      {/* 하단 — 부가 옵션 신청 화면으로 진입 */}
      <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 py-3.5 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
        <a
          href={optionsHref}
          className="w-full h-14 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add_shopping_cart</span>
          {L.result.openOptionsCta}
        </a>
      </div>
    </div>
  );
}
