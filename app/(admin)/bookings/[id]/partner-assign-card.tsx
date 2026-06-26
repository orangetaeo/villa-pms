"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/lib/format";

interface PartnerOption {
  id: string;
  name: string;
  type: "TRAVEL_AGENCY" | "LAND_AGENCY";
}

export interface PartnerReceivableSummary {
  status: string;
  totalVnd: string;
  outstandingVnd: string;
}

/**
 * 예약 상세 — 파트너 지정 카드 (ADR-0022 PARTNER-2c).
 * 여행사/랜드사 채널 + canViewFinance 에서만 렌더(부모가 게이트). 채권 생성 후엔 변경 잠금.
 * VND 객실료만 채권이 생성되므로 KRW 예약엔 안내만.
 */
export default function PartnerAssignCard({
  bookingId,
  channel,
  saleCurrency,
  current,
  receivable,
}: {
  bookingId: string;
  channel: "TRAVEL_AGENCY" | "LAND_AGENCY";
  saleCurrency: "KRW" | "VND" | "USD";
  current: { id: string; name: string } | null;
  receivable: PartnerReceivableSummary | null;
}) {
  const t = useTranslations("adminPartners");
  const router = useRouter();
  const [options, setOptions] = useState<PartnerOption[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = receivable !== null; // 채권 생성 후 변경 금지(API 409)
  const vndOnly = saleCurrency !== "VND";

  useEffect(() => {
    if (current || locked) return;
    let alive = true;
    fetch("/api/partners")
      .then((r) => (r.ok ? r.json() : { partners: [] }))
      .then((d: { partners?: Array<{ partner: PartnerOption }> }) => {
        if (!alive) return;
        // 채널과 같은 유형의 파트너만 후보로
        setOptions(
          (d.partners ?? [])
            .map((p) => p.partner)
            .filter((p) => p.type === channel)
        );
      })
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [current, locked, channel]);

  const assign = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/partner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: selected }),
      });
      if (!res.ok) {
        setError(t("assign.failed"));
        setBusy(false);
        return;
      }
      setBusy(false);
      router.refresh();
    } catch {
      setError(t("assign.failed"));
      setBusy(false);
    }
  };

  return (
    <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-admin-primary">handshake</span>
        <h2 className="font-bold text-sm text-white">{t("assign.title")}</h2>
      </div>
      <div className="p-6 flex flex-col gap-4">
        {current ? (
          <>
            <Link
              href={`/partners/${current.id}`}
              className="font-bold text-white hover:text-admin-primary"
            >
              {current.name} →
            </Link>
            {receivable && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-admin-muted">{t("assign.receivable")}</span>
                <span className="text-slate-200">
                  {t(`receivableStatus.${receivable.status}`)} ·{" "}
                  <span className="tabular-nums">{formatVnd(receivable.outstandingVnd)}</span>
                </span>
              </div>
            )}
            {locked && <p className="text-[11px] text-[#475569]">{t("assign.locked")}</p>}
          </>
        ) : vndOnly ? (
          <p className="text-sm text-amber-400">{t("assign.vndOnly")}</p>
        ) : (
          <>
            <p className="text-sm text-admin-muted">{t("assign.none")}</p>
            <select
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={busy || options === null}
            >
              <option value="">{options === null ? "…" : t("assign.select")}</option>
              {(options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={assign}
              disabled={busy || !selected}
              className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? t("saving") : t("assign.assign")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
