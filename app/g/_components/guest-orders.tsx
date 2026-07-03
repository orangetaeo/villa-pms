"use client";

// app/g/_components/guest-orders.tsx — 신청 내역 페이지 (/g/[token]/orders)
//   ★요청한 옵션을 부가 옵션 신청 화면과 분리 — 옵션이 많아져도 확인·체크아웃 정산이 쉽게(테오 요청).
//   요청 목록(옵션 상세 + 희망 날짜·시간 + 이행 안내) + 체크아웃 정산 미리보기(A2) + 셀프 취소(A3) + 옵션 신청 진입.
//   ★마진 비공개: 판매가만(원가·마진 0). 헤더 뒤로가기 없음(허브 페이지 — 체크인 시작으로 가는 혼선 방지, #3).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { guestVndPrice, guestVnd } from "./guest-format";
import type { GuestOrdersProps, GuestRequestedOrder } from "./types";

export default function GuestOrders({ token, lang, requestedOrders }: GuestOrdersProps) {
  const L = GUEST_LABELS[lang];
  const router = useRouter();
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;
  const optionsHref = `/g/${token}/options${suffix}`;

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const statusLabel = (s: string) =>
    s === "REQUESTED"
      ? L.result.statusPending
      : s === "CONFIRMED"
        ? L.result.statusConfirmed
        : s === "CANCELLED"
          ? L.result.statusCancelled
          : L.result.statusOther;

  // ── 체크아웃 정산 미리보기(A2) — 판매가(VND)만 합산. CANCELLED 제외, 상태별 분리. ──
  //   REQUESTED=확정 대기 / CONFIRMED·DELIVERED=확정. (원가·마진은 데이터에 없음 — 누수 0)
  const sumVnd = (orders: GuestRequestedOrder[]) =>
    orders.reduce((acc, o) => acc + (o.priceVnd ? BigInt(o.priceVnd) : 0n), 0n);
  const pendingOrders = requestedOrders.filter((o) => o.status === "REQUESTED");
  const confirmedOrders = requestedOrders.filter(
    (o) => o.status === "CONFIRMED" || o.status === "DELIVERED"
  );
  const pendingTotal = sumVnd(pendingOrders);
  const confirmedTotal = sumVnd(confirmedOrders);
  const grandTotal = pendingTotal + confirmedTotal;
  const hasSummary = pendingOrders.length > 0 || confirmedOrders.length > 0;

  // ── 셀프 취소(A3) — REQUESTED만. 확인 다이얼로그 후 POST → 성공 시 목록 새로고침. ──
  const onCancel = async (id: string) => {
    if (cancelling) return;
    if (!window.confirm(L.checkout.cancelConfirm)) return;
    setCancelling(id);
    setCancelError(null);
    try {
      const res = await fetch(`/api/g/${token}/service-orders/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        // 발주됨(409 DISPATCHED)·이미 확정/취소 — 최신 상태 반영 후 안내. (취소버튼은 dispatched면 애초 숨김)
        let code: string | undefined;
        try { code = (await res.json())?.error; } catch { /* noop */ }
        router.refresh();
        setCancelError(code === "DISPATCHED" ? L.checkout.cancelDispatched : L.checkout.cancelError);
        return;
      }
      router.refresh();
    } catch {
      setCancelError(L.checkout.cancelError);
    } finally {
      setCancelling(null);
    }
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
                // 셀프 취소는 미발주 REQUESTED만. 발주된(dispatched) 주문은 운영자 조율 필요 → 버튼 대신 안내.
                const canCancel = o.status === "REQUESTED" && !o.dispatched;
                const dispatchedLock = o.status === "REQUESTED" && o.dispatched;
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
                    <p className="text-[11px] text-slate-400 leading-snug">{o.fulfillNote}</p>
                    {/* 셀프 취소(A3) — REQUESTED만. CONFIRMED/DELIVERED엔 버튼 없음. */}
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => onCancel(o.id)}
                        disabled={cancelling === o.id}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-500 disabled:text-slate-300 active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                        {cancelling === o.id ? L.checkout.cancelling : L.checkout.cancel}
                      </button>
                    )}
                    {/* 발주된 주문 — 셀프 취소 불가, 운영자 문의 안내 */}
                    {dispatchedLock && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <span className="material-symbols-outlined text-[15px]">lock</span>
                        {L.checkout.cancelDispatched}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {cancelError && (
          <p className="text-xs text-red-500 px-1">{cancelError}</p>
        )}

        {/* 체크아웃 정산 미리보기(A2) — 상태별 합계(판매가 VND). 미니바는 체크아웃 시 합산(안내문구 유지). */}
        {hasSummary && (
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="material-symbols-outlined text-teal-600 text-[20px]">receipt</span>
              <h3 className="text-sm font-bold text-slate-800">{L.checkout.summaryTitle}</h3>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              {pendingOrders.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">{L.checkout.pendingTotal}</span>
                  <span className="font-semibold text-slate-700 tabular-nums">{guestVnd(pendingTotal.toString())}</span>
                </div>
              )}
              {confirmedOrders.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">{L.checkout.confirmedTotal}</span>
                  <span className="font-semibold text-slate-700 tabular-nums">{guestVnd(confirmedTotal.toString())}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="font-bold text-slate-800">{L.checkout.grandTotal}</span>
                <span className="font-extrabold text-slate-900 tabular-nums">{guestVnd(grandTotal.toString())}</span>
              </div>
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
