"use client";

// 분할 숙박 패널 (ADR-0030 T-E) — 연장인데 원 빌라가 불가할 때 "다른 빌라로 연장"(연결 추가 예약).
// CONFIRMED·CHECKED_IN 예약에서만 노출. 기존 연결 예약 목록 + 새 연장 폼.
// 판매가 표시는 서버에서 canViewFinance 게이트로 이미 걸러 전달(saleLabel null이면 미표시).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { VillaOption } from "./booking-modify-panel";

export interface ExtensionItem {
  id: string;
  villaName: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  nights: number;
  status: string;
  /** 판매가 표시 문자열 (canViewFinance 일 때만 서버가 채움) */
  saleLabel: string | null;
}

const REASON_KEYS = new Set([
  "PARENT_NOT_EXTENDABLE",
  "INVALID_RANGE",
  "SAME_VILLA",
  "SOLD_OUT",
  "OVER_CAPACITY",
]);

export default function BookingExtendPanel({
  parentBookingId,
  currentVillaId,
  defaultCheckIn,
  villaOptions,
  extensions,
}: {
  parentBookingId: string;
  currentVillaId: string;
  /** 연장 시작 기본값 = 부모 체크아웃일 */
  defaultCheckIn: string;
  villaOptions: VillaOption[];
  extensions: ExtensionItem[];
}) {
  const t = useTranslations("adminBookings.detail.extend");
  const router = useRouter();
  const others = villaOptions.filter((v) => v.id !== currentVillaId);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [villaId, setVillaId] = useState(others[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckIn);

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (!villaId) {
      setError(t("errors.noVilla"));
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/bookings/${parentBookingId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ villaId, checkIn, checkOut }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = data?.error as string | undefined;
        setError(code && REASON_KEYS.has(code) ? t(`errors.${code}`) : t("errors.generic"));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg text-sm p-2.5 text-white focus:ring-admin-primary";
  const labelCls = "block text-xs text-admin-muted mb-1";

  return (
    <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-sm text-white">{t("title")}</h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs font-bold text-admin-primary hover:underline"
          >
            {t("openButton")}
          </button>
        )}
      </div>

      {/* 기존 연결 예약 목록 */}
      {extensions.length > 0 && (
        <ul className="px-6 py-3 space-y-2 border-b border-slate-700">
          {extensions.map((e) => (
            <li key={e.id} className="text-xs flex items-center justify-between gap-2">
              <span className="text-white">
                {e.villaName}{" "}
                <span className="text-admin-muted">
                  {e.checkIn} → {e.checkOut} ({t("nights", { n: e.nights })})
                </span>
              </span>
              <span className="flex items-center gap-2">
                {e.saleLabel && <span className="text-admin-muted">{e.saleLabel}</span>}
                <a href={`/bookings/${e.id}`} className="text-admin-primary hover:underline">
                  {t("view")}
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="p-6 space-y-4">
          <p className="text-[11px] text-admin-muted">{t("hint")}</p>
          <div>
            <label className={labelCls}>{t("villa")}</label>
            <select value={villaId} onChange={(e) => setVillaId(e.target.value)} className={inputCls}>
              {others.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t("checkIn")}</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("checkOut")}</label>
              <input
                type="date"
                value={checkOut}
                min={checkIn}
                onChange={(e) => setCheckOut(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex-1 bg-admin-primary hover:bg-blue-600 text-white font-bold py-2.5 rounded-lg disabled:opacity-50"
            >
              {busy ? t("submitting") : t("submit")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="flex-1 bg-[#334155] text-admin-muted font-bold py-2.5 rounded-lg"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
