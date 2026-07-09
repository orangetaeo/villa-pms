"use client";

// 공급자 판매 링크 — 생성 폼 + 내 링크 목록 (ADR-0021 §7 T10.7, vi 모바일·teal)
//   - 생성: POST /api/supplier/proposals → /p/{token} 공개 링크 (가예약 셀프)
//   - 입금 확인: POST /api/supplier/bookings/[id]/confirm (HOLD → CONFIRMED)
// 누수 0: 화면 어디에도 운영자 판매가(KRW)·마진 없음. 금액은 공급자 자기 판매가(VND)뿐.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";
import { DateField } from "@/components/date-field";

export interface SupplierSellLinkItem {
  token: string;
  proposalId: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  status: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";
  clientName: string;
  totalVnd: string | null;
  booking: { id: string; status: string } | null;
}

const HOLD_CHOICES = [24, 48] as const;

export default function SellLinkClient({
  villaId,
  villaName,
  ratePeriodsHref,
  initialLinks,
}: {
  villaId: string;
  villaName: string;
  ratePeriodsHref: string;
  initialLinks: SupplierSellLinkItem[];
}) {
  const t = useTranslations("supplierSellLink");
  const router = useRouter();

  const [clientName, setClientName] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [holdHours, setHoldHours] = useState<number>(48);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceMissing, setPriceMissing] = useState(false);
  const [links, setLinks] = useState<SupplierSellLinkItem[]>(initialLinks);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const publicUrl = (token: string) =>
    typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : `/p/${token}`;

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(publicUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((c) => (c === token ? null : c)), 1500);
    } catch {
      // 클립보드 미지원 — 무시
    }
  }

  async function shareLink(token: string) {
    const url = publicUrl(token);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: villaName, url });
        return;
      } catch {
        // 취소·미지원 → 복사로 폴백
      }
    }
    copyLink(token);
  }

  async function handleCreate() {
    setError(null);
    setPriceMissing(false);
    if (!checkIn || !checkOut) {
      setError(t("dateRequired"));
      return;
    }
    if (checkOut <= checkIn) {
      setError(t("dateOrder"));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/supplier/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          villaId,
          clientName: clientName.trim() || t("defaultClientName"),
          checkIn,
          checkOut,
          expiresInHours: holdHours,
        }),
      });
      if (!res.ok) {
        let code = "";
        try {
          code = ((await res.json()) as { error?: string }).error ?? "";
        } catch {
          /* ignore */
        }
        if (res.status === 400 && code === "PRICE_NOT_SET") {
          setPriceMissing(true);
        } else if (res.status === 409) {
          setError(t("soldOut"));
        } else if (res.status === 404) {
          setError(t("notFound"));
        } else {
          setError(t("createError"));
        }
        setCreating(false);
        return;
      }
      // 성공 → 목록 새로고침 (서버에서 최신 링크 재조회)
      setClientName("");
      setCheckIn("");
      setCheckOut("");
      router.refresh();
      // 즉시 피드백을 위해 새 링크를 낙관적으로 목록 상단에 추가
      const created = (await res.json()) as { token: string; proposalId: string };
      setLinks((prev) => [
        {
          token: created.token,
          proposalId: created.proposalId,
          checkIn,
          checkOut,
          status: "ACTIVE",
          clientName: clientName.trim() || t("defaultClientName"),
          totalVnd: null,
          booking: null,
        },
        ...prev,
      ]);
      setCopiedToken(created.token);
      copyLink(created.token);
    } catch {
      setError(t("createError"));
      setCreating(false);
      return;
    }
    setCreating(false);
  }

  async function handleConfirm(bookingId: string) {
    setConfirmingId(bookingId);
    try {
      const res = await fetch(`/api/supplier/bookings/${bookingId}/confirm`, {
        method: "POST",
      });
      if (res.ok) {
        setLinks((prev) =>
          prev.map((l) =>
            l.booking?.id === bookingId
              ? { ...l, booking: { ...l.booking, status: "CONFIRMED" } }
              : l
          )
        );
        router.refresh();
      }
    } catch {
      /* ignore — 사용자가 다시 시도 */
    }
    setConfirmingId(null);
  }

  const fmtDate = (s: string) => s.split("-").reverse().join("/");

  return (
    <div className="space-y-6 px-4 pb-28 pt-5">
      {/* 생성 폼 */}
      <section className="rounded-2xl border-2 border-teal-100 bg-teal-50/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-teal-600">add_link</span>
          <span className="font-bold text-neutral-800">{t("createTitle")}</span>
        </div>
        <p className="mb-4 text-xs text-neutral-500">{t("createHint")}</p>

        {/* 날짜 */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-500">
              {t("checkIn")}
            </label>
            <DateField
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              aria-label={t("checkIn")}
              placeholder={t("datePlaceholder")}
              placeholderClassName="text-neutral-400"
              className="w-full rounded-xl border-2 border-neutral-100 bg-white px-3 py-3 text-sm font-semibold text-neutral-700 tabular-nums outline-none focus:border-teal-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-500">
              {t("checkOut")}
            </label>
            <DateField
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              aria-label={t("checkOut")}
              placeholder={t("datePlaceholder")}
              placeholderClassName="text-neutral-400"
              className="w-full rounded-xl border-2 border-neutral-100 bg-white px-3 py-3 text-sm font-semibold text-neutral-700 tabular-nums outline-none focus:border-teal-400"
            />
          </div>
        </div>

        {/* 고객명 (선택) */}
        <div className="mb-3">
          <label className="mb-1 block text-xs font-semibold text-neutral-500">
            {t("clientName")}
          </label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder={t("clientNamePlaceholder")}
            maxLength={60}
            aria-label={t("clientName")}
            className="w-full rounded-xl border-2 border-neutral-100 bg-white px-3 py-3 text-sm font-semibold text-neutral-700 outline-none focus:border-teal-400"
          />
        </div>

        {/* 유효기간 칩 */}
        <div className="mb-1">
          <label className="mb-1 block text-xs font-semibold text-neutral-500">
            {t("holdLabel")}
          </label>
          <div className="flex gap-2">
            {HOLD_CHOICES.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHoldHours(h)}
                className={`flex-1 rounded-xl py-3 text-sm font-bold transition-colors ${
                  holdHours === h
                    ? "bg-teal-600 text-white"
                    : "border-2 border-neutral-100 bg-white text-neutral-500"
                }`}
              >
                {t("holdHours", { h })}
              </button>
            ))}
          </div>
        </div>

        {/* 판매가 미설정 안내 */}
        {priceMissing && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">{t("priceNotSet")}</p>
            <Link
              href={ratePeriodsHref}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 py-2.5 text-sm font-bold text-white active:scale-95"
            >
              <span className="material-symbols-outlined text-base">payments</span>
              {t("goSetPrice")}
            </Link>
          </div>
        )}

        {error && (
          <p
            className="mt-3 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          <span className="material-symbols-outlined">link</span>
          <span className="font-bold">{creating ? t("creating") : t("createButton")}</span>
        </button>
      </section>

      {/* 내 판매 링크 목록 */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
          {t("listTitle")}
        </h2>
        {links.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-8 text-center shadow-sm">
            <span className="material-symbols-outlined text-4xl text-teal-600">share</span>
            <p className="text-sm font-medium text-neutral-500">{t("empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {links.map((l) => (
              <LinkCard
                key={l.proposalId}
                link={l}
                t={t}
                fmtDate={fmtDate}
                publicUrl={publicUrl}
                copied={copiedToken === l.token}
                onCopy={() => copyLink(l.token)}
                onShare={() => shareLink(l.token)}
                onConfirm={() => l.booking && handleConfirm(l.booking.id)}
                confirming={confirmingId === l.booking?.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LinkCard({
  link,
  t,
  fmtDate,
  publicUrl,
  copied,
  onCopy,
  onShare,
  onConfirm,
  confirming,
}: {
  link: SupplierSellLinkItem;
  t: (key: string, values?: Record<string, string | number>) => string;
  fmtDate: (s: string) => string;
  publicUrl: (token: string) => string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const booking = link.booking;
  const isHold = booking?.status === "HOLD";
  const isConfirmed = booking?.status === "CONFIRMED";

  // 상태 배지 — 가예약(HOLD)·확정(CONFIRMED)이 제안 상태보다 우선 표시
  const badge = isConfirmed
    ? { label: t("badge.confirmed"), cls: "border-emerald-100 bg-emerald-50 text-emerald-700" }
    : isHold
      ? { label: t("badge.hold"), cls: "border-amber-100 bg-amber-50 text-amber-700" }
      : link.status === "ACTIVE"
        ? { label: t("badge.active"), cls: "border-teal-100 bg-teal-50 text-teal-700" }
        : link.status === "EXPIRED"
          ? { label: t("badge.expired"), cls: "border-neutral-200 bg-neutral-50 text-neutral-400" }
          : link.status === "REVOKED"
            ? { label: t("badge.revoked"), cls: "border-neutral-200 bg-neutral-50 text-neutral-400" }
            : { label: t("badge.used"), cls: "border-blue-100 bg-blue-50 text-[#2563EB]" };

  return (
    <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-neutral-800">{link.clientName}</p>
          <p className="mt-0.5 text-xs font-medium tabular-nums text-neutral-400">
            {fmtDate(link.checkIn)} → {fmtDate(link.checkOut)}
          </p>
        </div>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>

      {/* 공급자 자기 판매가 (VND) — 운영자 KRW·마진 절대 없음 */}
      {link.totalVnd && (
        <p className="mb-3 text-sm font-bold tabular-nums text-teal-700">
          {formatVnd(link.totalVnd)}₫
        </p>
      )}

      {/* 링크 표시 */}
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
        <span className="material-symbols-outlined text-[18px] text-neutral-400">link</span>
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" dir="ltr">
          {publicUrl(link.token)}
        </span>
      </div>

      {/* 액션 — 복사 / 공유 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-teal-200 bg-white text-sm font-bold text-teal-700 active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">
            {copied ? "check" : "content_copy"}
          </span>
          {copied ? t("copied") : t("copy")}
        </button>
        <button
          type="button"
          onClick={onShare}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 text-sm font-bold text-white active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">share</span>
          {t("share")}
        </button>
      </div>

      {/* 입금 확인 (HOLD일 때만) */}
      {isHold && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white active:scale-95 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">paid</span>
          {confirming ? t("confirming") : t("confirmDeposit")}
        </button>
      )}
    </div>
  );
}
