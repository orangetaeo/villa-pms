"use client";

// 프린트 버튼 (T-admin-checkin-sheet) — window.print() 호출. 인쇄 시 자신은 .no-print로 숨김.
export default function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-admin-primary text-white text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all"
    >
      <span className="material-symbols-outlined text-base">print</span>
      {label}
    </button>
  );
}
