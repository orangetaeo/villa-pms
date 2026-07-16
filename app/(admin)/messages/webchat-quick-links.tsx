"use client";

// 입력창 위 빠른 링크 바 (T-webchat-guest-link-share · T-webchat-proposal-link-send)
//
// [체크인 안내][부가서비스][영수증] — 예약 연결된 세션만 노출(hasBooking). 클릭 → 간단 confirm → POST send-link.
// [제안 보내기] — 예약 연결 무관·항상 노출(예약 전 문의 고객 대상). 클릭 → 제안 모달(기존 선택 / 새 생성).
// 성공 시 스레드가 재조회로 즉시 반영(onSend/onSendProposal이 처리). 실패는 전용 문구.
//   영수증은 항상 노출하되 체크아웃 여부는 서버가 판정(400 not_checked_out → 전용 문구).
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { QuickLinkKind } from "./webchat-types";
import { WebChatProposalButton } from "./webchat-proposal-modal";

// 확인 후 즉시 발송하는 예약 연동 kind 3종(proposal은 별도 모달이므로 제외).
type ConfirmKind = Exclude<QuickLinkKind, "proposal">;
const KINDS: { kind: ConfirmKind; icon: string; labelKey: string }[] = [
  { kind: "checkin", icon: "home", labelKey: "quickLink.checkin" },
  { kind: "options", icon: "room_service", labelKey: "quickLink.options" },
  { kind: "receipt", icon: "receipt_long", labelKey: "quickLink.receipt" },
];

export function WebChatQuickLinks({
  sessionId,
  hasBooking,
  canCreateProposal,
  defaultClientName,
  onSend,
  onSendProposal,
}: {
  sessionId: string;
  /** 예약 연결 여부 — 체크인·부가서비스·영수증 3종은 연결된 세션만 노출. */
  hasBooking: boolean;
  /** 제안 생성 권한(canSetPrice). 모달 B 섹션 게이트용. */
  canCreateProposal: boolean;
  /** 새 제안 clientName 기본값. */
  defaultClientName: string;
  onSend: (kind: QuickLinkKind) => Promise<{ ok: boolean; error?: string }>;
  onSendProposal: (proposalId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("adminWebchat");
  const [busy, setBusy] = useState<ConfirmKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const click = async (kind: ConfirmKind) => {
    if (busy) return;
    if (!window.confirm(t(`quickLink.confirm.${kind}`))) return;
    setBusy(kind);
    setToast(null);
    const r = await onSend(kind);
    setBusy(null);
    if (!r.ok) {
      const msg =
        r.error === "not_checked_out"
          ? t("quickLink.error.notCheckedOut")
          : r.error === "not_linked"
            ? t("quickLink.error.notLinked")
            : r.error === "SESSION_NOT_OPEN"
              ? t("quickLink.error.sessionClosed")
              : t("quickLink.error.generic");
      setToast(msg);
    }
  };

  return (
    <div className="shrink-0 px-3 pt-2.5 pb-1 bg-slate-900">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-bold text-slate-500 mr-0.5">{t("quickLink.label")}</span>
        {hasBooking &&
          KINDS.map(({ kind, icon, labelKey }) => (
            <button
              key={kind}
              type="button"
              onClick={() => click(kind)}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:border-teal-500/40 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[15px] leading-none text-teal-400">
                {icon}
              </span>
              {busy === kind ? t("quickLink.sending") : t(labelKey)}
            </button>
          ))}
        {/* 제안 보내기 — 항상 노출(예약 연결 무관) */}
        <WebChatProposalButton
          sessionId={sessionId}
          canCreateProposal={canCreateProposal}
          defaultClientName={defaultClientName}
          onSendProposal={onSendProposal}
        />
      </div>
      {toast && (
        <p className="mt-1.5 rounded-lg bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-[11px] text-red-300">
          {toast}
        </p>
      )}
    </div>
  );
}
