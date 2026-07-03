"use client";

// 파트너 예약 취소·변경·홀드연장 요청 패널 (T-partner-workflow-gaps ②)
//   POST /api/partner/bookings/[id]/change-request — 요청은 큐 적재만(예약 무변경, 운영자 승인형).
//   PENDING 1건 제한(서버 409) — 미해결 요청이 있으면 새 요청 버튼 대신 진행중 카드를 보여준다.
//   i18n: partner.changeRequest.* (파트너 레이아웃이 partner 네임스페이스 직렬화 — 신규 네임스페이스 금지)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export type ChangeRequestItem = {
  id: string;
  kind: string; // CANCEL | MODIFY | HOLD_EXTEND
  status: string; // PENDING | APPROVED | REJECTED
  note: string | null;
  resolutionNote: string | null;
  createdAt: string; // ISO
  resolvedAt: string | null;
};

const KIND_ICON: Record<string, string> = {
  CANCEL: "event_busy",
  MODIFY: "edit_calendar",
  HOLD_EXTEND: "more_time",
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-teal-100 text-teal-700",
  REJECTED: "bg-rose-100 text-rose-700",
};

/** ISO → "dd/MM HH:mm" — VN 현지시각(UTC+7) */
function formatWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

export default function PartnerChangeRequestPanel({
  bookingId,
  bookingStatus,
  requests,
}: {
  bookingId: string;
  bookingStatus: string;
  requests: ChangeRequestItem[];
}) {
  const t = useTranslations("partner.changeRequest");
  const router = useRouter();

  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = requests.find((r) => r.status === "PENDING") ?? null;
  const history = requests.filter((r) => r.status !== "PENDING");

  // kind별 허용 상태 — 서버(allowedStatusesFor)와 동일 규칙(이중 게이트)
  const availableKinds: string[] = [];
  if (bookingStatus === "HOLD" || bookingStatus === "CONFIRMED") availableKinds.push("CANCEL");
  if (["HOLD", "CONFIRMED", "CHECKED_IN"].includes(bookingStatus)) availableKinds.push("MODIFY");
  if (bookingStatus === "HOLD") availableKinds.push("HOLD_EXTEND");

  const submit = async () => {
    if (!activeKind) return;
    // MODIFY는 희망 내용이 없으면 운영자가 처리할 수 없다 — 필수
    if (activeKind === "MODIFY" && note.trim() === "") {
      setError(t("noteRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner/bookings/${bookingId}/change-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: activeKind,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error === "DUPLICATE" ? t("duplicate") : t("error"));
        return;
      }
      setActiveKind(null);
      setNote("");
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  if (availableKinds.length === 0 && requests.length === 0) return null;

  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-base font-bold text-neutral-900">{t("title")}</h2>
      <p className="mb-4 text-sm text-neutral-500">{t("subtitle")}</p>

      {/* 진행중 요청 — 새 요청 불가(서버 PENDING 1건 제한과 동일 UX) */}
      {pending ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-amber-600">
              {KIND_ICON[pending.kind] ?? "pending"}
            </span>
            <p className="text-sm font-bold text-amber-800">
              {t(`kind.${pending.kind}`)} · {t("pendingBadge")}
            </p>
          </div>
          {pending.note && (
            <p className="mt-1.5 whitespace-pre-wrap text-xs text-amber-700">{pending.note}</p>
          )}
          <p className="mt-1.5 text-[11px] text-amber-600">
            {formatWhen(pending.createdAt)} · {t("pendingHint")}
          </p>
        </div>
      ) : availableKinds.length > 0 ? (
        <>
          {/* 요청 종류 버튼 */}
          <div className="flex flex-wrap gap-2">
            {availableKinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setActiveKind(activeKind === k ? null : k);
                  setError(null);
                }}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors active:scale-95 ${
                  activeKind === k
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                <span className="material-symbols-outlined text-base">{KIND_ICON[k]}</span>
                {t(`kind.${k}`)}
              </button>
            ))}
          </div>

          {/* 요청 폼 */}
          {activeKind && (
            <div className="mt-3 space-y-2 rounded-xl bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-500">
                {t(`hint.${activeKind}`)}
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={t("notePlaceholder")}
                className="w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm outline-none focus:border-teal-500"
              />
              {error && (
                <p role="alert" className="text-xs font-medium text-rose-600">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                >
                  {busy ? t("submitting") : t("submit")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveKind(null);
                    setError(null);
                  }}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-500"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* 처리 이력 */}
      {history.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
          {history.map((r) => (
            <li key={r.id} className="rounded-xl border border-neutral-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-800">{t(`kind.${r.kind}`)}</p>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    STATUS_STYLE[r.status] ?? "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {t(`requestStatus.${r.status}`)}
                </span>
              </div>
              {r.resolutionNote && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-600">
                  {r.resolutionNote}
                </p>
              )}
              <p className="mt-1 text-[11px] text-neutral-400">
                {formatWhen(r.createdAt)}
                {r.resolvedAt ? ` → ${formatWhen(r.resolvedAt)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
