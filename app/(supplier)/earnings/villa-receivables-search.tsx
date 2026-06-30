"use client";

// 빌라별 정산 조회 — 검색으로 빌라를 고르고, 클릭하면 그 빌라의 상세(언제·얼마·결과)로 이동.
// 라벨은 서버(getTranslations)에서 props로 주입 — earnings 네임스페이스를 클라이언트로 직렬화하지 않음(누수 표면 최소).
import { useState } from "react";
import Link from "next/link";

export interface VillaRow {
  id: string;
  name: string;
  paidText: string; // 서버에서 formatVndDot한 문자열
  outstandingText: string;
  hasOutstanding: boolean;
}

export default function VillaReceivablesSearch({
  villas,
  selectedVillaId,
  labels,
}: {
  villas: VillaRow[];
  selectedVillaId?: string;
  labels: {
    title: string;
    searchPlaceholder: string;
    paid: string;
    outstanding: string;
    noMatch: string;
    viewDetail: string;
  };
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query
    ? villas.filter((v) => v.name.toLowerCase().includes(query))
    : villas;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
        <span className="material-symbols-outlined text-[18px] text-teal-600">apartment</span>
        {labels.title}
      </h2>

      {/* 검색 입력 */}
      <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-teal-500">
        <span className="material-symbols-outlined text-[20px] text-slate-400">search</span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          className="ml-2 w-full flex-1 border-0 bg-transparent p-0 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-0"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="clear"
            className="text-slate-400 hover:text-slate-600"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>

      {/* 빌라 목록 — 클릭하면 그 빌라 상세로. 선택된 빌라는 강조 */}
      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">{labels.noMatch}</p>
        ) : (
          filtered.map((v) => {
            const selected = v.id === selectedVillaId;
            return (
              <Link
                key={v.id}
                href={`/earnings?view=detail&villa=${v.id}`}
                aria-current={selected ? "true" : undefined}
                className={`block rounded-lg border px-3 py-2.5 transition-colors active:scale-[0.99] ${
                  selected
                    ? "border-teal-300 bg-teal-50 ring-1 ring-teal-200"
                    : "border-slate-100 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-bold text-slate-800">{v.name}</p>
                  <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-teal-700">
                    {labels.viewDetail}
                    <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1 text-emerald-600">
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    {labels.paid}
                    <b className="tabular-nums">{v.paidText}</b>
                  </span>
                  <span
                    className={`flex items-center gap-1 ${
                      v.hasOutstanding ? "text-amber-600" : "text-slate-400"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    {labels.outstanding}
                    <b className="tabular-nums">{v.outstandingText}</b>
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
