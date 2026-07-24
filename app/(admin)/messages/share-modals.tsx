"use client";

// 공유 선택 모달 3종 + 별명 편집 모달 (b15 변환, ADR-0009 D2/D4/D9)
// - 빌라 선택 모달: 공급자=원가만 / 고객=판매가만 (서버가 누수 분기, 후보 목록은 page.tsx에서 최소 필드)
// - 제안 선택 모달: 고객 전용. /p/[token] 공개 링크 발송(판매가만, 마진·원가 비노출)
// - 정산 선택 모달: 공급자 전용. 본인 정산 총 지급액(VND)
// - 별명 편집: 빈값=해제, 1~40자
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  VillaCandidate,
  ProposalCandidate,
  SettlementCandidate,
  ShareKind,
} from "./chat-pane";

type T = ReturnType<typeof useTranslations>;

/** VND 점 표기 (2.500.000₫) — 공급자 원가·정산 맥락 */
function fmtVndDot(v: string | null): string {
  if (v === null) return "—";
  return `${Number(v).toLocaleString("de-DE")}₫`;
}
/** KRW 원 표기 (1,280,000원) — 고객 판매가 맥락 */
function fmtKrw(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("ko-KR")}원`;
}
/** VND 쉼표 표기 (9,800,000₫) — 고객(여행사) 제안 판매가 맥락 */
function fmtVndComma(v: string | null): string {
  if (v === null) return "—";
  return `${Number(v).toLocaleString("en-US")}₫`;
}

/**
 * 빌라 후보 대표가 라벨(계약 B) — priceIsFrom이면 "…부터", 값 없으면 회색 "가격 미설정".
 * 원가/판매가(VND)는 점 표기, 고객 판매가(KRW)는 원 표기. 통화별 키는 …From 변형으로 분기.
 */
function villaPriceLabel(v: VillaCandidate, t: T): React.ReactNode {
  const hasPrice =
    v.priceLabelKind === "salePriceKrw" ? v.priceKrw !== null : v.priceVnd !== null;
  if (!hasPrice) {
    return (
      <p className="text-[11px] font-medium text-slate-500 mt-0.5">{t("shareModal.priceUnset")}</p>
    );
  }
  const key =
    v.priceLabelKind === "supplierCostVnd"
      ? v.priceIsFrom
        ? "shareModal.costPerNightFrom"
        : "shareModal.costPerNight"
      : v.priceLabelKind === "salePriceVnd"
        ? v.priceIsFrom
          ? "shareModal.salePerNightVndFrom"
          : "shareModal.salePerNightVnd"
        : v.priceIsFrom
          ? "shareModal.salePerNightFrom"
          : "shareModal.salePerNight";
  const amount =
    v.priceLabelKind === "salePriceKrw" ? fmtKrw(v.priceKrw) : fmtVndDot(v.priceVnd);
  return (
    <p className="text-[11px] font-bold text-teal-400 tabular-nums mt-0.5">{t(key, { amount })}</p>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">{title}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white shrink-0"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {children}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-800 shrink-0">
          {footer}
        </div>
      </div>
    </div>
  );
}

// 공유 후보 지연 조회 중 표시(perf) — 후보를 모달 첫 오픈 시 GET하므로 도착 전 잠깐 스피너.
// 빌라/제안/정산 공통(어떤 종류든 동일 로딩 셸). 취소만 가능, 발송 버튼 없음.
export function ShareLoadingModal({
  onClose,
  t,
}: {
  onClose: () => void;
  t: T;
}) {
  return (
    <ModalShell
      title={t("shareModal.loadingTitle")}
      subtitle={t("shareModal.loadingSubtitle")}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700"
        >
          {t("shareModal.cancel")}
        </button>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-5 py-12">
        <span className="material-symbols-outlined text-3xl text-slate-500 animate-spin">
          progress_activity
        </span>
        <p className="text-xs text-slate-400">{t("shareCandidatesLoading")}</p>
      </div>
    </ModalShell>
  );
}

// ─────────────────────── 빌라 선택 모달 ───────────────────────

export function VillaShareModal({
  candidates,
  counterparty,
  contactName,
  onClose,
  onSubmit,
  submitting,
  t,
}: {
  candidates: VillaCandidate[];
  counterparty: "SUPPLIER" | "CUSTOMER";
  contactName: string;
  onClose: () => void;
  onSubmit: (villaId: string) => void;
  submitting: boolean;
  t: T;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const isSupplier = counterparty === "SUPPLIER";

  const filtered = candidates.filter((v) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) || (v.complex ?? "").toLowerCase().includes(q)
    );
  });

  const subtitle = isSupplier
    ? t("shareModal.villaSubtitleSupplier", { name: contactName })
    : t("shareModal.villaSubtitleCustomer", { name: contactName });

  return (
    <ModalShell
      title={t("shareModal.villaTitle")}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700"
          >
            {t("shareModal.cancel")}
          </button>
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={() => selected && onSubmit(selected)}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {t("shareModal.share")}
          </button>
        </>
      }
    >
      <div className="px-5 pb-3 shrink-0">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-500 text-sm">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shareModal.villaSearch")}
            className="w-full bg-slate-800 border border-slate-700 text-sm rounded-lg pl-9 py-2 text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <p className="text-[10px] text-teal-400 font-medium mt-2">
          {isSupplier ? t("shareModal.villaHintSupplier") : t("shareModal.villaHintCustomer")}
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-3 space-y-2">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-6">{t("shareModal.empty")}</p>
        ) : (
          filtered.map((v) => {
            const active = selected === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelected(v.id)}
                className={
                  active
                    ? "w-full flex items-center gap-3 p-2.5 rounded-xl bg-blue-600/15 border border-blue-500/50 text-left"
                    : "w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left"
                }
              >
                {v.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.photoUrl}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover shrink-0 bg-slate-800"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-slate-600">villa</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{v.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {[v.complex, t("shareModal.bedrooms", { n: v.bedrooms }), t("shareModal.bathrooms", { n: v.bathrooms })]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {villaPriceLabel(v, t)}
                </div>
                <span
                  className={
                    active
                      ? "material-symbols-outlined text-blue-400"
                      : "material-symbols-outlined text-slate-600"
                  }
                  style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {active ? "check_circle" : "radio_button_unchecked"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </ModalShell>
  );
}

// ─────────────────────── 제안 선택 모달 (고객 전용) ───────────────────────

export function ProposalShareModal({
  candidates,
  contactName,
  showingAll,
  onShowAll,
  onClose,
  onSubmit,
  submitting,
  t,
}: {
  candidates: ProposalCandidate[];
  contactName: string;
  /** 전체 제안 보기 활성 여부(계약 J) — true면 다른 대화 귀속분 포함 전체. */
  showingAll: boolean;
  /** "전체 제안 보기" 클릭 → allProposals=1 재조회. */
  onShowAll: () => void;
  onClose: () => void;
  onSubmit: (proposalId: string) => void;
  submitting: boolean;
  t: T;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ModalShell
      title={t("shareModal.proposalTitle")}
      subtitle={t("shareModal.proposalSubtitle", { name: contactName })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700"
          >
            {t("shareModal.cancel")}
          </button>
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={() => selected && onSubmit(selected)}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {t("shareModal.sendLink")}
          </button>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pt-2 space-y-2">
        {candidates.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-6">{t("shareModal.proposalEmpty")}</p>
        ) : (
          candidates.map((p) => {
            const active = selected === p.id;
            const urgent = p.expiresInHours <= 6;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                className={
                  active
                    ? "w-full p-3 rounded-xl bg-blue-600/15 border border-blue-500/50 text-left"
                    : "w-full p-3 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left"
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">
                      {t("shareModal.proposalFor", { name: p.clientName })}
                    </span>
                    {/* 전체 보기에서 이 대화 귀속 제안 구분(계약 I/J) */}
                    {showingAll && p.boundHere && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[9px] font-bold">
                        {t("shareModal.proposalBoundHere")}
                      </span>
                    )}
                  </p>
                  <span
                    className={
                      active
                        ? "material-symbols-outlined text-blue-400 shrink-0"
                        : "material-symbols-outlined text-slate-600 shrink-0"
                    }
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {active ? "check_circle" : "radio_button_unchecked"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 truncate">
                  {p.villaNames.join(" · ")} ({t("shareModal.villaCount", { n: p.villaNames.length })})
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={
                      urgent
                        ? "px-2 py-0.5 rounded bg-red-500/15 text-red-400 text-[10px] font-bold tabular-nums"
                        : "px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-bold tabular-nums"
                    }
                  >
                    {t("shareModal.expiresIn", { h: p.expiresInHours })}
                  </span>
                  <span className="text-[11px] font-bold text-white tabular-nums">
                    {t("shareModal.total", {
                      amount:
                        p.currency === "KRW"
                          ? fmtKrw(p.totalKrw)
                          : fmtVndComma(p.totalVnd),
                    })}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
      {/* 전체 제안 보기 토글(계약 J) — 기본은 매칭+미귀속만. 클릭 시 다른 대화 귀속분 포함 전체 재조회. */}
      <div className="border-t border-slate-800 px-5 py-2 shrink-0">
        {showingAll ? (
          <p className="text-[11px] text-slate-500 text-center">
            {t("shareModal.proposalShowingAll")}
          </p>
        ) : (
          <button
            type="button"
            onClick={onShowAll}
            className="w-full text-[11px] font-bold text-blue-400 hover:text-blue-300 py-1"
          >
            {t("shareModal.proposalShowAll")}
          </button>
        )}
      </div>
      <div className="bg-slate-800/40 border-t border-slate-800 px-5 py-2.5 flex items-center gap-2 shrink-0">
        <span className="material-symbols-outlined text-[16px] text-slate-500">link</span>
        <p className="text-[11px] text-slate-400 flex-1">{t("shareModal.proposalGuard")}</p>
      </div>
    </ModalShell>
  );
}

// ─────────────────────── 정산 선택 모달 (공급자 전용) ───────────────────────

const SETTLEMENT_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-600/30 text-slate-300",
  CONFIRMED: "bg-green-500/15 text-green-400",
  COLLECTED: "bg-violet-500/15 text-violet-400",
  FX_ADJUSTED: "bg-amber-500/15 text-amber-400",
  PAID: "bg-blue-500/15 text-blue-400",
};

export function SettlementShareModal({
  candidates,
  contactName,
  onClose,
  onSubmit,
  submitting,
  t,
}: {
  candidates: SettlementCandidate[];
  contactName: string;
  onClose: () => void;
  onSubmit: (settlementId: string) => void;
  submitting: boolean;
  t: T;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ModalShell
      title={t("shareModal.settlementTitle")}
      subtitle={t("shareModal.settlementSubtitle", { name: contactName })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700"
          >
            {t("shareModal.cancel")}
          </button>
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={() => selected && onSubmit(selected)}
            className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {t("shareModal.sendSummary")}
          </button>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pt-1 space-y-2">
        {candidates.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-6">{t("shareModal.settlementEmpty")}</p>
        ) : (
          candidates.map((s) => {
            const active = selected === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={
                  active
                    ? "w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/50 text-left"
                    : "w-full p-3 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left"
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white">{s.label}</p>
                  <span
                    className={
                      active
                        ? "material-symbols-outlined text-amber-400 shrink-0"
                        : "material-symbols-outlined text-slate-600 shrink-0"
                    }
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {active ? "check_circle" : "radio_button_unchecked"}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2 gap-2">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    {t("shareModal.bookingCount", { n: s.itemCount })}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        SETTLEMENT_STATUS_STYLE[s.status] ?? "bg-slate-600/30 text-slate-300"
                      }`}
                    >
                      {t(`settlementStatus.${s.status}`)}
                    </span>
                  </span>
                  <span
                    className={
                      active
                        ? "text-sm font-bold text-amber-400 tabular-nums"
                        : "text-sm font-bold text-slate-300 tabular-nums"
                    }
                  >
                    {fmtVndDot(s.totalVnd)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="bg-slate-800/40 border-t border-slate-800 px-5 py-2.5 flex items-center gap-2 shrink-0">
        <span className="material-symbols-outlined text-[16px] text-slate-500">shield</span>
        <p className="text-[11px] text-slate-400 flex-1">{t("shareModal.settlementGuard")}</p>
      </div>
    </ModalShell>
  );
}

// ─────────────────────── 게스트 링크 모달 (C, CUSTOMER 전용) ───────────────────────

/** 게스트 링크 종류 — /g 체크인·부가서비스·영수증. */
type GuestLinkKind = "checkin" | "options" | "receipt";

/** 예약 후보(금액 무관) — guest-link-bookings 라우트 응답. */
interface GuestLinkBooking {
  bookingId: string;
  guestName: string;
  guestPhoneLast4: string | null;
  villaName: string | null;
  checkIn: string; // ISO
  checkOut: string; // ISO
  status: string;
  checkedOut: boolean; // 영수증 발송 가능 여부
}

/** ISO(@db.Date UTC 자정) → "M.D". */
function fmtMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}

/**
 * 게스트 링크 공유 모달 — CUSTOMER(투숙객) 1:1 대화 전용.
 *  예약 검색/최근 목록에서 1건 선택 + 링크 종류(체크인·부가서비스·영수증) 선택 → 발송.
 *  영수증은 체크아웃 완료 예약만 활성(서버도 이중 가드). 금액 없음(안내문·링크뿐).
 */
export function GuestLinkShareModal({
  conversationId,
  contactName,
  onClose,
  onSubmit,
  submitting,
  t,
}: {
  conversationId: string;
  contactName: string;
  onClose: () => void;
  onSubmit: (kind: GuestLinkKind, bookingId: string) => void;
  submitting: boolean;
  t: T;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [bookings, setBookings] = useState<GuestLinkBooking[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kind, setKind] = useState<GuestLinkKind>("checkin");

  // 검색어 디바운스(300ms) — 타이핑마다 요청 방지.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(h);
  }, [query]);

  // 예약 후보 조회 — 최초(빈 검색)와 검색어 변경 시. 대화 스코프 + CUSTOMER 게이트는 서버가 검증.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    fetch(`/api/zalo/conversations/${conversationId}/guest-link-bookings?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { bookings: [] }))
      .then((data: { bookings?: GuestLinkBooking[] }) => {
        if (!alive) return;
        setBookings(data.bookings ?? []);
      })
      .catch(() => {
        if (alive) setBookings([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [conversationId, debounced]);

  const selected = bookings?.find((b) => b.bookingId === selectedId) ?? null;
  // 선택 예약이 체크아웃 전이면 영수증 발송 불가 → receipt 선택 상태면 checkin으로 되돌림.
  const receiptEnabled = selected?.checkedOut ?? false;
  const effectiveKind: GuestLinkKind = kind === "receipt" && !receiptEnabled ? "checkin" : kind;

  const kindOptions: { value: GuestLinkKind; label: string; icon: string; disabled: boolean }[] = [
    { value: "checkin", label: t("guestLinkModal.kindCheckin"), icon: "key", disabled: false },
    { value: "options", label: t("guestLinkModal.kindOptions"), icon: "room_service", disabled: false },
    {
      value: "receipt",
      label: t("guestLinkModal.kindReceipt"),
      icon: "receipt_long",
      disabled: !receiptEnabled,
    },
  ];

  return (
    <ModalShell
      title={t("guestLinkModal.title")}
      subtitle={t("guestLinkModal.subtitle", { name: contactName })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700"
          >
            {t("shareModal.cancel")}
          </button>
          <button
            type="button"
            disabled={!selectedId || submitting}
            onClick={() => selectedId && onSubmit(effectiveKind, selectedId)}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {t("shareModal.sendLink")}
          </button>
        </>
      }
    >
      {/* 링크 종류 선택 — 체크인·부가서비스·영수증. 영수증은 체크아웃 완료 예약만 활성. */}
      <div className="px-5 pb-3 shrink-0">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
          {t("guestLinkModal.kindHeading")}
        </p>
        <div className="flex items-center gap-1.5">
          {kindOptions.map((o) => {
            const active = effectiveKind === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => setKind(o.value)}
                title={o.disabled ? t("guestLinkModal.receiptOnlyCheckedOut") : undefined}
                className={
                  active
                    ? "flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/50 text-emerald-300 text-xs font-bold"
                    : o.disabled
                      ? "flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-800 text-slate-600 text-xs font-bold cursor-not-allowed"
                      : "flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800/50"
                }
              >
                <span className="material-symbols-outlined text-[16px]">{o.icon}</span>
                {o.label}
              </button>
            );
          })}
        </div>
        {kind === "receipt" && selected && !receiptEnabled && (
          <p className="text-[10px] text-amber-400 mt-1.5">
            {t("guestLinkModal.receiptOnlyCheckedOut")}
          </p>
        )}
      </div>

      {/* 예약 검색 */}
      <div className="px-5 pb-3 shrink-0">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-500 text-sm">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("guestLinkModal.searchPlaceholder")}
            className="w-full bg-slate-800 border border-slate-700 text-sm rounded-lg pl-9 py-2 text-slate-200 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* 예약 목록 */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-3 space-y-2">
        {loading || bookings === null ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <span className="material-symbols-outlined text-2xl text-slate-500 animate-spin">
              progress_activity
            </span>
            <p className="text-xs text-slate-500">{t("guestLinkModal.loading")}</p>
          </div>
        ) : bookings.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-6">{t("guestLinkModal.empty")}</p>
        ) : (
          bookings.map((b) => {
            const active = selectedId === b.bookingId;
            return (
              <button
                key={b.bookingId}
                type="button"
                onClick={() => setSelectedId(b.bookingId)}
                className={
                  active
                    ? "w-full p-3 rounded-xl bg-emerald-600/15 border border-emerald-500/50 text-left"
                    : "w-full p-3 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left"
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white truncate">
                    {b.guestName}
                    {b.guestPhoneLast4 && (
                      <span className="text-[11px] font-medium text-slate-500 ml-1.5">
                        ···{b.guestPhoneLast4}
                      </span>
                    )}
                  </p>
                  <span
                    className={
                      active
                        ? "material-symbols-outlined text-emerald-400 shrink-0"
                        : "material-symbols-outlined text-slate-600 shrink-0"
                    }
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {active ? "check_circle" : "radio_button_unchecked"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {b.villaName && (
                    <span className="text-[11px] text-slate-400 truncate">{b.villaName}</span>
                  )}
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {fmtMonthDay(b.checkIn)} ~ {fmtMonthDay(b.checkOut)}
                  </span>
                  {b.checkedOut && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-600/30 text-slate-300 text-[9px] font-bold">
                      {t("guestLinkModal.checkedOutBadge")}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="bg-slate-800/40 border-t border-slate-800 px-5 py-2.5 flex items-center gap-2 shrink-0">
        <span className="material-symbols-outlined text-[16px] text-slate-500">link</span>
        <p className="text-[11px] text-slate-400 flex-1">{t("guestLinkModal.guard")}</p>
      </div>
    </ModalShell>
  );
}

// ─────────────────────── 별명 편집 모달 (D9) ───────────────────────

export function NicknameModal({
  initial,
  zaloOriginalName,
  onClose,
  onSubmit,
  submitting,
  t,
}: {
  initial: string;
  zaloOriginalName: string | null;
  onClose: () => void;
  onSubmit: (nickname: string) => void;
  submitting: boolean;
  t: T;
}) {
  const [value, setValue] = useState(initial);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-sm font-bold text-white">{t("nickname.title")}</h2>
          {zaloOriginalName && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t("nickname.zaloOriginal", { name: zaloOriginalName })}
            </p>
          )}
        </div>
        <div className="px-5 pb-4">
          <input
            type="text"
            autoFocus
            maxLength={40}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) onSubmit(value);
            }}
            className="w-full bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-2.5 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-[10px] text-slate-500 mt-1.5">{t("nickname.hint")}</p>
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700"
            >
              {t("shareModal.cancel")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onSubmit(value)}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold"
            >
              {t("nickname.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { ShareKind };
