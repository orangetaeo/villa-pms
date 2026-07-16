"use client";

// 스레드 헤더 예약 연결 바 (T-webchat-guest-link-share)
//
// 미연결: [예약 연결] 버튼 → 모달(자동 후보 로드 + 검색 + 확인 다이얼로그) → POST booking-link.
// 연결됨: 배지(빌라명·체크인~아웃 MM.DD·게스트명) → 클릭 시 /bookings/<id> 새 탭 + 해제(link_off) 버튼.
// 후보/검색·연결/해제 데이터는 라우트 화이트리스트가 금액 무관 보장(클라는 결과만 렌더).
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { BookingSummary, BookingCandidate } from "./webchat-types";

/** ISO → "MM.DD"(Asia/Ho_Chi_Minh). */
function mmdd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/\.\s?$/, "")
    .replace(/\.\s?/g, ".");
}

function MatchBadge({ matchType }: { matchType: BookingCandidate["matchType"] }) {
  const t = useTranslations("adminWebchat");
  if (matchType === "token") {
    return (
      <span className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-emerald-200 bg-emerald-500/20 border border-emerald-500/40">
        <span className="material-symbols-outlined text-[12px] leading-none">verified</span>
        {t("booking.match.token")}
      </span>
    );
  }
  if (matchType === "contact") {
    return (
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-amber-200 bg-amber-500/15 border border-amber-500/30">
        {t("booking.match.contact")}
      </span>
    );
  }
  return null;
}

export function WebChatBookingBar({
  sessionId,
  booking,
  onLink,
  onUnlink,
}: {
  sessionId: string;
  booking: BookingSummary | null;
  onLink: (bookingId: string) => Promise<boolean>;
  onUnlink: () => Promise<boolean>;
}) {
  const t = useTranslations("adminWebchat");
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<BookingCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<BookingCandidate | null>(null);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const loadCandidates = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        const qs = query ? `?q=${encodeURIComponent(query)}` : "";
        const res = await fetch(`/api/webchat/sessions/${sessionId}/booking-candidates${qs}`);
        if (!res.ok) {
          setCandidates([]);
          return;
        }
        const data = (await res.json()) as { candidates?: BookingCandidate[] };
        setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  // 모달 열림 시 즉시 자동 후보 로드, 입력 시 디바운스 검색(빈 질의=자동 후보).
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      void loadCandidates("");
      return;
    }
    const h = setTimeout(() => void loadCandidates(query), 300);
    return () => clearTimeout(h);
  }, [open, q, loadCandidates]);

  const openModal = useCallback(() => {
    setQ("");
    setConfirmTarget(null);
    setCandidates([]);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    setConfirmTarget(null);
  }, []);

  const doConfirmLink = useCallback(async () => {
    if (!confirmTarget || linking) return;
    setLinking(true);
    const ok = await onLink(confirmTarget.bookingId);
    setLinking(false);
    if (ok) closeModal();
  }, [confirmTarget, linking, onLink, closeModal]);

  const doUnlink = useCallback(async () => {
    if (unlinking) return;
    if (!window.confirm(t("booking.confirmUnlink"))) return;
    setUnlinking(true);
    await onUnlink();
    setUnlinking(false);
  }, [unlinking, onUnlink, t]);

  // ── 연결됨: 배지 ──
  if (booking) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={`/bookings/${booking.bookingId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 min-w-0 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1.5 text-xs hover:bg-teal-500/20"
          title={t("booking.openBooking")}
        >
          <span className="material-symbols-outlined text-[15px] leading-none text-teal-300">
            confirmation_number
          </span>
          <span className="font-bold text-teal-200 truncate max-w-[150px]">
            {booking.villaName ?? t("booking.noVilla")}
          </span>
          <span className="text-slate-300 tabular-nums whitespace-nowrap">
            {mmdd(booking.checkIn)}~{mmdd(booking.checkOut)}
          </span>
          <span className="text-slate-300 truncate max-w-[110px]">{booking.guestName}</span>
          <span className="material-symbols-outlined text-[13px] leading-none text-slate-500">
            open_in_new
          </span>
        </a>
        <button
          type="button"
          onClick={doUnlink}
          disabled={unlinking}
          aria-label={t("booking.unlink")}
          title={t("booking.unlink")}
          className="shrink-0 inline-flex items-center rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-400 hover:text-red-400 hover:border-red-500/40 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[15px] leading-none">link_off</span>
        </button>
      </div>
    );
  }

  // ── 미연결: 연결 버튼 + 모달 ──
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-2.5 py-1.5 text-xs font-bold text-blue-300 hover:bg-blue-500/20"
      >
        <span className="material-symbols-outlined text-[15px] leading-none">add_link</span>
        {t("booking.connect")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-bold text-white">{t("booking.modalTitle")}</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label={t("booking.close")}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[20px] leading-none">close</span>
              </button>
            </div>

            {/* 검색 */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-800">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-500">
                  search
                </span>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("booking.searchPlaceholder")}
                  className="w-full bg-slate-800/60 border border-slate-700 text-sm rounded-lg pl-9 pr-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* 후보 목록 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
              {loading ? (
                <p className="text-center text-xs text-slate-500 py-8">{t("loading")}</p>
              ) : candidates.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">
                  {q.trim() ? t("booking.noSearchResults") : t("booking.noCandidates")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {candidates.map((c) => (
                    <li key={c.bookingId}>
                      <button
                        type="button"
                        onClick={() => setConfirmTarget(c)}
                        className="w-full text-left rounded-lg border border-slate-800 bg-slate-800/40 hover:bg-slate-800 hover:border-slate-600 px-3 py-2.5 transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-white truncate">{c.guestName}</span>
                          {c.guestPhoneLast4 && (
                            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                              ••••{c.guestPhoneLast4}
                            </span>
                          )}
                          <MatchBadge matchType={c.matchType} />
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px] leading-none">
                              home
                            </span>
                            {c.villaName ?? t("booking.noVilla")}
                          </span>
                          <span className="tabular-nums">
                            {mmdd(c.checkIn)}~{mmdd(c.checkOut)}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500 bg-slate-800 rounded px-1 py-0.5">
                            {c.status}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 확인 다이얼로그(오발송 방지) */}
          {confirmTarget && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmTarget(null);
              }}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-sm font-bold text-white">{t("booking.confirmTitle")}</h3>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("booking.fieldGuest")}</dt>
                    <dd className="font-bold text-white text-right">{confirmTarget.guestName}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("booking.fieldPhone")}</dt>
                    <dd className="font-mono text-slate-200 text-right tabular-nums">
                      {confirmTarget.guestPhoneLast4
                        ? `••••${confirmTarget.guestPhoneLast4}`
                        : t("booking.noPhone")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("booking.fieldVilla")}</dt>
                    <dd className="text-slate-200 text-right truncate">
                      {confirmTarget.villaName ?? t("booking.noVilla")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("booking.fieldCheckIn")}</dt>
                    <dd className="text-slate-200 text-right tabular-nums">
                      {mmdd(confirmTarget.checkIn)}~{mmdd(confirmTarget.checkOut)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200">
                  {t("booking.confirmWarning")}
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmTarget(null)}
                    disabled={linking}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {t("booking.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={doConfirmLink}
                    disabled={linking}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">add_link</span>
                    {linking ? t("booking.linking") : t("booking.doLink")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
