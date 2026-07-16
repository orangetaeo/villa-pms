"use client";

// 계약서 프린트 버튼 (T-business-contract-esign) — window.print() 호출. 자신은 .no-print로 숨김.
//   variant: "dark"=운영자 다크 대시보드 / "light"=상대방 라이트 포털.
export default function ContractPrintButton({
  label,
  variant = "dark",
}: {
  label: string;
  variant?: "dark" | "light";
}) {
  const cls =
    variant === "light"
      ? "inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-bold text-neutral-700 shadow-sm transition-all hover:bg-neutral-50 active:scale-[0.98]"
      : "inline-flex items-center gap-2 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]";
  return (
    <button type="button" onClick={() => window.print()} className={cls}>
      <span className="material-symbols-outlined text-base">print</span>
      {label}
    </button>
  );
}
