"use client";

// app/g/_components/guest-orders.tsx — 신청 내역 페이지 (/g/[token]/orders)
//   ★요청한 옵션을 부가 옵션 신청 화면과 분리 — 옵션이 많아져도 확인·체크아웃 정산이 쉽게(테오 요청).
//   요청 목록(옵션 상세 + 희망 날짜·시간 + 이행 안내) + 체크아웃 정산 미리보기(A2) + 셀프 취소(A3) + 옵션 신청 진입.
//   ★마진 비공개: 판매가만(원가·마진 0). 헤더 뒤로가기 없음(허브 페이지 — 체크인 시작으로 가는 혼선 방지, #3).
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { guestVndPrice, guestVnd } from "./guest-format";
import type { GuestOrdersProps, GuestRequestedOrder } from "./types";

export default function GuestOrders({ token, lang, requestedOrders, justOrdered }: GuestOrdersProps) {
  const L = GUEST_LABELS[lang];
  const router = useRouter();
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;
  const optionsHref = `/g/${token}/options${suffix}`;

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // 티켓 확대 라이트박스(ADR-0034) — 선택한 티켓 URL. body 포털로 렌더(헤더 fixed 함정 회피).
  const [lightbox, setLightbox] = useState<string | null>(null);

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
        {/* 신청 직후 성공 배너(ordered=1) — 자동 발주로 담당자에게 바로 전달됨 안내 */}
        {justOrdered && (
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 flex gap-3">
            <span className="material-symbols-outlined text-teal-600 text-[20px]">check_circle</span>
            <p className="text-xs text-teal-800 leading-relaxed">{L.result.orderedBanner}</p>
          </div>
        )}
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
                // 셀프 취소는 벤더 수락 전 REQUESTED만(PENDING_VENDOR 포함). 수락(vendorAccepted)되면 잠금.
                const canCancel = o.status === "REQUESTED" && !o.vendorAccepted;
                const dispatchedLock = o.status === "REQUESTED" && o.vendorAccepted;
                // 담당자 연락처 — 확정(CONFIRMED)·벤더 수락 후 이름·전화 노출(★원가·마진 없음).
                const showContact = (o.status === "CONFIRMED" || o.vendorAccepted) && !!o.vendorName;
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
                    {/* 발행된 QR 티켓(ADR-0034) — 상태 무관 표시. 탭하면 body 포털 라이트박스로 확대. */}
                    {o.ticketUrls.length > 0 && (
                      <div className="mt-1.5 space-y-1.5 rounded-lg bg-teal-50/70 p-2.5">
                        <p className="flex items-center gap-1 text-xs font-bold text-teal-700">
                          <span className="material-symbols-outlined text-[16px]">confirmation_number</span>
                          {L.tickets.title(o.ticketUrls.length)}
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {o.ticketUrls.map((url) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => setLightbox(url)}
                              className="active:scale-95"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt=""
                                className="aspect-square w-full rounded-lg border border-teal-100 object-cover"
                              />
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] text-teal-700/80 leading-snug">{L.tickets.hint}</p>
                      </div>
                    )}
                    {/* 담당자 연락처(확정 후) — 이름 + 전화(tel:) + 직접 연락 안내. ★이름·전화만 노출. */}
                    {showContact && (
                      <div className="mt-1.5 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-teal-600 text-[16px]">support_agent</span>
                          <span className="text-[11px] text-slate-500">{L.result.vendorContactLabel}</span>
                          <span className="text-xs font-semibold text-slate-800 truncate">{o.vendorName}</span>
                          {o.vendorPhone && (
                            <a
                              href={`tel:${o.vendorPhone}`}
                              className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-teal-700 active:scale-95"
                            >
                              <span className="material-symbols-outlined text-[16px]">call</span>
                              <span className="tabular-nums">{o.vendorPhone}</span>
                            </a>
                          )}
                        </div>
                        <p className="text-[11px] text-teal-700/80 leading-snug">{L.result.vendorContactHint}</p>
                      </div>
                    )}
                    {/* 셀프 취소(A3) — 벤더 수락 전 REQUESTED만. 확정·수락 후엔 버튼 없음. */}
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

      {/* 티켓 확대 라이트박스 — body 포털(포털헤더 fixed 함정 회피). 배경/버튼 탭 시 닫힘. */}
      {lightbox &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label={L.tickets.close}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur active:scale-95"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
