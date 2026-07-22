"use client";

// 계약 조항 협의(네고) 패널 — 상대방(공급자·벤더·파트너) 포털용 (T-contract-negotiation S2)
//
// ★ 베트남 사용자 UX 원칙: 텍스트 입력 최소화.
//    조항 선택 → 사유 칩 1개 탭 → (취소표면) 숫자만 조정 → 보내기. 메모는 선택(기타 사유만 필수).
// ★ 취소 단계표 역제안은 **공급자 지급 %만** 입력받고 고객 환불 % = 100 − 지급 %로 자동 도출한다.
//    서버 상한(지급률 ≤ 100 − 환불률)에 항상 딱 맞으므로, 상대방이 우리 고객 정책을 이해할 필요가 없다.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  NEGOTIABLE_CLAUSES,
  REASON_PRESETS,
} from "@/lib/contract-negotiation";
import { cancelTierPeriodLabel, type CancelTier } from "@/lib/cancel-tiers";

export interface NegotiationItem {
  id: string;
  clauseKey: string;
  reason: string;
  status: string;
  note: string | null;
  resolvedNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

type ContractType = "VILLA_SUPPLY" | "SERVICE_VENDOR" | "PARTNER_AGENCY";

export default function NegotiationPanel({
  contractId,
  type,
  locale,
  currentTiers,
  negotiations,
  onChanged,
}: {
  contractId: string;
  type: ContractType;
  locale: string;
  currentTiers: CancelTier[] | null;
  negotiations: NegotiationItem[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("businessContract");
  const [open, setOpen] = useState(false);
  const hasOpen = negotiations.some((n) => n.status === "OPEN");

  return (
    <section className="space-y-3 rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-neutral-900">{t("negotiation.title")}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t("negotiation.desc")}</p>
        </div>
        {!hasOpen && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-xl border border-teal-200 px-3 py-2 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-50"
          >
            {open ? t("negotiation.close") : t("negotiation.open")}
          </button>
        )}
      </div>

      {negotiations.length > 0 && (
        <ul className="space-y-2">
          {negotiations.map((n) => (
            <NegotiationRow key={n.id} item={n} />
          ))}
        </ul>
      )}

      {open && !hasOpen && (
        <NegotiationForm
          contractId={contractId}
          type={type}
          locale={locale}
          currentTiers={currentTiers}
          onDone={async () => {
            setOpen(false);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

function NegotiationRow({ item }: { item: NegotiationItem }) {
  const t = useTranslations("businessContract");
  const tone =
    item.status === "OPEN"
      ? "border-amber-100 bg-amber-50 text-amber-800"
      : item.status === "ACCEPTED"
        ? "border-emerald-100 bg-emerald-50 text-emerald-800"
        : "border-neutral-200 bg-neutral-50 text-neutral-700";
  return (
    <li className={`rounded-xl border px-3 py-2.5 text-sm ${tone}`}>
      <p className="font-bold">
        {t(`negotiation.clause.${item.clauseKey}`)} · {t(`negotiation.status.${item.status}`)}
      </p>
      <p className="mt-0.5 text-xs opacity-90">{t(`negotiation.reason.${item.reason}`)}</p>
      {item.note && <p className="mt-1 text-xs opacity-80">{item.note}</p>}
      {item.resolvedNote && (
        <p className="mt-1 border-t border-current/10 pt-1 text-xs font-medium">
          {t("negotiation.reply")}: {item.resolvedNote}
        </p>
      )}
    </li>
  );
}

function NegotiationForm({
  contractId,
  type,
  locale,
  currentTiers,
  onDone,
}: {
  contractId: string;
  type: ContractType;
  locale: string;
  currentTiers: CancelTier[] | null;
  onDone: () => void | Promise<void>;
}) {
  const t = useTranslations("businessContract");
  const clauses = NEGOTIABLE_CLAUSES[type] as readonly string[];
  const [clauseKey, setClauseKey] = useState<string>(clauses[0]);
  const [reason, setReason] = useState<string>(REASON_PRESETS[clauses[0]]?.[0] ?? "OTHER");
  const [note, setNote] = useState("");
  const [pays, setPays] = useState<number[]>(() => (currentTiers ?? []).map((x) => x.supplierPayPct));
  const [days, setDays] = useState<number[]>(() => (currentTiers ?? []).map((x) => x.fromDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasons = REASON_PRESETS[clauseKey] ?? ["OTHER"];
  const showTiers = clauseKey === "cancelTiers" && currentTiers !== null && currentTiers.length > 0;

  // 지급 % → 환불 % 자동 도출(항상 서버 상한에 정확히 맞음). 라벨 계산용 임시 표.
  const proposed = useMemo<CancelTier[]>(
    () =>
      (currentTiers ?? []).map((row, i) => ({
        fromDays: days[i] ?? row.fromDays,
        supplierPayPct: pays[i] ?? row.supplierPayPct,
        guestRefundPct: 100 - (pays[i] ?? row.supplierPayPct),
      })),
    [currentTiers, days, pays],
  );

  const changed = useMemo(
    () =>
      (currentTiers ?? []).some(
        (row, i) => row.supplierPayPct !== proposed[i]?.supplierPayPct || row.fromDays !== proposed[i]?.fromDays,
      ),
    [currentTiers, proposed],
  );

  const onClauseChange = (key: string) => {
    setClauseKey(key);
    setReason(REASON_PRESETS[key]?.[0] ?? "OTHER");
  };

  const submit = async () => {
    setError(null);
    if (reason === "OTHER" && !note.trim()) {
      setError(t("negotiation.noteRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/business-contracts/${contractId}/negotiations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clauseKey,
          reason,
          ...(showTiers && changed ? { proposedTiers: proposed } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (res.status === 409) {
        setError(t("negotiation.alreadyOpen"));
        return;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      await onDone();
    } catch {
      setError(t("negotiation.error"));
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors " +
    (active
      ? "border-teal-500 bg-teal-50 text-teal-700"
      : "border-neutral-200 bg-white text-neutral-600");

  return (
    <div className="space-y-4 rounded-xl border border-neutral-100 bg-neutral-50/60 p-4">
      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700">{t("negotiation.pickClause")}</p>
        <div className="flex flex-wrap gap-2">
          {clauses.map((c) => (
            <button key={c} type="button" onClick={() => onClauseChange(c)} className={chip(c === clauseKey)}>
              {t(`negotiation.clause.${c}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700">{t("negotiation.pickReason")}</p>
        <div className="flex flex-wrap gap-2">
          {reasons.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={chip(r === reason)}>
              {t(`negotiation.reason.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {showTiers && (
        <div>
          <p className="mb-1 text-sm font-medium text-neutral-700">{t("negotiation.tierTitle")}</p>
          <p className="mb-2 text-xs text-neutral-500">{t("negotiation.tierHint")}</p>
          <ul className="space-y-2">
            {(currentTiers ?? []).map((row, i) => {
              const isNoshow = row.fromDays === -1;
              return (
                <li key={i} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
                  <span className="flex-1 text-sm text-neutral-700">
                    {cancelTierPeriodLabel(proposed, i, locale === "ko" ? "ko" : "vi")}
                  </span>
                  {!isNoshow && (
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label={t("negotiation.tierDays")}
                      value={days[i] ?? row.fromDays}
                      onChange={(e) =>
                        setDays((prev) => prev.map((v, k) => (k === i ? Number(e.target.value) : v)))
                      }
                      className="h-10 w-16 rounded-lg border border-neutral-200 px-2 text-right text-sm"
                    />
                  )}
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={t("negotiation.tierPay")}
                    value={pays[i] ?? row.supplierPayPct}
                    onChange={(e) =>
                      setPays((prev) => prev.map((v, k) => (k === i ? Number(e.target.value) : v)))
                    }
                    className="h-10 w-16 rounded-lg border border-neutral-200 px-2 text-right text-sm"
                  />
                  <span className="text-sm text-neutral-500">%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">
          {reason === "OTHER" ? t("negotiation.noteRequiredLabel") : t("negotiation.note")}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-teal-500 focus:outline-none"
        />
      </label>

      {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-bold text-white transition-all hover:bg-teal-500 active:scale-[0.99] disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-[20px]">handshake</span>
        {busy ? t("negotiation.submitting") : t("negotiation.submit")}
      </button>
    </div>
  );
}
