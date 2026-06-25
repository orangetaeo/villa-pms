"use client";

// 사후 서명 모드 (T3.2 계약 결정 2) — 무서명 CHECKED_IN 레코드의 소급 해소.
// 동의서+패드만 렌더 → 서명 즉시 POST /api/bookings/[id]/agreement → 상세로.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import AgreementSection from "./agreement-section";
import type { AgreementContent } from "@/lib/agreement";

export default function PostSignForm({
  bookingId,
  hasPool,
  agreement,
}: {
  bookingId: string;
  hasPool: boolean;
  /** 발행본 동의서 콘텐츠 — RSC에서 store 조회 후 주입 */
  agreement: AgreementContent;
}) {
  const t = useTranslations("adminCheckin.agreement");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const onSigned = async (signatureUrl: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/agreement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? data?.error ?? t("signError"));
        return;
      }
      router.replace(`/bookings/${bookingId}`);
      router.refresh();
    } catch {
      setError(t("signError"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm text-amber-400">
        {t("postSignDesc")}
      </div>
      <AgreementSection hasPool={hasPool} sectionNo={1} agreement={agreement} onSigned={onSigned} />
      {error && <p className="text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
