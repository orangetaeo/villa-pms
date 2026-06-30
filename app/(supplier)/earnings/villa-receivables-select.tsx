"use client";

// 빌라별 정산 조회 — 미수/지급 필터 칩으로 좁힌 뒤, 셀렉터로 빌라를 고르면 그 빌라 상세로 이동.
// 라벨은 서버(getTranslations)에서 props로 주입 — earnings 네임스페이스 클라 직렬화 안 함(누수 표면 최소).
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface VillaOption {
  id: string;
  label: string; // 빌라명
  hasOutstanding: boolean; // 미수(미지급) 있음
}

type FilterKey = "all" | "outstanding" | "paid";

export default function VillaReceivablesSelect({
  villas,
  selectedVillaId,
  labels,
}: {
  villas: VillaOption[];
  selectedVillaId?: string;
  labels: {
    title: string;
    placeholder: string;
    all: string;
    outstanding: string;
    paid: string;
  };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");

  const counts: Record<FilterKey, number> = {
    all: villas.length,
    outstanding: villas.filter((v) => v.hasOutstanding).length,
    paid: villas.filter((v) => !v.hasOutstanding).length,
  };
  const filtered =
    filter === "outstanding"
      ? villas.filter((v) => v.hasOutstanding)
      : filter === "paid"
        ? villas.filter((v) => !v.hasOutstanding)
        : villas;

  const chips: { key: FilterKey; label: string; active: string }[] = [
    { key: "all", label: labels.all, active: "border-teal-500 bg-teal-50 text-teal-700" },
    { key: "outstanding", label: labels.outstanding, active: "border-amber-400 bg-amber-50 text-amber-700" },
    { key: "paid", label: labels.paid, active: "border-emerald-400 bg-emerald-50 text-emerald-700" },
  ];

  return (
    <section className="space-y-2.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
        <span className="material-symbols-outlined text-[18px] text-teal-600">apartment</span>
        {labels.title}
      </h2>

      {/* 필터 칩 — 전체 / 미수 / 지급 (개수 표시). 드롭다운에 나올 빌라를 좁힌다 */}
      <div className="flex gap-1.5">
        {chips.map((c) => {
          const on = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              aria-pressed={on}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition-colors ${
                on ? c.active : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {c.label}
              <span
                className={`rounded px-1 text-[10px] tabular-nums ${
                  on ? "bg-white/70" : "bg-slate-100 text-slate-400"
                }`}
              >
                {counts[c.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* 빌라 셀렉터 — 필터된 목록만 */}
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
          {filtered.map((v) => (
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
