"use client";

// 빌라별 정산 조회 — 셀렉터로 빌라를 고르면 그 빌라 상세(언제·얼마·결과)로 이동.
// 라벨/옵션 텍스트는 서버(getTranslations·formatVndDot)에서 props로 주입 — earnings 네임스페이스 클라 직렬화 안 함(누수 표면 최소).
import { useRouter } from "next/navigation";

export interface VillaOption {
  id: string;
  /** 셀렉터 옵션 텍스트(빌라명 + 미수 표기는 서버에서 합성) */
  label: string;
}

export default function VillaReceivablesSelect({
  villas,
  selectedVillaId,
  labels,
}: {
  villas: VillaOption[];
  selectedVillaId?: string;
  labels: {
    title: string;
    placeholder: string; // 미선택(전체) 옵션 텍스트
  };
}) {
  const router = useRouter();

  return (
    <section className="space-y-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
        <span className="material-symbols-outlined text-[18px] text-teal-600">apartment</span>
        {labels.title}
      </h2>
      <div className="relative">
        <select
          value={selectedVillaId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            router.push(id ? `/earnings?view=detail&villa=${id}` : "/earnings?view=detail");
          }}
          aria-label={labels.title}
          className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-10 text-sm font-medium text-slate-800 focus:border-teal-500 focus:bg-white focus:ring-1 focus:ring-teal-500"
        >
          <option value="">{labels.placeholder}</option>
          {villas.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          expand_more
        </span>
      </div>
    </section>
  );
}
