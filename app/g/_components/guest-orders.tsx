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
import { groupGuestOrders } from "./group-orders";
import type { GuestOrdersProps, GuestRequestedOrder } from "./types";

export default function GuestOrders({ token, lang, requestedOrders, justOrdered, contactKakaoUrl, contactPhone, receiptHref }: GuestOrdersProps) {
  const L = GUEST_LABELS[lang];
  const router = useRouter();
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;
  const optionsHref = `/g/${token}/options${suffix}`;

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // 벤더 시간 제안 응답(ADR-0035) — 처리 중 id·에러·직전 거절 id(거절 후 안내 문구용).
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [declinedId, setDeclinedId] = useState<string | null>(null);
  // 티켓 확대 라이트박스(ADR-0034) — 선택한 티켓 URL. body 포털로 렌더(헤더 fixed 함정 회피).
  const [lightbox, setLightbox] = useState<string | null>(null);
  // 품목 그룹 펼침(g.key 기준) — 기본 전부 접힘(테오 지시). 헤더 탭으로 토글.
  //   미해결 제안은 상단 전역 배너가 항상 노출하므로 접힘 기본이어도 중요 알림은 놓치지 않는다.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 미해결 제안이 하나라도 있으면 상단 배너(게스트 알림 채널 없음 → 페이지 내 배너가 "알림").
  const hasProposal = requestedOrders.some((o) => o.proposalPending);

  // ── 품목별 그룹핑(테오) — 구분별로 분리 저장된 주문을 품목 카드 하나로 모은다. ──
  const groups = groupGuestOrders(requestedOrders);

  // ── QR 티켓 사전 다운로드(오프라인 대비) — 동일 출처 프록시(<a download>). ──
  //   개별 저장은 <a download>로 직접, "모두 저장"은 300ms 간격 순차 클릭(브라우저 다중 다운로드 억제 회피).
  const downloadTicket = (orderId: string, index: number) => {
    const a = document.createElement("a");
    a.href = `/api/g/${token}/service-orders/${orderId}/ticket-download?u=${index}`;
    a.download = ""; // 파일명은 서버 Content-Disposition이 부여
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const downloadAllTickets = (orderId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => downloadTicket(orderId, i), i * 300);
    }
  };

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

  // ── 벤더 시간 제안 응답(ADR-0035) — 승인=확정, 거절=담당자 재확인. 중복 클릭 가드. ──
  const onProposal = async (id: string, action: "accept" | "decline") => {
    if (proposalBusy) return;
    setProposalBusy(id);
    setProposalError(null);
    try {
      const res = await fetch(`/api/g/${token}/service-orders/${id}/proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        // 이미 해결/취소(409) 등 — 최신 상태 반영 후 안내.
        setProposalError(L.proposal.error);
        router.refresh();
        return;
      }
      if (action === "decline") setDeclinedId(id);
      router.refresh();
    } catch {
      setProposalError(L.proposal.error);
    } finally {
      setProposalBusy(null);
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
        {/* 정산 내역(영수증) 진입점 — 체크아웃 완료 시에만(receiptHref) 상단 배너 */}
        {receiptHref && (
          <a
            href={receiptHref}
            className="flex items-center gap-3 bg-slate-900 text-white rounded-xl p-4 shadow-lg active:scale-[0.98] transition-transform"
          >
            <span className="material-symbols-outlined text-teal-300">receipt_long</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{L.receipt.entryTitle}</p>
              <p className="text-[11px] text-slate-300 leading-snug">{L.receipt.entryHint}</p>
            </div>
            <span className="material-symbols-outlined text-slate-400 shrink-0">chevron_right</span>
          </a>
        )}
        {/* 신청 직후 성공 배너(ordered=1) — 자동 발주로 담당자에게 바로 전달됨 안내 */}
        {justOrdered && (
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 flex gap-3">
            <span className="material-symbols-outlined text-teal-600 text-[20px]">check_circle</span>
            <p className="text-xs text-teal-800 leading-relaxed">{L.result.orderedBanner}</p>
          </div>
        )}
        {/* 미해결 시간 제안 배너(ADR-0035) — 담당자가 시간 변경 제안, 아래 카드에서 승인/거절 */}
        {hasProposal && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
            <span className="material-symbols-outlined text-amber-600 text-[20px]">schedule</span>
            <p className="text-xs font-semibold text-amber-800 leading-relaxed">{L.proposal.banner}</p>
          </div>
        )}
        {proposalError && <p className="text-xs text-red-500 px-1">{proposalError}</p>}
        {requestedOrders.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <span className="material-symbols-outlined text-slate-300 text-[44px]">receipt_long</span>
            <p className="text-sm text-slate-400">{L.result.empty}</p>
          </div>
        ) : (
          <section className="space-y-3">
            <h3 className="px-1 text-sm font-bold text-slate-800">{L.result.requestedTitle}</h3>
            {/* 품목별 그룹 카드 — 헤더(품목명·총 수량·이용일) + 내부 주문 라인(구분별). */}
            {groups.map((g) => {
              const expanded = expandedGroups.has(g.key);
              return (
              <div
                key={g.key}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
              >
                {/* 그룹 헤더 — 탭하면 본문(주문 라인) 접고 펴기. 기본 접힘, 펼침 시에만 border-b. */}
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={expanded}
                  className={`w-full text-left px-4 py-3 flex items-start gap-2 ${expanded ? "border-b border-slate-100" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{g.name}</p>
                    {g.serviceDate && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                        <span className="material-symbols-outlined text-[14px] text-slate-400">event</span>
                        <span className="tabular-nums">{g.serviceDate}</span>
                      </p>
                    )}
                  </div>
                  <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 tabular-nums">
                    × {g.totalQuantity}
                  </span>
                  <span
                    className={`material-symbols-outlined shrink-0 text-[20px] text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                  >
                    expand_more
                  </span>
                </button>

                {/* 주문 라인 — 구분(옵션 라벨)별. 기존 정보 전부 유지. 접힘 시 미렌더. */}
                {expanded && (
                <div className="divide-y divide-slate-100">
                  {g.orders.map((o) => {
                    // 헤더가 이용일을 요약하면(g.serviceDate) 라인은 시간만, 아니면 라인마다 날짜+시간.
                    const lineWhen = g.serviceDate
                      ? o.serviceTime ?? ""
                      : [o.serviceDate, o.serviceTime].filter(Boolean).join(" ");
                    // 라인 라벨 = 구분(옵션 라벨). 없으면 단일 품목이라 헤더가 명칭을 담당 → 라벨 생략.
                    const lineLabel = o.optionLabels.length > 0 ? o.optionLabels.join(" · ") : null;
                    // 셀프 취소는 벤더 수락 전 REQUESTED만(PENDING_VENDOR 포함). 수락(vendorAccepted)되면 잠금.
                    const canCancel = o.status === "REQUESTED" && !o.vendorAccepted;
                    const dispatchedLock = o.status === "REQUESTED" && o.vendorAccepted;
                    // 담당자 연락처 — 확정(CONFIRMED)·벤더 수락 후 이름·전화 노출(★원가·마진 없음).
                    //   TICKET은 로더에서 vendorName을 null로 막으므로 여기서 자연히 false → 비TICKET만 노출.
                    const showContact = (o.status === "CONFIRMED" || o.vendorAccepted) && !!o.vendorName;
                    // ★티켓 문의 본사 안내는 라인 반복 대신 합계 위 1회로 이동(테오) — 하단 전역 블록 참고.
                    // ★무료 티켓(판매가 0) — QR 없이 그냥 입장. 티켓 이미지가 없으니 티켓 섹션은 어차피 미렌더 →
                    //   별도 "티켓 없이 입장 가능(무료)" 안내를 라인에 표시하고, 부분 발행 경고(PR #254)는 제외.
                    const isFree = o.type === "TICKET" && o.priceVnd === "0";
                    return (
                      <div key={o.id} className="px-4 py-3.5 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">
                              {lineLabel ?? (
                                <span className="text-slate-500 font-medium">{g.name}</span>
                              )}
                              <span className="text-slate-400 font-normal"> × {o.quantity}</span>
                            </p>
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
                        {/* 이용자 이름(테오) — 라인별 누가 무료·일반인지 식별. 아이콘+이름만(라벨 불필요). */}
                        {o.guestNames.length > 0 && (
                          <p className="text-xs font-medium text-slate-600 flex items-start gap-1">
                            <span className="material-symbols-outlined text-[15px] text-slate-400 shrink-0">person</span>
                            <span className="min-w-0">{o.guestNames.join(" · ")}</span>
                          </p>
                        )}
                        {/* 희망 날짜·시간(#2) + 이행 안내(#5) */}
                        {lineWhen && (
                          <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[15px] text-slate-400">schedule</span>
                            <span className="tabular-nums">{lineWhen}</span>
                          </p>
                        )}
                        <p className="text-[11px] text-slate-400 leading-snug">{o.fulfillNote}</p>
                        {/* 무료 티켓 안내 — 발행 없이 입장 가능(테오). 발주함·발행 대상 아님. */}
                        {isFree && (
                          <p className="mt-1 flex items-start gap-1 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 leading-snug">
                            <span className="material-symbols-outlined text-[15px] text-emerald-500">confirmation_number</span>
                            {L.tickets.freeEntry}
                          </p>
                        )}
                        {/* 벤더 시간 제안(ADR-0035) — 미해결이면 원래→제안 비교 + 승인/거절 버튼. */}
                        {o.proposalPending && o.proposedServiceDate && (
                          <div className="mt-1.5 space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                            <p className="flex items-center gap-1 text-xs font-bold text-amber-700">
                              <span className="material-symbols-outlined text-[16px]">update</span>
                              {L.proposal.title}
                            </p>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-500 line-through tabular-nums">
                                {[o.serviceDate, o.serviceTime].filter(Boolean).join(" ") || "—"}
                              </span>
                              <span className="material-symbols-outlined text-[15px] text-amber-500">arrow_forward</span>
                              <span className="font-bold text-amber-800 tabular-nums">
                                {[o.proposedServiceDate, o.proposedServiceTime].filter(Boolean).join(" ")}
                              </span>
                            </div>
                            {o.vendorProposalNote && (
                              <p className="text-[11px] text-slate-500 leading-snug">
                                <span className="font-semibold text-slate-600">{L.proposal.noteLabel}: </span>
                                {o.vendorProposalNote}
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-2 pt-0.5">
                              <button
                                type="button"
                                onClick={() => onProposal(o.id, "decline")}
                                disabled={proposalBusy === o.id}
                                className="rounded-lg border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-600 disabled:opacity-50 active:scale-95"
                              >
                                {proposalBusy === o.id ? L.proposal.processing : L.proposal.decline}
                              </button>
                              <button
                                type="button"
                                onClick={() => onProposal(o.id, "accept")}
                                disabled={proposalBusy === o.id}
                                className="rounded-lg bg-amber-500 py-2.5 text-xs font-bold text-white disabled:opacity-50 active:scale-95"
                              >
                                {proposalBusy === o.id ? L.proposal.processing : L.proposal.accept}
                              </button>
                            </div>
                          </div>
                        )}
                        {/* 거절 직후 안내 — 담당자 재확인(제안은 해소되어 카드에서 사라짐). */}
                        {declinedId === o.id && !o.proposalPending && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-500 leading-snug">
                            <span className="material-symbols-outlined text-[15px] text-slate-400">info</span>
                            {L.proposal.declinedNote}
                          </p>
                        )}
                        {/* 발행된 QR 티켓(ADR-0034) — 상태 무관 표시. 탭하면 라이트박스 확대 + 사전 다운로드. */}
                        {o.ticketUrls.length > 0 && (
                          <div className="mt-1.5 space-y-1.5 rounded-lg bg-teal-50/70 p-2.5">
                            <p className="flex items-center gap-1 text-xs font-bold text-teal-700">
                              <span className="material-symbols-outlined text-[16px]">confirmation_number</span>
                              {L.tickets.title(o.ticketUrls.length)}
                            </p>
                            {/* ★부분 발행 경고 — 주문 수량보다 발행된 티켓이 적으면 "전부 지급됨" 오인 방지(테오 실측).
                                수량 하드 강제가 없는 구조(ADR-0034)라 표시 레벨에서 알려준다. */}
                            {o.type === "TICKET" && !isFree && o.ticketUrls.length < o.quantity && (
                              <p className="flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-700 leading-snug">
                                <span className="material-symbols-outlined text-[15px] text-amber-500">hourglass_top</span>
                                {L.tickets.partial(o.ticketUrls.length, o.quantity)}
                              </p>
                            )}
                            {/* 오프라인 대비 안내 — 현장 인터넷 불가 시 미리 저장 */}
                            <p className="text-[11px] text-teal-700/80 leading-snug">{L.tickets.offlineHint}</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {o.ticketUrls.map((url, idx) => (
                                <div key={url} className="relative">
                                  <button
                                    type="button"
                                    onClick={() => setLightbox(url)}
                                    className="block w-full active:scale-95"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={url}
                                      alt=""
                                      className="aspect-square w-full rounded-lg border border-teal-100 object-cover"
                                    />
                                  </button>
                                  {/* 개별 저장 — 동일 출처 프록시(<a download>). 라이트박스와 분리(버블 없음). */}
                                  <a
                                    href={`/api/g/${token}/service-orders/${o.id}/ticket-download?u=${idx}`}
                                    download
                                    className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white active:scale-95"
                                  >
                                    <span className="material-symbols-outlined text-[13px]">download</span>
                                    {L.tickets.save}
                                  </a>
                                </div>
                              ))}
                            </div>
                            {/* 주문 단위 모두 저장 — 순차 트리거(300ms) */}
                            {o.ticketUrls.length > 1 && (
                              <button
                                type="button"
                                onClick={() => downloadAllTickets(o.id, o.ticketUrls.length)}
                                className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-teal-200 bg-white py-2 text-xs font-bold text-teal-700 active:scale-95"
                              >
                                <span className="material-symbols-outlined text-[16px]">download</span>
                                {L.tickets.saveAll}
                              </button>
                            )}
                            <p className="text-[11px] text-teal-700/80 leading-snug">{L.tickets.iosHint}</p>
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
                )}
              </div>
              );
            })}
          </section>
        )}

        {cancelError && (
          <p className="text-xs text-red-500 px-1">{cancelError}</p>
        )}

        {/* 티켓 문의 본사 안내(테오) — 라인마다 반복하지 않고 티켓 주문이 하나라도 있으면 합계 위에 1회만. */}
        {requestedOrders.some((o) => o.type === "TICKET") && (
          <div className="flex flex-col gap-2 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-teal-600 text-[16px]">support_agent</span>
              <p className="text-[11px] text-teal-700/90 leading-snug">{L.result.ticketContactNotice}</p>
            </div>
            {(contactKakaoUrl || contactPhone) && (
              <div className="flex flex-wrap gap-2 pl-6">
                {contactKakaoUrl && (
                  <a
                    href={contactKakaoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-semibold bg-teal-600 text-white active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[15px]">chat</span>
                    {L.result.ticketContactKakao}
                  </a>
                )}
                {contactPhone && (
                  <a
                    href={`tel:${contactPhone}`}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-semibold border border-teal-200 bg-white text-teal-700 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[15px]">call</span>
                    {L.result.ticketContactPhone}
                  </a>
                )}
              </div>
            )}
          </div>
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
