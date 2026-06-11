"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

/** c3 상태1 폼 — 이름·연락처(+인원, 계약 편차) → POST /api/p/[token]/hold */

const formSchema = z.object({
  guestName: z.string().trim().min(1, "성함을 입력해주세요"),
  guestPhone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{9,20}$/, "연락처를 정확히 입력해주세요"),
  guestCount: z.coerce.number().int().min(1, "인원을 선택해주세요").max(16),
});

type FormValues = z.infer<typeof formSchema>;

const inputClass =
  "w-full h-14 px-4 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all";

export function BookingForm({ token, itemId }: { token: string; itemId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { guestCount: 2 },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/p/${token}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...values }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.bookingId) {
        router.replace(`/p/${token}/done/${data.bookingId}`);
        return;
      }
      // 거부 사유는 expired/closed 2종으로만 수신 (검수 게이트 등 내부 사유 미노출)
      const notice = data?.error === "expired" ? "expired" : "closed";
      router.replace(`/p/${token}?notice=${notice}`);
    } catch {
      setSubmitting(false);
      alert("신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="guestName">
            이름
          </label>
          <input
            id="guestName"
            className={inputClass}
            placeholder="성함을 입력해주세요"
            type="text"
            {...register("guestName")}
          />
          {errors.guestName && (
            <p className="text-red-500 text-xs mt-1">{errors.guestName.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="guestPhone">
            연락처
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
            인원
          </label>
          <select id="guestCount" className={inputClass} {...register("guestCount")}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}명
              </option>
            ))}
          </select>
          {errors.guestCount && (
            <p className="text-red-500 text-xs mt-1">{errors.guestCount.message}</p>
          )}
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full h-14 bg-teal-600 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {submitting ? "신청 처리 중…" : "가예약 신청하기"}
      </button>
    </form>
  );
}
