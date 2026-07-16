"use client";

// 입력창 위 빠른 링크 버튼 3종 (T-webchat-guest-link-share)
//
// [체크인 안내][부가서비스][영수증] — 연결된 세션만 노출. 클릭 → 간단 confirm → POST send-link.
// 성공 시 스레드가 재조회로 즉시 반영(onSend가 처리). 실패는 전용 문구 토스트.
//   영수증은 항상 노출하되 체크아웃 여부는 서버가 판정(400 not_checked_out → 전용 문구).
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { QuickLinkKind } from "./webchat-types";

const KINDS: { kind: QuickLinkKind; icon: string; labelKey: string }[] = [
  { kind: "checkin", icon: "home", labelKey: "quickLink.checkin" },
  { kind: "options", icon: "room_service", labelKey: "quickLink.options" },
  { kind: "receipt", icon: "receipt_long", labelKey: "quickLink.receipt" },
];

export function WebChatQuickLinks({
  onSend,
}: {
  onSend: (kind: QuickLinkKind) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("adminWebchat");
  const [busy, setBusy] = useState<QuickLinkKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const click = async (kind: QuickLinkKind) => {
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
        {KINDS.map(({ kind, icon, labelKey }) => (
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
      </div>
      {toast && (
        <p className="mt-1.5 rounded-lg bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-[11px] text-red-300">
          {toast}
        </p>
      )}
    </div>
  );
}
