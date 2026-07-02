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

/** 미리보기 응답 (serializeBigInt: VND는 문자열). 재무 필드는 STAFF에 없을 수 있어 옵셔널. */
interface PreviewData {
  ok: boolean;
  blockers: string[];
  capacityOk: boolean;
  availabilityOk: boolean;
  recalculated: boolean;
  nightsOld: number;
  nightsNew: number;
  existingSaleKrw?: number | null;
  existingSaleVnd?: string | null;
  newSaleKrw?: number | null;
  newSaleVnd?: string | null;
  additionalKrw?: number | null;
  additionalVnd?: string | null;
  overpayment?: boolean;
}

/** 금액 표시 — 부호 포함(추가청구 +, 감액 −). VND는 문자열/BigInt 안전. */
function fmtSigned(v: number | string, unit: string): string {
  const n = typeof v === "string" ? Number(v) : v;
  const sign = n > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("vi-VN").format(n)} ${unit}`;
}
function fmtAmount(v: number | string, unit: string): string {
  const n = typeof v === "string" ? Number(v) : v;
  return `${new Intl.NumberFormat("vi-VN").format(n)} ${unit}`;
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
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // 입력이 바뀌면 이전 미리보기는 무효 — 다시 계산하도록 비운다.
  const invalidatePreview = () => setPreview(null);

  // 변경 필드만 모아 본문 구성 (미리보기·저장 공용)
  const buildChangeBody = (): Record<string, unknown> => {
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
    return body;
  };

  const runPreview = async () => {
    setPreviewBusy(true);
    setPreview(null);
    setError(null);
    // 미리보기는 금액·정원·가용성에 영향 주는 필드만 보낸다 (이름·전화·조식 제외)
    const full = buildChangeBody();
    const body: Record<string, unknown> = {};
    for (const k of ["checkIn", "checkOut", "villaId", "guestCount"]) {
      if (k in full) body[k] = full[k];
    }
    if (Object.keys(body).length === 0) {
      setError(t("errors.noChanges"));
      setPreviewBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/bookings/${bookingId}/modify/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = data?.error as string | undefined;
        setError(code && messageForError(code) ? t(`errors.${code}`) : t("errors.generic"));
        return;
      }
      setPreview(data.preview as PreviewData);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPreviewBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setOk(null);

    // 변경된 필드만 보낸다. CHECKED_IN은 checkOut만 허용이라 서버 게이트로 한 번 더 방어.
    const body = buildChangeBody();
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
                onChange={(e) => {
                  setVillaId(e.target.value);
                  invalidatePreview();
                }}
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
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  invalidatePreview();
                }}
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
                onChange={(e) => {
                  setCheckOut(e.target.value);
                  invalidatePreview();
                }}
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
                onChange={(e) => {
                  setGuestCount(Math.max(1, Number(e.target.value) || 1));
                  invalidatePreview();
                }}
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

          {/* 변경 미리보기 (dry-run) — 저장 전 추가청구·정원·공실·과수납 확인 (ADR-0030 T-B) */}
          <div>
            <button
              type="button"
              disabled={previewBusy || busy}
              onClick={runPreview}
              className="w-full border border-admin-primary text-admin-primary hover:bg-admin-primary/10 font-bold py-2 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {previewBusy ? t("preview.loading") : t("preview.button")}
            </button>

            {preview && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs space-y-1.5">
                <p className="text-admin-muted font-semibold">{t("preview.title")}</p>

                {/* 차단 사유 */}
                {!preview.capacityOk && (
                  <p className="text-red-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">group_off</span>
                    {t("preview.overCapacity")}
                  </p>
                )}
                {!preview.availabilityOk && (
                  <p className="text-red-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">event_busy</span>
                    {t("preview.soldOut")}
                  </p>
                )}

                {/* 박수 변화 */}
                {preview.recalculated && (
                  <p className="text-white">
                    {t("preview.nights")}: {preview.nightsOld} → {preview.nightsNew}
                  </p>
                )}

                {/* 재무 (canViewFinance 일 때만 필드 존재) */}
                {preview.additionalVnd != null && Number(preview.additionalVnd) !== 0 && (
                  <p className={Number(preview.additionalVnd) > 0 ? "text-amber-300" : "text-green-400"}>
                    {t("preview.additional")}: {fmtSigned(preview.additionalVnd, "₫")}
                  </p>
                )}
                {preview.additionalKrw != null && preview.additionalKrw !== 0 && (
                  <p className={preview.additionalKrw > 0 ? "text-amber-300" : "text-green-400"}>
                    {t("preview.additional")}: {fmtSigned(preview.additionalKrw, "₩")}
                  </p>
                )}
                {preview.newSaleVnd != null && (
                  <p className="text-white">
                    {t("preview.newTotal")}: {fmtAmount(preview.newSaleVnd, "₫")}
                  </p>
                )}
                {preview.newSaleKrw != null && (
                  <p className="text-white">
                    {t("preview.newTotal")}: {fmtAmount(preview.newSaleKrw, "₩")}
                  </p>
                )}
                {preview.overpayment && (
                  <p className="text-amber-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    {t("preview.overpayment")}
                  </p>
                )}

                {/* 종합 판정 */}
                <p className={preview.ok ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                  {preview.ok ? t("preview.ok") : t("preview.blocked")}
                </p>
              </div>
            )}
          </div>

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
