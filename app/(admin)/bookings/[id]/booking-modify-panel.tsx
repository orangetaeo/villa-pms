"use client";

// 예약 변경 패널 (F-booking-modify, ADR-0030 UX 개편) — 날짜·빌라·인원·투숙객·조식 편집.
// 기준(ADR-0030): 날짜·인원 먼저 → 가용 빌라만 셀렉터 표시 → 날짜·빌라·인원 변경 시 자동 미리보기
//   → 저장 시 확인 팝업. CHECKED_IN=체크아웃일만. 금액은 서버 재계산(판매가는 서버 게이트).
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BookingStatus } from "@prisma/client";
import { DateField } from "@/components/date-field";

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
  villaName,
  partnerZaloLinked = false,
  initial,
}: {
  bookingId: string;
  status: BookingStatus;
  /** 빌라 셀렉트 후보 (현재 빌라 포함) — 초기/폴백용. 날짜·인원 지정 시 가용 목록으로 대체 */
  villaOptions: VillaOption[];
  /** 현재 빌라명 — 비용안내 복사 텍스트용 */
  villaName: string;
  /** 이 예약에 Zalo 연결된 여행사(파트너)가 있는지 — Zalo 전송 버튼 노출 게이트 */
  partnerZaloLinked?: boolean;
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
  const te = useTranslations("adminBookings.detail.extend");
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
  const [availableVillas, setAvailableVillas] = useState<VillaOption[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 분할 숙박(다른 빌라로 이어서) 서브플로우
  const [splitVillas, setSplitVillas] = useState<VillaOption[] | null>(null);
  const [splitVillaId, setSplitVillaId] = useState("");
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  // 비용안내 — 복사(소비자·카톡용)·Zalo 전송(여행사용) 피드백
  const [copied, setCopied] = useState(false);
  const [zaloBusy, setZaloBusy] = useState(false);
  const [zaloMsg, setZaloMsg] = useState<string | null>(null);

  const rangeValid = checkIn < checkOut;

  // 같은 빌라 체크아웃 연장(원 빌라·체크인 유지, 체크아웃만 뒤로)인데 그 빌라가 그 기간 불가할 때,
  // 추가 밤을 다른 빌라로 이어서 예약(분할 숙박, ADR-0030 D1)하도록 유도한다.
  const isCheckoutExtension =
    checkOut > initial.checkOut && villaId === initial.villaId && checkIn === initial.checkIn;
  const showSplit = isCheckoutExtension && preview != null && !preview.availabilityOk;

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

  // ── 자동 미리보기 (디바운스) — 날짜·빌라·인원이 초기값과 다르면 자동 계산 ──
  useEffect(() => {
    if (!open) return;
    const changed =
      checkOut !== initial.checkOut ||
      (!checkoutOnly &&
        (villaId !== initial.villaId ||
          checkIn !== initial.checkIn ||
          guestCount !== initial.guestCount));
    if (!changed || !rangeValid) {
      setPreview(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const body: Record<string, unknown> = {};
      if (checkOut !== initial.checkOut) body.checkOut = checkOut;
      if (!checkoutOnly) {
        if (villaId !== initial.villaId) body.villaId = villaId;
        if (checkIn !== initial.checkIn) body.checkIn = checkIn;
        if (guestCount !== initial.guestCount) body.guestCount = guestCount;
      }
      setPreviewBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/bookings/${bookingId}/modify/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setPreview(null);
          const code = data?.error as string | undefined;
          setError(code && ERROR_KEYS.has(code) ? t(`errors.${code}`) : t("errors.generic"));
          return;
        }
        setPreview(data.preview as PreviewData);
      } catch {
        if (!ctrl.signal.aborted) setError(t("errors.generic"));
      } finally {
        if (!ctrl.signal.aborted) setPreviewBusy(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, villaId, checkIn, checkOut, guestCount, checkoutOnly, rangeValid, bookingId, initial, t]);

  // ── 가용 빌라 셀렉터 — 날짜·인원 변경 시 그 조건에 판매 가능한 빌라만 (CHECKED_IN은 빌라 잠금) ──
  useEffect(() => {
    if (!open || checkoutOnly || !rangeValid) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/modify/available-villas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkIn, checkOut, guestCount }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (Array.isArray(data?.villas)) setAvailableVillas(data.villas as VillaOption[]);
      } catch {
        /* 조회 실패 시 기존 목록 유지 */
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, checkoutOnly, checkIn, checkOut, guestCount, rangeValid, bookingId]);

  // ── 분할 숙박: 연장 구간(원 체크아웃 ~ 새 체크아웃)에 가용한 "다른" 빌라 조회 ──
  useEffect(() => {
    if (!showSplit || !rangeValid) {
      setSplitVillas(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/modify/available-villas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checkIn: initial.checkOut, // 연장 구간 시작 = 원 체크아웃
            checkOut,
            guestCount,
            purpose: "extend",
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (Array.isArray(data?.villas)) {
          const list = data.villas as VillaOption[];
          setSplitVillas(list);
          setSplitVillaId((prev) => prev || list[0]?.id || "");
        }
      } catch {
        /* 무시 — 유지 */
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [showSplit, checkOut, guestCount, rangeValid, bookingId, initial.checkOut]);

  const EXT_ERROR_KEYS = new Set([
    "PARENT_NOT_EXTENDABLE",
    "INVALID_RANGE",
    "SAME_VILLA",
    "SOLD_OUT",
    "OVER_CAPACITY",
  ]);

  // 다른 빌라로 이어서 예약(연결 예약) 생성
  const createExtension = async () => {
    if (!splitVillaId) return;
    setSplitBusy(true);
    setSplitError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ villaId: splitVillaId, checkIn: initial.checkOut, checkOut }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = data?.error as string | undefined;
        setSplitError(
          code && EXT_ERROR_KEYS.has(code) ? te(`errors.${code}`) : te("errors.generic")
        );
        return;
      }
      setOk(t("split.created"));
      setOpen(false);
      router.refresh();
    } catch {
      setSplitError(te("errors.generic"));
    } finally {
      setSplitBusy(false);
    }
  };

  // 셀렉터 표시 목록 — 가용 목록 우선(없으면 서버 폴백), 선택 중인 빌라는 항상 유지
  const villaChoices = useMemo(() => {
    const base = availableVillas ?? villaOptions;
    if (base.some((v) => v.id === villaId)) return base;
    const sel = villaOptions.find((v) => v.id === villaId);
    return sel ? [sel, ...base] : base;
  }, [availableVillas, villaOptions, villaId]);

  // "변경 저장" → 변경 유무 확인 후 확인 팝업 열기
  const openConfirm = () => {
    setError(null);
    const body = buildChangeBody();
    if (Object.keys(body).length === 0) {
      setError(t("errors.noChanges"));
      return;
    }
    setConfirmOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    const body = buildChangeBody();
    if (reason.trim()) body.reason = reason.trim();
    if (Object.keys(body).filter((k) => k !== "reason").length === 0) {
      setError(t("errors.noChanges"));
      setBusy(false);
      setConfirmOpen(false);
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
        setError(code && ERROR_KEYS.has(code) ? t(`errors.${code}`) : t("errors.generic"));
        setConfirmOpen(false);
        return;
      }
      setOk(t("success"));
      setConfirmOpen(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("errors.generic"));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg text-sm p-2.5 text-white focus:ring-admin-primary disabled:opacity-40 disabled:cursor-not-allowed placeholder-[#475569]";
  const labelCls = "block text-xs text-admin-muted mb-1";

  // 미리보기 요약 카드(인라인·모달 공용)
  const previewSummary = (p: PreviewData) => (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs space-y-1.5">
      {!p.capacityOk && (
        <p className="text-red-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">group_off</span>
          {t("preview.overCapacity")}
        </p>
      )}
      {!p.availabilityOk && (
        <p className="text-red-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">event_busy</span>
          {t("preview.soldOut")}
        </p>
      )}
      {p.recalculated && (
        <p className="text-white">
          {t("preview.nights")}: {p.nightsOld} → {p.nightsNew}
        </p>
      )}
      {p.additionalVnd != null && Number(p.additionalVnd) !== 0 && (
        <p className={Number(p.additionalVnd) > 0 ? "text-amber-300" : "text-green-400"}>
          {t("preview.additional")}: {fmtSigned(p.additionalVnd, "₫")}
        </p>
      )}
      {p.additionalKrw != null && p.additionalKrw !== 0 && (
        <p className={p.additionalKrw > 0 ? "text-amber-300" : "text-green-400"}>
          {t("preview.additional")}: {fmtSigned(p.additionalKrw, "₩")}
        </p>
      )}
      {p.newSaleVnd != null && (
        <p className="text-white">
          {t("preview.newTotal")}: {fmtAmount(p.newSaleVnd, "₫")}
        </p>
      )}
      {p.newSaleKrw != null && (
        <p className="text-white">
          {t("preview.newTotal")}: {fmtAmount(p.newSaleKrw, "₩")}
        </p>
      )}
      {p.overpayment && (
        <p className="text-amber-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">warning</span>
          {t("preview.overpayment")}
        </p>
      )}
      <p className={p.ok ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
        {p.ok ? t("preview.ok") : t("preview.blocked")}
      </p>
    </div>
  );

  // 소비자 안내 텍스트(카톡 복사용, 한국어) — 현재 미리보기·날짜 기준. 금액은 KRW 우선, 없으면 VND.
  const buildConsumerNotice = (p: PreviewData): string => {
    const lines: string[] = [
      t("notice.title"),
      `${t("fields.villa")}: ${villaName}`,
      `${initial.checkIn} ~ ${initial.checkOut} → ${checkIn} ~ ${checkOut}`,
      `${t("preview.nights")}: ${p.nightsOld} → ${p.nightsNew}`,
    ];
    if (p.additionalKrw != null && p.additionalKrw !== 0)
      lines.push(`${t("preview.additional")}: ${fmtSigned(p.additionalKrw, "₩")}`);
    else if (p.additionalVnd != null && Number(p.additionalVnd) !== 0)
      lines.push(`${t("preview.additional")}: ${fmtSigned(p.additionalVnd, "₫")}`);
    if (p.newSaleKrw != null)
      lines.push(`${t("preview.newTotal")}: ${fmtAmount(p.newSaleKrw, "₩")}`);
    else if (p.newSaleVnd != null)
      lines.push(`${t("preview.newTotal")}: ${fmtAmount(p.newSaleVnd, "₫")}`);
    return lines.join("\n");
  };

  const handleCopy = async (p: PreviewData) => {
    try {
      await navigator.clipboard.writeText(buildConsumerNotice(p));
      setCopied(true);
      setZaloMsg(null);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setZaloMsg(t("notice.copyFailed"));
    }
  };

  // 여행사(파트너) Zalo 전송 — 금액은 서버가 재계산(클라 값 미신뢰). 현재 변경안 기준.
  const handleSendZalo = async () => {
    setZaloBusy(true);
    setZaloMsg(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/modify/notice-zalo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChangeBody()),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setZaloMsg(t("notice.zaloSent"));
      else if (data.error === "NO_ZALO_LINK" || data.error === "NO_PARTNER")
        setZaloMsg(t("notice.noZaloLink"));
      else setZaloMsg(t("notice.zaloFailed"));
    } catch {
      setZaloMsg(t("notice.zaloFailed"));
    } finally {
      setZaloBusy(false);
    }
  };

  // 비용안내 버튼 행(복사·Zalo) — 미리보기에 금액 변동이 있을 때만
  const noticeActions = (p: PreviewData) =>
    p.recalculated ? (
      <div className="mt-2 space-y-1.5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleCopy(p)}
            className="flex-1 flex items-center justify-center gap-1 bg-[#334155] hover:bg-slate-600 text-white text-xs font-semibold py-2 rounded-lg transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-sm">content_copy</span>
            {copied ? t("notice.copied") : t("notice.copy")}
          </button>
          {partnerZaloLinked && (
            <button
              type="button"
              disabled={zaloBusy}
              onClick={handleSendZalo}
              className="flex-1 flex items-center justify-center gap-1 bg-[#0068FF] hover:bg-blue-600 text-white text-xs font-semibold py-2 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">send</span>
              {zaloBusy ? t("notice.sending") : t("notice.sendZalo")}
            </button>
          )}
        </div>
        {zaloMsg && <p className="text-xs text-admin-muted">{zaloMsg}</p>}
      </div>
    ) : null;

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
            {/* 빌라 — 날짜·인원에 가용한 빌라만 (현재 빌라 항상 포함) */}
            <div className="col-span-2">
              <label className={labelCls}>{t("fields.villa")}</label>
              <select
                value={villaId}
                disabled={checkoutOnly}
                aria-label={t("fields.villa")}
                onChange={(e) => setVillaId(e.target.value)}
                className={inputCls}
              >
                {villaChoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {!checkoutOnly && availableVillas != null && (
                <p className="text-[11px] text-[#475569] mt-1">{t("availableHint")}</p>
              )}
            </div>

            {/* 체크인 */}
            <div>
              <label className={labelCls}>{t("fields.checkIn")}</label>
              <DateField
                value={checkIn}
                disabled={checkoutOnly}
                onChange={(e) => setCheckIn(e.target.value)}
                placeholder={t("datePlaceholder")}
                className={inputCls}
              />
            </div>
            {/* 체크아웃 — 항상 활성 */}
            <div>
              <label className={labelCls}>{t("fields.checkOut")}</label>
              <DateField
                value={checkOut}
                min={checkIn}
                onChange={(e) => setCheckOut(e.target.value)}
                placeholder={t("datePlaceholder")}
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

          {/* 자동 미리보기 — 날짜·빌라·인원 변경 시 실시간 계산(버튼 불필요) */}
          {previewBusy && (
            <p className="text-xs text-admin-muted flex items-center gap-1">
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              {t("preview.loading")}
            </p>
          )}
          {preview && !previewBusy && (
            <div>
              <p className="text-admin-muted font-semibold text-xs mb-1.5">{t("preview.title")}</p>
              {previewSummary(preview)}
              {noticeActions(preview)}
            </div>
          )}

          {/* 분할 숙박 — 같은 빌라 연장이 불가할 때 "다른 빌라로 이어서 예약" (ADR-0030 D1) */}
          {showSplit && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
              <p className="text-xs text-amber-300 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">alt_route</span>
                {t("split.notice", { from: initial.checkOut, to: checkOut })}
              </p>
              <select
                value={splitVillaId}
                aria-label={te("villa")}
                onChange={(e) => setSplitVillaId(e.target.value)}
                className={inputCls}
              >
                {(splitVillas ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {splitVillas != null && splitVillas.length === 0 && (
                <p className="text-[11px] text-red-400">{t("split.none")}</p>
              )}
              {splitError && <p className="text-xs text-red-400">{splitError}</p>}
              <button
                type="button"
                disabled={splitBusy || !splitVillaId}
                onClick={createExtension}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {splitBusy ? t("split.creating") : t("split.create")}
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || (preview != null && !preview.ok)}
              onClick={openConfirm}
              className="flex-1 bg-admin-primary hover:bg-blue-600 text-white font-bold py-2.5 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {t("submit")}
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

      {/* 저장 확인 팝업 (모달) */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-admin-card border border-[#334155] rounded-xl shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-admin-primary">edit_calendar</span>
              {t("confirm.title")}
            </h3>
            <p className="text-sm text-admin-muted">{t("confirm.body")}</p>

            {/* 변경 요약 */}
            <div className="text-xs text-white space-y-1">
              {villaId !== initial.villaId && (
                <p>
                  {t("fields.villa")}:{" "}
                  {villaChoices.find((v) => v.id === villaId)?.name ?? villaId}
                </p>
              )}
              {(checkIn !== initial.checkIn || checkOut !== initial.checkOut) && (
                <p>
                  {t("fields.checkIn")} → {t("fields.checkOut")}: {checkIn} → {checkOut}
                </p>
              )}
              {guestCount !== initial.guestCount && (
                <p>
                  {t("fields.guestCount")}: {initial.guestCount} → {guestCount}
                </p>
              )}
            </div>

            {preview && previewSummary(preview)}
            {preview?.overpayment && (
              <p className="text-xs text-amber-400">{t("confirm.overpaymentWarn")}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="flex-1 bg-admin-primary hover:bg-blue-600 text-white font-bold py-2.5 rounded-lg disabled:opacity-50"
              >
                {busy ? t("submitting") : t("confirm.ok")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="flex-1 bg-[#334155] text-admin-muted font-bold py-2.5 rounded-lg"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
