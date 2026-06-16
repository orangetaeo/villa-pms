"use client";

// 공유 선택 모달 3종 + 별명 편집 모달 (b15 변환, ADR-0009 D2/D4/D9)
// - 빌라 선택 모달: 공급자=원가만 / 고객=판매가만 (서버가 누수 분기, 후보 목록은 page.tsx에서 최소 필드)
// - 제안 선택 모달: 고객 전용. /p/[token] 공개 링크 발송(판매가만, 마진·원가 비노출)
// - 정산 선택 모달: 공급자 전용. 본인 정산 총 지급액(VND)
// - 별명 편집: 빈값=해제, 1~40자
import { useState } from "react";
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
                  <p className="text-[11px] font-bold text-teal-400 tabular-nums mt-0.5">
                    {v.priceLabelKind === "supplierCostVnd"
                      ? t("shareModal.costPerNight", { amount: fmtVndDot(v.priceVnd) })
                      : v.priceLabelKind === "salePriceVnd"
                        ? t("shareModal.salePerNightVnd", { amount: fmtVndDot(v.priceVnd) })
                        : t("shareModal.salePerNight", { amount: fmtKrw(v.priceKrw) })}
                  </p>
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
  onClose,
  onSubmit,
  submitting,
  t,
}: {
  candidates: ProposalCandidate[];
  contactName: string;
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
                  <p className="text-sm font-bold text-white truncate">
                    {t("shareModal.proposalFor", { name: p.clientName })}
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
