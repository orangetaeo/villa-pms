"use client";

// 동의서 게스트 언어 선택 (T-admin-checkin-sheet v2) — ?lang= 갱신.
// 시트는 한국어(기록용) + 선택 언어 병기로 동의서를 인쇄한다.
import { useRouter, useSearchParams } from "next/navigation";
import { AGREEMENT_LANGS, AGREEMENT_LANG_LABELS, type AgreementLang } from "@/lib/agreement";

export default function AgreementLangSelect({
  value,
  label,
}: {
  value: AgreementLang;
  label: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const onChange = (lang: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("lang", lang);
    router.push(`/bookings/checkin-sheet?${next.toString()}`);
  };

  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-widest text-slate-500 whitespace-nowrap">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-admin-card border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
      >
        {AGREEMENT_LANGS.map((l) => (
          <option key={l} value={l}>
            {AGREEMENT_LANG_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
