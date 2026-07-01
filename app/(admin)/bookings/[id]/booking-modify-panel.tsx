"use client";

// 예약 변경 패널 (F-booking-modify) — 날짜·빌라·인원·투숙객·조식 편집 + 변경 사유.
// 허용 상태에서만 노출(HOLD/CONFIRMED=전체, CHECKED_IN=체크아웃일만). 종결 상태는 부모가 미렌더.
// 금액은 서버 재계산 — 본 컴포넌트는 입력만 보내고 결과 토스트만 표시(판매가는 서버 게이트).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BookingStatus } from "@prisma/client";

export interface VillaOption {
  id: string;
  name: string;
}

export default function BookingModifyPanel({
  bookingId,
  status,
  villaOptions,
  initial,
}: {
  bookingId: string;
  status: BookingStatus;
  /** 빌라 셀렉트 후보 (현재 빌라 포함) */
  villaOptions: VillaOption[];
  initial: {
    villaId: string;
    checkIn: string; // YYYY-MM-DD
    checkOut: string; // YYYY-MM-DD
    guestName: string;
    guestCount: number;
    guestPhone: string;
    breakfastIncluded: boolean;
  };
}) {
  const t = useTranslations("adminBookings.detail.modify");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // CHECKED_IN: 체크아웃일만 활성 — 나머지 잠금
  const checkoutOnly = status === "CHECKED_IN";

  const [villaId, setVillaId] = useState(initial.villaId);
  const [checkIn, setCheckIn] = useState(initial.checkIn);
  const [checkOut, setCheckOut] = useState(initial.checkOut);
  const [guestName, setGuestName] = useState(initial.guestName);
  const [guestCount, setGuestCount] = useState(initial.guestCount);
  const [guestPhone, setGuestPhone] = useState(initial.guestPhone);
  const [breakfast, setBreakfast] = useState(initial.breakfastIncluded);
  const [reason, setReason] = useState("");

  const submit = async () => {
    setBusy(true);
    setError(null);
    setOk(null);

    // 변경된 필드만 보낸다. CHECKED_IN은 checkOut만 허용이라 서버 게이트로 한 번 더 방어.
    const body: Record<string, unknown> = {};
    if (checkOut !== initial.checkOut) body.checkOut = checkOut;
    if (!checkoutOnly) {
      if (villaId !== initial.villaId) body.villaId = villaId;
      if (checkIn !== initial.checkIn) body.checkIn = checkIn;
      if (guestName.trim() !== initial.guestName) body.guestName = guestName.trim();
      if (guestCount !== initial.guestCount) body.guestCount = guestCount;
      if ((guestPhone.trim() || "") !== initial.guestPhone)
        body.guestPhone = guestPhone.trim() || null;
      if (breakfast !== initial.breakfastIncluded) body.breakfastIncluded = breakfast;
    }
    if (reason.trim()) body.reason = reason.trim();

    if (Object.keys(body).filter((k) => k !== "reason").length === 0) {
      setError(t("errors.noChanges"));
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${bookingId}/modify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = data?.error as string | undefined;
        setError(code && messageForError(code) ? t(`errors.${code}`) : t("errors.generic"));
        return;
      }
      setOk(t("success"));
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  // 서버 에러코드 중 i18n 키가 있는 것만 — 없으면 generic
  const ERROR_KEYS = new Set([
    "STATUS_NOT_MODIFIABLE",
    "CHECKED_IN_FIELD_LOCKED",
    "NO_CHANGES",
    "INVALID_RANGE",
    "INVALID_GUEST_COUNT",
    "SOLD_OUT",
    "OVER_CAPACITY",
    "RECEIVABLE_EXISTS",
    "CONCURRENT_MODIFICATION",
  ]);
  function messageForError(code: string): boolean {
    return ERROR_KEYS.has(code);
  }

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg text-sm p-2.5 text-white focus:ring-admin-primary disabled:opacity-40 disabled:cursor-not-allowed placeholder-[#475569]";
  const labelCls = "block text-xs text-admin-muted mb-1";

  return (
    <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-sm text-white">{t("title")}</h2>
        {!open && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setOk(null);
            }}
            className="text-xs font-bold text-admin-primary hover:underline"
          >
            {t("openButton")}
          </button>
        )}
      </div>

      {ok && !open && (
        <p className="px-6 py-3 text-xs text-green-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          {ok}
        </p>
      )}

      {open && (
        <div className="p-6 space-y-4">
          {checkoutOnly && (
            <p className="text-[11px] text-amber-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">info</span>
              {t("checkedInHint")}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* 빌라 */}
            <div className="col-span-2">
              <label className={labelCls}>{t("fields.villa")}</label>
              <select
                value={villaId}
                disabled={checkoutOnly}
                onChange={(e) => setVillaId(e.target.value)}
                className={inputCls}
              >
                {villaOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 체크인 */}
            <div>
              <label className={labelCls}>{t("fields.checkIn")}</label>
              <input
                type="date"
                value={checkIn}
                disabled={checkoutOnly}
                onChange={(e) => setCheckIn(e.target.value)}
                className={inputCls}
              />
            </div>
            {/* 체크아웃 — 항상 활성 */}
            <div>
              <label className={labelCls}>{t("fields.checkOut")}</label>
              <input
                type="date"
                value={checkOut}
                min={checkIn}
                onChange={(e) => setCheckOut(e.target.value)}
                className={inputCls}
              />
            </div>

            {/* 투숙객명 */}
            <div>
              <label className={labelCls}>{t("fields.guestName")}</label>
              <input
                type="text"
                value={guestName}
                disabled={checkoutOnly}
                onChange={(e) => setGuestName(e.target.value)}
                className={inputCls}
              />
            </div>
            {/* 인원 */}
            <div>
              <label className={labelCls}>{t("fields.guestCount")}</label>
              <input
                type="number"
                min={1}
                value={guestCount}
                disabled={checkoutOnly}
                onChange={(e) => setGuestCount(Math.max(1, Number(e.target.value) || 1))}
                className={inputCls}
              />
            </div>
            {/* 전화 */}
            <div>
              <label className={labelCls}>{t("fields.guestPhone")}</label>
              <input
                type="tel"
                value={guestPhone}
                disabled={checkoutOnly}
                onChange={(e) => setGuestPhone(e.target.value)}
                className={inputCls}
              />
            </div>
            {/* 조식 */}
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={breakfast}
                  disabled={checkoutOnly}
                  onChange={(e) => setBreakfast(e.target.checked)}
                  className="w-4 h-4 accent-admin-primary disabled:opacity-40"
                />
                {t("fields.breakfast")}
              </label>
            </div>
          </div>

          {/* 변경 사유 */}
          <div>
            <label className={labelCls}>{t("fields.reason")}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("fields.reasonPlaceholder")}
              className={`${inputCls} h-16`}
            />
          </div>

          <p className="text-[11px] text-[#475569]">{t("priceNote")}</p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex-1 bg-admin-primary hover:bg-blue-600 text-white font-bold py-2.5 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
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
