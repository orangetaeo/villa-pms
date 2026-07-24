"use client";

// 채팅 내 빌라 공유 (T-webchat-villa-share)
//
// [빌라 공유] 버튼 → 모달. 예약 연결 무관·항상 노출(제안 보내기와 동일 — 예약 전 문의 고객이 주 대상).
//   villa-candidates 로드(ACTIVE·isSellable 재고) → 목록(대표 사진·표시명·침실/욕실/인원·₫대표가) →
//   1개 선택 → 확인 → POST send-link{kind:"villa",villaId}. 발송은 onSendVilla(villaId)로 위임
//   (webchat-client가 스레드 재조회·목록 갱신 — 제안 모달과 동일 흐름).
//   ★표시명(name)·대표가(priceVnd)는 백엔드가 이미 공개 라벨/판매가로만 내려준 값(원가·마진 무관).
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { VillaCandidate } from "./webchat-types";

/** VND 대표가 라벨 — "₫12,100,000"(+priceIsFrom이면 " 부터"). 미설정(null)이면 null 반환(호출부가 회색 처리). */
function priceLabel(
  c: VillaCandidate,
  t: ReturnType<typeof useTranslations>
): string | null {
  if (c.priceVnd == null) return null;
  const n = Number(c.priceVnd);
  if (!Number.isFinite(n)) return null;
  const amount = `₫${n.toLocaleString("ko-KR")}`;
  return c.priceIsFrom ? `${amount} ${t("villa.fromSuffix")}` : amount;
}

export function WebChatVillaButton({
  sessionId,
  onSendVilla,
}: {
  sessionId: string;
  /** 발송 위임 — 성공 시 webchat-client가 스레드 재조회·목록 갱신. */
  onSendVilla: (villaId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("adminWebchat");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<VillaCandidate[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<VillaCandidate | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const mapSendError = useCallback(
    (error?: string): string =>
      error === "villa_not_sellable"
        ? t("villa.error.notSellable")
        : error === "SESSION_NOT_OPEN"
          ? t("villa.error.sessionClosed")
          : t("villa.error.generic"),
    [t]
  );

  // 모달 열림 시 후보 자동 로드.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/webchat/sessions/${sessionId}/villa-candidates`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((data: { candidates?: VillaCandidate[] }) => {
        if (!alive) return;
        setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      })
      .catch(() => {
        if (alive) setCandidates([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, sessionId]);

  const openModal = useCallback(() => {
    setCandidates([]);
    setConfirmTarget(null);
    setToast(null);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    setConfirmTarget(null);
  }, []);

  const doSend = useCallback(async () => {
    if (!confirmTarget || sending) return;
    setSending(true);
    setToast(null);
    const r = await onSendVilla(confirmTarget.villaId);
    setSending(false);
    if (r.ok) {
      closeModal();
    } else {
      setConfirmTarget(null);
      setToast(mapSendError(r.error));
    }
  }, [confirmTarget, sending, onSendVilla, closeModal, mapSendError]);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1.5 text-xs font-bold text-teal-200 hover:bg-teal-500/20"
      >
        <span className="material-symbols-outlined text-[15px] leading-none">villa</span>
        {t("villa.sendButton")}
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
            {/* 헤더 */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-bold text-white">{t("villa.modalTitle")}</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label={t("villa.close")}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[20px] leading-none">close</span>
              </button>
            </div>

            {/* 본문(스크롤) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
              {loading ? (
                <p className="text-center text-xs text-slate-500 py-8">{t("villa.loading")}</p>
              ) : candidates.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">{t("villa.empty")}</p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-400 mb-1.5">{t("villa.selectHint")}</p>
                  <ul className="space-y-1.5">
                    {candidates.map((c) => {
                      const price = priceLabel(c, t);
                      return (
                        <li key={c.villaId}>
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(c)}
                            className="w-full text-left rounded-lg border border-slate-800 bg-slate-800/40 hover:bg-slate-800 hover:border-slate-600 px-3 py-2.5 transition-colors flex items-center gap-3"
                          >
                            {/* 대표 사진(없으면 아이콘 플레이스홀더) */}
                            {c.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={c.photoUrl}
                                alt=""
                                className="shrink-0 w-14 h-14 rounded-lg object-cover bg-slate-800"
                                loading="lazy"
                              />
                            ) : (
                              <span className="shrink-0 w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center text-slate-600">
                                <span className="material-symbols-outlined text-[22px] leading-none">
                                  villa
                                </span>
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-sm text-white truncate">
                                  {c.name}
                                </span>
                                {price ? (
                                  <span className="shrink-0 text-xs font-bold text-teal-200 tabular-nums">
                                    {price}
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-[11px] font-bold text-slate-500">
                                    {t("villa.noPrice")}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                                {c.complex && <span className="truncate">{c.complex}</span>}
                                <span className="inline-flex items-center gap-0.5">
                                  <span className="material-symbols-outlined text-[12px] leading-none">
                                    king_bed
                                  </span>
                                  {t("villa.bedrooms", { count: c.bedrooms })}
                                </span>
                                <span className="inline-flex items-center gap-0.5">
                                  <span className="material-symbols-outlined text-[12px] leading-none">
                                    bathtub
                                  </span>
                                  {t("villa.bathrooms", { count: c.bathrooms })}
                                </span>
                                <span className="inline-flex items-center gap-0.5">
                                  <span className="material-symbols-outlined text-[12px] leading-none">
                                    group
                                  </span>
                                  {t("villa.maxGuests", { count: c.maxGuests })}
                                </span>
                                {c.hasPool && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <span className="material-symbols-outlined text-[12px] leading-none">
                                      pool
                                    </span>
                                    {t("villa.pool")}
                                  </span>
                                )}
                                {c.breakfastAvailable && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <span className="material-symbols-outlined text-[12px] leading-none">
                                      restaurant
                                    </span>
                                    {t("villa.breakfast")}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>

            {/* 하단 토스트(발송 실패) */}
            {toast && (
              <div className="shrink-0 px-4 pb-3">
                <p className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-[11px] text-red-300">
                  {toast}
                </p>
              </div>
            )}
          </div>

          {/* 확인 다이얼로그 */}
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
                <h3 className="text-sm font-bold text-white">{t("villa.confirmTitle")}</h3>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("villa.fieldVilla")}</dt>
                    <dd className="font-bold text-white text-right truncate">
                      {confirmTarget.name}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("villa.fieldPrice")}</dt>
                    <dd className="text-right">
                      {priceLabel(confirmTarget, t) ? (
                        <span className="font-bold text-teal-200 tabular-nums">
                          {priceLabel(confirmTarget, t)}
                        </span>
                      ) : (
                        <span className="text-slate-500">{t("villa.noPrice")}</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 rounded-lg bg-teal-500/10 border border-teal-500/30 px-3 py-2 text-[11px] text-teal-200">
                  {t("villa.confirmNote")}
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmTarget(null)}
                    disabled={sending}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {t("villa.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={doSend}
                    disabled={sending}
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-teal-500 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">send</span>
                    {sending ? t("villa.sending") : t("villa.doSend")}
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
