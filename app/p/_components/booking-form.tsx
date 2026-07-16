"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/** c3 상태1 폼 (#5 5개 언어) — 이름·연락처·인원 → POST /api/p/[token]/hold */

const inputClass =
  "w-full h-14 px-4 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all";

export function BookingForm({
  token,
  itemId,
  lang,
  maxGuests,
  cancellationPolicy,
}: {
  token: string;
  itemId: string;
  lang: PublicLang;
  /** 빌라 정원 — 인원 셀렉트 상한 + 클라 검증 (서버와 동일 기준, consumer-bugs #1) */
  maxGuests: number;
  /**
   * 취소·환불 규정 (T-proposal-policy-consent) — CANCELLATION_POLICY.enabled=true일 때만 전달.
   * null이면 동의 체크박스 미노출(하위호환). 값은 표시용일 뿐 — 저장 스냅샷은 서버가 재산출.
   */
  cancellationPolicy: { fullDays: number; partialDays: number; partialPct: number } | null;
}) {
  const labels = PUBLIC_LABELS[lang];
  const t = labels.bookingForm;
  const sales = labels.sales;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  // 정책 미표시(enabled=false)면 체크박스 미노출 → 동의 강제 없음(기존 플로우 회귀 0)
  const consentRequired = cancellationPolicy !== null;
  const [consented, setConsented] = useState(false);

  // 검증 메시지는 언어별 — 스키마를 labels로 구성(모듈 상단 하드코딩 제거)
  const formSchema = useMemo(
    () =>
      z.object({
        guestName: z.string().trim().min(1, t.errName),
        guestPhone: z
          .string()
          .trim()
          .regex(/^[0-9+\-\s]{9,20}$/, t.errPhone),
        guestCount: z.coerce.number().int().min(1, t.errCount).max(maxGuests, t.errOverCapacity),
      }),
    [t, maxGuests]
  );
  type FormValues = z.infer<typeof formSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { guestCount: 2 },
  });

  const onSubmit = async (values: FormValues) => {
    // 정책 표시 중인데 미동의면 제출 차단(버튼도 disabled — 이중 방어). 서버도 400 CONSENT_REQUIRED.
    if (consentRequired && !consented) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/p/${token}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          ...values,
          // 동의 플래그·표시 언어만 전송 — 정책 값 자체는 서버가 AppSetting에서 산출(클라 값 불신)
          ...(consentRequired ? { policyConsent: consented, locale: lang } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.bookingId) {
        router.replace(`/p/${token}/done/${data.bookingId}?lang=${lang}`);
        return;
      }
      // 거부 사유는 expired/closed 2종으로만 수신 (검수 게이트 등 내부 사유 미노출)
      // 정원 초과 — 폼에 머물며 인원 수정 유도 (consumer-bugs #1)
      if (data?.error === "over_capacity") {
        setError("guestCount", { message: t.errOverCapacity });
        setSubmitting(false);
        return;
      }
      const notice = data?.error === "expired" ? "expired" : "closed";
      router.replace(`/p/${token}?notice=${notice}&lang=${lang}`);
    } catch {
      setSubmitting(false);
      alert(t.alertError);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="guestName">
            {t.name}
          </label>
          <input
            id="guestName"
            className={inputClass}
            placeholder={t.namePlaceholder}
            type="text"
            {...register("guestName")}
          />
          {errors.guestName && (
            <p className="text-red-500 text-xs mt-1">{errors.guestName.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="guestPhone">
            {t.phone}
          </label>
          <input
            id="guestPhone"
            className={inputClass}
            placeholder="010-0000-0000"
            type="tel"
            {...register("guestPhone")}
          />
          {errors.guestPhone && (
            <p className="text-red-500 text-xs mt-1">{errors.guestPhone.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="guestCount">
            {t.count}
          </label>
          <select id="guestCount" className={inputClass} {...register("guestCount")}>
            {Array.from({ length: Math.max(1, maxGuests) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {t.countOption(n)}
              </option>
            ))}
          </select>
          {errors.guestCount && (
            <p className="text-red-500 text-xs mt-1">{errors.guestCount.message}</p>
          )}
        </div>
      </div>

      {/* 취소·환불 규정 전자 동의 (T-proposal-policy-consent) — 정책 표시 중일 때만.
          동의 당시 조건을 게스트가 직접 확인하도록 규정 3단계를 노출한 뒤 동의 체크박스. */}
      {cancellationPolicy && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-slate-500 text-base">gavel</span>
            <p className="text-sm font-bold text-slate-800">{t.policyConsentTitle}</p>
          </div>
          <ul className="text-xs text-slate-600 space-y-1 leading-relaxed">
            <li>
              {sales.cancelTierBefore}
              <span className="font-semibold text-slate-800">{cancellationPolicy.fullDays}</span>
              {sales.cancelTierMid}100{sales.cancelTierAfter}
            </li>
            <li>
              {sales.cancelTierBefore}
              <span className="font-semibold text-slate-800">{cancellationPolicy.partialDays}</span>
              {sales.cancelTierMid}
              <span className="font-semibold text-slate-800">{cancellationPolicy.partialPct}</span>
              {sales.cancelTierAfter}
            </li>
            <li>
              {sales.cancelNoneBefore}
              <span className="font-semibold text-slate-800">{cancellationPolicy.partialDays}</span>
              {sales.cancelNoneMid}
              {sales.cancelNoneAfter}
            </li>
          </ul>
          <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm text-slate-700 leading-snug">{t.policyConsentLabel}</span>
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || (consentRequired && !consented)}
        className="w-full h-14 bg-teal-600 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {submitting ? t.submitting : t.submit}
      </button>
    </form>
  );
}
