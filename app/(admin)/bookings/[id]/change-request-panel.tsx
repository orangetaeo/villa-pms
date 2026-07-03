"use client";

// 파트너 취소·변경·홀드연장 요청 처리 패널 (T-partner-workflow-gaps ②, 운영자)
//   PATCH /api/booking-change-requests/[id] — approve/reject.
//   CANCEL 승인은 실제 취소까지 수행(서버), MODIFY 승인은 표시만(실 변경은 예약변경 패널),
//   HOLD_EXTEND 승인은 만료시각 연장(24/48/72h).
//   i18n: adminBookings.changeRequest.* (ADMIN_CLIENT_NAMESPACES 화이트리스트 기존 포함)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export type AdminChangeRequestItem = {
  id: string;
  kind: string; // CANCEL | MODIFY | HOLD_EXTEND
  status: string; // PENDING | APPROVED | REJECTED
  note: string | null;
  resolutionNote: string | null;
  partnerName: string;
  createdAt: string; // ISO
  resolvedAt: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-400",
  APPROVED: "bg-teal-500/15 text-teal-400",
  REJECTED: "bg-rose-500/15 text-rose-400",
};

/** ISO → Asia/Ho_Chi_Minh "dd/MM HH:mm" */
function formatVn(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

export default function ChangeRequestPanel({
  requests,
}: {
  requests: AdminChangeRequestItem[];
}) {
  const t = useTranslations("adminBookings");
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [extendHours, setExtendHours] = useState(24);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;
  const pending = requests.filter((r) => r.status === "PENDING");
  const resolved = requests.filter((r) => r.status !== "PENDING");

  const act = async (id: string, action: "approve" | "reject", kind: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/booking-change-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(note.trim() ? { resolutionNote: note.trim() } : {}),
          ...(action === "approve" && kind === "HOLD_EXTEND" ? { extendHours } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t("changeRequest.error"));
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError(t("changeRequest.error"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-admin-card rounded-xl border border-amber-500/40 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-2">
        <span className="material-symbols-outlined text-amber-400 text-xl">campaign</span>
        <h2 className="font-bold text-sm text-white">{t("changeRequest.title")}</h2>
        {pending.length > 0 && (
          <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
            {pending.length}
          </span>
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        {pending.map((r) => (
          <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-white">
                {t(`changeRequest.kind.${r.kind}`)}
                <span className="ml-2 text-xs font-medium text-admin-muted">{r.partnerName}</span>
              </p>
              <span className="text-[11px] text-admin-muted">{formatVn(r.createdAt)}</span>
            </div>
            {r.note && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-300">{r.note}</p>
            )}

            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                placeholder={t("changeRequest.notePlaceholder")}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-teal-500"
              />
              {r.kind === "HOLD_EXTEND" && (
                <select
                  value={extendHours}
                  onChange={(e) => setExtendHours(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-teal-500"
                >
                  {[24, 48, 72].map((h) => (
                    <option key={h} value={h}>
                      {t("changeRequest.extendHours", { h })}
                    </option>
                  ))}
                </select>
              )}
              {error && busyId === null && (
                <p role="alert" className="text-xs font-medium text-rose-400">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void act(r.id, "approve", r.kind)}
                  className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {busyId === r.id
                    ? t("changeRequest.processing")
                    : t(`changeRequest.approve.${r.kind}`)}
                </button>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void act(r.id, "reject", r.kind)}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  {t("changeRequest.reject")}
                </button>
              </div>
            </div>
          </div>
        ))}

        {resolved.length > 0 && (
          <ul className="space-y-1.5">
            {resolved.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-300">
                  {t(`changeRequest.kind.${r.kind}`)}
                  <span className="ml-1.5 text-admin-muted">{r.partnerName}</span>
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    STATUS_STYLE[r.status] ?? "bg-slate-700 text-slate-300"
                  }`}
                >
                  {t(`changeRequest.status.${r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
