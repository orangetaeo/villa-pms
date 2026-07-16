"use client";

// 채팅 내 제안(/p) 링크 발송·생성 (T-webchat-proposal-link-send)
//
// [제안 보내기] 버튼 → 모달. 예약 연결 무관·항상 노출(예약 전 문의 고객이 주 대상).
//   A. 기존 제안 선택: proposal-candidates 로드 → 선택 → 확인 → send-link(kind=proposal) 발송.
//   B. 새 제안 만들기(canSetPrice 게이트 — 서버 POST /api/proposals가 정본, UI는 안내만):
//      날짜 → 빌라 검색(GET /api/proposals/candidates) → 1~3개 선택 → 유효기간 → 생성 → 즉시 발송 체이닝.
// 발송 자체는 onSendProposal(proposalId)로 위임(webchat-client가 스레드 재조회·목록 갱신).
//   생성 API·후보 API는 이 컴포넌트가 직접 fetch(booking-bar 패턴 준용). 판매가 표시는 운영자 전용 다크 모달 내부라 OK.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import type { ProposalCandidate, ProposalVillaCandidate } from "./webchat-types";

type Tab = "existing" | "create";
type Expiry = 24 | 48;

/** ISO → "MM.DD"(Asia/Ho_Chi_Minh). */
function mmdd(iso: string | null): string {
  if (!iso) return "";
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

/** 만료까지 남은 시간 라벨(대략) — 24h 이상은 '일', 미만은 '시간', 경과·임박은 '곧 만료'. */
function expiresLabel(iso: string, t: ReturnType<typeof useTranslations>): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return t("proposal.expiresSoon");
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return t("proposal.expiresSoon");
  if (hours >= 24) return t("proposal.daysLeft", { days: Math.floor(hours / 24) });
  return t("proposal.hoursLeft", { hours });
}

/** 판매가 요약 — KRW 우선, 없으면 VND. 둘 다 없으면 빈 문자열. */
function priceLabel(v: ProposalVillaCandidate): string {
  if (v.totalSaleKrw != null) return `₩${v.totalSaleKrw.toLocaleString("ko-KR")}`;
  if (v.totalSaleVnd) {
    const n = Number(v.totalSaleVnd);
    if (Number.isFinite(n)) return `₫${n.toLocaleString("ko-KR")}`;
  }
  return "";
}

export function WebChatProposalButton({
  sessionId,
  canCreateProposal,
  defaultClientName,
  onSendProposal,
}: {
  sessionId: string;
  /** 제안 생성 권한(canSetPrice). false면 B 섹션은 안내만(서버가 정본). */
  canCreateProposal: boolean;
  /** 새 제안 clientName 기본값(세션 연락처 또는 폴백 문구는 호출부가 결정). */
  defaultClientName: string;
  /** 발송 위임 — 성공 시 webchat-client가 스레드 재조회·목록 갱신. */
  onSendProposal: (proposalId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("adminWebchat");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("existing");
  const [toast, setToast] = useState<string | null>(null);

  // ── A. 기존 제안 ──
  const [candidates, setCandidates] = useState<ProposalCandidate[]>([]);
  const [loadingA, setLoadingA] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ProposalCandidate | null>(null);
  const [sendingA, setSendingA] = useState(false);

  // ── B. 새 제안 ──
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [villas, setVillas] = useState<ProposalVillaCandidate[] | null>(null);
  const [loadingVillas, setLoadingVillas] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expiry, setExpiry] = useState<Expiry>(48);
  const [clientName, setClientName] = useState(defaultClientName);
  const [creating, setCreating] = useState(false);

  const mapSendError = useCallback(
    (error?: string): string =>
      error === "proposal_not_active"
        ? t("proposal.error.notActive")
        : error === "SESSION_NOT_OPEN"
          ? t("proposal.error.sessionClosed")
          : t("proposal.error.generic"),
    [t]
  );

  // 모달 열림 시 기존 제안 후보 자동 로드.
  useEffect(() => {
    if (!open || tab !== "existing") return;
    let alive = true;
    setLoadingA(true);
    fetch(`/api/webchat/sessions/${sessionId}/proposal-candidates`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((data: { candidates?: ProposalCandidate[] }) => {
        if (!alive) return;
        setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      })
      .catch(() => {
        if (alive) setCandidates([]);
      })
      .finally(() => {
        if (alive) setLoadingA(false);
      });
    return () => {
      alive = false;
    };
  }, [open, tab, sessionId]);

  const openModal = useCallback(() => {
    setTab("existing");
    setToast(null);
    setConfirmTarget(null);
    setCandidates([]);
    setCheckIn("");
    setCheckOut("");
    setVillas(null);
    setSearchError(null);
    setSelected(new Set());
    setExpiry(48);
    setClientName(defaultClientName);
    setOpen(true);
  }, [defaultClientName]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setConfirmTarget(null);
  }, []);

  // A. 확인 후 발송.
  const doSendExisting = useCallback(async () => {
    if (!confirmTarget || sendingA) return;
    setSendingA(true);
    setToast(null);
    const r = await onSendProposal(confirmTarget.proposalId);
    setSendingA(false);
    if (r.ok) {
      closeModal();
    } else {
      setConfirmTarget(null);
      setToast(mapSendError(r.error));
    }
  }, [confirmTarget, sendingA, onSendProposal, closeModal, mapSendError]);

  // B. 빌라 검색.
  const searchVillas = useCallback(async () => {
    if (loadingVillas) return;
    if (!checkIn || !checkOut || checkIn >= checkOut) {
      setSearchError(t("proposal.error.invalidDates"));
      return;
    }
    setLoadingVillas(true);
    setSearchError(null);
    setSelected(new Set());
    try {
      const qs = new URLSearchParams({ checkIn, checkOut, channel: "DIRECT" });
      const res = await fetch(`/api/proposals/candidates?${qs.toString()}`);
      if (res.status === 403) {
        setVillas([]);
        setSearchError(t("proposal.error.forbidden"));
        return;
      }
      if (!res.ok) {
        setVillas([]);
        setSearchError(t("proposal.error.searchFailed"));
        return;
      }
      const data = (await res.json()) as { candidates?: ProposalVillaCandidate[] };
      setVillas(Array.isArray(data.candidates) ? data.candidates : []);
    } catch {
      setVillas([]);
      setSearchError(t("proposal.error.searchFailed"));
    } finally {
      setLoadingVillas(false);
    }
  }, [loadingVillas, checkIn, checkOut, t]);

  const toggleVilla = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 3) return prev; // 최대 3개
        next.add(id);
      }
      return next;
    });
  }, []);

  // B. 생성 → 발송 체이닝.
  const createAndSend = useCallback(async () => {
    if (creating) return;
    if (selected.size < 1 || selected.size > 3) return;
    const name = clientName.trim();
    if (!name) {
      setSearchError(t("proposal.error.clientNameRequired"));
      return;
    }
    setCreating(true);
    setToast(null);
    setSearchError(null);
    try {
      const items = Array.from(selected).map((villaId) => ({ villaId, checkIn, checkOut }));
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: name,
          channel: "DIRECT",
          expiresInHours: expiry,
          items,
        }),
      });
      if (res.status === 403) {
        setSearchError(t("proposal.error.forbidden"));
        return;
      }
      if (res.status === 409) {
        setSearchError(t("proposal.error.itemsUnavailable"));
        return;
      }
      if (!res.ok) {
        setSearchError(t("proposal.error.createFailed"));
        return;
      }
      const data = (await res.json()) as { proposal?: { id?: string } };
      const newId = data.proposal?.id;
      if (!newId) {
        setSearchError(t("proposal.error.createFailed"));
        return;
      }
      // 생성 성공 → 즉시 발송 체이닝.
      const sent = await onSendProposal(newId);
      if (sent.ok) {
        closeModal();
      } else {
        setToast(mapSendError(sent.error));
      }
    } catch {
      setSearchError(t("proposal.error.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [creating, selected, clientName, checkIn, checkOut, expiry, onSendProposal, closeModal, mapSendError, t]);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1.5 text-xs font-bold text-teal-200 hover:bg-teal-500/20"
      >
        <span className="material-symbols-outlined text-[15px] leading-none">local_offer</span>
        {t("proposal.sendButton")}
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
              <h2 className="text-sm font-bold text-white">{t("proposal.modalTitle")}</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label={t("proposal.close")}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[20px] leading-none">close</span>
              </button>
            </div>

            {/* 탭 */}
            <div className="shrink-0 flex gap-1 px-4 pt-3">
              <button
                type="button"
                onClick={() => setTab("existing")}
                className={
                  tab === "existing"
                    ? "flex-1 rounded-lg bg-teal-500/15 border border-teal-500/40 px-3 py-1.5 text-xs font-bold text-teal-200"
                    : "flex-1 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-800"
                }
              >
                {t("proposal.tabExisting")}
              </button>
              <button
                type="button"
                onClick={() => setTab("create")}
                className={
                  tab === "create"
                    ? "flex-1 rounded-lg bg-teal-500/15 border border-teal-500/40 px-3 py-1.5 text-xs font-bold text-teal-200"
                    : "flex-1 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-800"
                }
              >
                {t("proposal.tabCreate")}
              </button>
            </div>

            {/* 본문(스크롤) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
              {tab === "existing" ? (
                // ── A. 기존 제안 목록 ──
                loadingA ? (
                  <p className="text-center text-xs text-slate-500 py-8">{t("loading")}</p>
                ) : candidates.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-8">
                    {t("proposal.noCandidates")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {candidates.map((c) => (
                      <li key={c.proposalId}>
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(c)}
                          className="w-full text-left rounded-lg border border-slate-800 bg-slate-800/40 hover:bg-slate-800 hover:border-slate-600 px-3 py-2.5 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-white truncate">
                              {c.clientName}
                            </span>
                            <span className="shrink-0 text-[10px] font-bold text-amber-200 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">
                              {expiresLabel(c.expiresAt, t)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <span className="material-symbols-outlined text-[13px] leading-none">
                                home
                              </span>
                              <span className="truncate">
                                {c.villaNames.length > 0
                                  ? t("proposal.villaSummary", {
                                      first: c.villaNames[0],
                                      count: c.villaNames.length,
                                    })
                                  : t("proposal.noVilla")}
                              </span>
                            </span>
                            {c.checkIn && c.checkOut && (
                              <span className="tabular-nums whitespace-nowrap">
                                {mmdd(c.checkIn)}~{mmdd(c.checkOut)}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : // ── B. 새 제안 만들기 ──
              !canCreateProposal ? (
                <p className="rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-3 text-xs text-slate-300">
                  {t("proposal.createForbidden")}
                </p>
              ) : (
                <div className="space-y-3">
                  {/* 날짜 */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400">
                        {t("proposal.checkIn")}
                      </span>
                      <DateField
                        value={checkIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        placeholder={t("proposal.datePlaceholder")}
                        className="mt-1 w-full bg-slate-800/60 border border-slate-700 text-sm rounded-lg px-3 py-2 text-slate-100 [color-scheme:dark]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400">
                        {t("proposal.checkOut")}
                      </span>
                      <DateField
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        placeholder={t("proposal.datePlaceholder")}
                        className="mt-1 w-full bg-slate-800/60 border border-slate-700 text-sm rounded-lg px-3 py-2 text-slate-100 [color-scheme:dark]"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={searchVillas}
                    disabled={loadingVillas}
                    className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">search</span>
                    {loadingVillas ? t("loading") : t("proposal.searchVillas")}
                  </button>

                  {/* 빌라 후보 */}
                  {villas != null &&
                    (villas.length === 0 ? (
                      <p className="text-center text-xs text-slate-500 py-4">
                        {t("proposal.noVillas")}
                      </p>
                    ) : (
                      <div>
                        <p className="text-[11px] text-slate-400 mb-1.5">
                          {t("proposal.selectHint", { count: selected.size })}
                        </p>
                        <ul className="space-y-1">
                          {villas.map((v) => {
                            const on = selected.has(v.id);
                            const disabled = !on && selected.size >= 3;
                            const price = priceLabel(v);
                            return (
                              <li key={v.id}>
                                <button
                                  type="button"
                                  onClick={() => toggleVilla(v.id)}
                                  disabled={disabled}
                                  className={
                                    on
                                      ? "w-full text-left rounded-lg border border-teal-500/50 bg-teal-500/10 px-3 py-2 transition-colors"
                                      : "w-full text-left rounded-lg border border-slate-800 bg-slate-800/40 hover:bg-slate-800 px-3 py-2 transition-colors disabled:opacity-40"
                                  }
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={
                                        on
                                          ? "material-symbols-outlined text-[17px] leading-none text-teal-300"
                                          : "material-symbols-outlined text-[17px] leading-none text-slate-500"
                                      }
                                    >
                                      {on ? "check_box" : "check_box_outline_blank"}
                                    </span>
                                    <span className="font-bold text-sm text-white truncate flex-1 min-w-0">
                                      {v.name}
                                    </span>
                                    {price && (
                                      <span className="shrink-0 text-xs font-bold text-teal-200 tabular-nums">
                                        {price}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-0.5 pl-6 flex items-center gap-2 text-[11px] text-slate-400">
                                    {v.complex && <span className="truncate">{v.complex}</span>}
                                    <span className="inline-flex items-center gap-0.5">
                                      <span className="material-symbols-outlined text-[12px] leading-none">
                                        group
                                      </span>
                                      {t("proposal.maxGuests", { count: v.maxGuests })}
                                    </span>
                                    <span className="tabular-nums">
                                      {t("proposal.nights", { count: v.nights })}
                                    </span>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>

                        {/* 유효기간 */}
                        <div className="mt-3">
                          <span className="text-[11px] font-bold text-slate-400">
                            {t("proposal.validity")}
                          </span>
                          <div className="mt-1 flex gap-2">
                            {([48, 24] as Expiry[]).map((h) => (
                              <button
                                key={h}
                                type="button"
                                onClick={() => setExpiry(h)}
                                className={
                                  expiry === h
                                    ? "flex-1 rounded-lg bg-teal-500/15 border border-teal-500/40 px-3 py-1.5 text-xs font-bold text-teal-200"
                                    : "flex-1 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-800"
                                }
                              >
                                {t("proposal.hoursOption", { hours: h })}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 고객명 */}
                        <label className="mt-3 block">
                          <span className="text-[11px] font-bold text-slate-400">
                            {t("proposal.clientName")}
                          </span>
                          <input
                            type="text"
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            className="mt-1 w-full bg-slate-800/60 border border-slate-700 text-sm rounded-lg px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={createAndSend}
                          disabled={creating || selected.size < 1}
                          className="mt-3 w-full inline-flex items-center justify-center gap-1 rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-500 disabled:opacity-40"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none">
                            send
                          </span>
                          {creating ? t("proposal.creating") : t("proposal.createAndSend")}
                        </button>
                      </div>
                    ))}

                  {searchError && (
                    <p className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-[11px] text-red-300">
                      {searchError}
                    </p>
                  )}
                </div>
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

          {/* A. 확인 다이얼로그 */}
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
                <h3 className="text-sm font-bold text-white">{t("proposal.confirmTitle")}</h3>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("proposal.fieldClient")}</dt>
                    <dd className="font-bold text-white text-right truncate">
                      {confirmTarget.clientName}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("proposal.fieldVillas")}</dt>
                    <dd className="text-slate-200 text-right truncate max-w-[220px]">
                      {confirmTarget.villaNames.length > 0
                        ? confirmTarget.villaNames.join(", ")
                        : t("proposal.noVilla")}
                    </dd>
                  </div>
                  {confirmTarget.checkIn && confirmTarget.checkOut && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">{t("proposal.fieldDates")}</dt>
                      <dd className="text-slate-200 text-right tabular-nums">
                        {mmdd(confirmTarget.checkIn)}~{mmdd(confirmTarget.checkOut)}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t("proposal.fieldExpires")}</dt>
                    <dd className="text-amber-200 text-right">
                      {expiresLabel(confirmTarget.expiresAt, t)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 rounded-lg bg-teal-500/10 border border-teal-500/30 px-3 py-2 text-[11px] text-teal-200">
                  {t("proposal.confirmNote")}
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmTarget(null)}
                    disabled={sendingA}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {t("proposal.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={doSendExisting}
                    disabled={sendingA}
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-teal-500 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">send</span>
                    {sendingA ? t("proposal.sending") : t("proposal.doSend")}
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
