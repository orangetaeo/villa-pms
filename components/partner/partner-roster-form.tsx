"use client";

// 파트너 투숙객 명단 사전 제출 폼 (여행사 포털 E) — PATCH /api/partner/bookings/[id]/roster.
//   자유 텍스트(대표자 + 동반자). 여권 OCR가 최종 진실원천이라 준비용 예고.
//   라이트 테마(파트너 포털). i18n: partner.roster.*
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function PartnerRosterForm({
  bookingId,
  initialRoster,
  canEdit,
}: {
  bookingId: string;
  initialRoster: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("partner.roster");
  const [roster, setRoster] = useState(initialRoster ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // 편집 불가(체크인 이후·취소·만료) — 읽기전용 표시.
  if (!canEdit) {
    return (
      <div className="rounded-xl bg-neutral-50 px-4 py-3">
        {initialRoster ? (
          <p className="whitespace-pre-wrap text-sm text-neutral-700">{initialRoster}</p>
        ) : (
          <p className="text-sm text-neutral-400">{t("emptyLocked")}</p>
        )}
        <p className="mt-2 text-xs text-neutral-400">{t("locked")}</p>
      </div>
    );
  }

  const save = async () => {
    setState("saving");
    try {
      const res = await fetch(`/api/partner/bookings/${bookingId}/roster`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestRoster: roster }),
      });
      setState(res.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        value={roster}
        onChange={(e) => {
          setRoster(e.target.value);
          setState("idle");
        }}
        maxLength={2000}
        rows={5}
        placeholder={t("placeholder")}
        className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base text-neutral-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
      />
      <p className="text-xs text-neutral-400">{t("hint")}</p>
      <button
        type="button"
        disabled={state === "saving"}
        onClick={save}
        className="w-full rounded-xl bg-teal-600 px-4 py-3.5 text-base font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
      >
        {state === "saving" ? t("saving") : t("save")}
      </button>
      {state === "saved" && (
        <p role="status" className="text-center text-sm font-semibold text-teal-700">
          {t("saved")}
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-center text-sm text-rose-600">
          {t("error")}
        </p>
      )}
    </div>
  );
}
