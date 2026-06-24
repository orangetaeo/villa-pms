"use client";

// 리스트 공통 페이지네이션 바 — 행 수 요약 + 페이지당 개수 선택(10/20/30/50/100) + 숫자 페이지 + 이전/다음.
// searchParams를 직접 읽어 모든 페이지에서 재사용(다른 필터 파라미터 보존, pageSize 변경 시 1페이지로).
// 운영자(다크)·공급자(라이트) 양쪽 사용 → light prop으로 테마 전환.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/** 현재 페이지 주변 + 처음/끝만 보이는 페이지 번호 윈도(많을 때 말줄임). */
function pageWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(totalPages - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

export default function PaginationBar({
  total,
  page,
  pageSize,
  light = false,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  /** 공급자(라이트) 화면이면 true — 기본은 운영자 다크 */
  light?: boolean;
  /** controlled 모드: 둘 다 주면 URL 대신 콜백으로 동작(클라 상태 목록용, 예: 제안). 없으면 URL 모드. */
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const t = useTranslations("pagination");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const controlled = !!onPageChange && !!onPageSizeChange;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const goPage = (p: number) => {
    if (controlled) onPageChange!(p);
    else go({ page: p <= 1 ? null : String(p) });
  };
  const changeSize = (s: number) => {
    if (controlled) onPageSizeChange!(s);
    else go({ pageSize: s === DEFAULT_PAGE_SIZE ? null : String(s), page: null });
  };

  if (total === 0) return null;

  // 테마 클래스
  const wrap = light
    ? "border-neutral-200 bg-white"
    : "border-slate-800 bg-slate-900/50";
  const muted = light ? "text-neutral-500" : "text-slate-500";
  const selectCls = light
    ? "border-neutral-300 bg-white text-neutral-700 focus:ring-teal-500"
    : "border-slate-700 bg-slate-900 text-slate-300 focus:ring-admin-primary";
  const navBtn = light
    ? "border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
    : "border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white";
  const navDisabled = light ? "text-neutral-300" : "text-slate-600";
  const pageActive = light
    ? "bg-teal-600 text-white"
    : "bg-admin-primary text-white";
  const pageIdle = light
    ? "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
    : "text-slate-400 hover:bg-slate-800 hover:text-white";

  const pages = pageWindow(page, totalPages);

  return (
    <div
      className={`mt-6 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${wrap}`}
    >
      {/* 좌: 요약 + 페이지당 개수 */}
      <div className="flex items-center gap-3">
        <p className={`text-xs whitespace-nowrap tabular-nums ${muted}`}>
          {t("summary", { from, to, total })}
        </p>
        <label className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${muted}`}>
          {t("perPage")}
          <select
            aria-label={t("perPage")}
            value={pageSize}
            onChange={(e) => changeSize(Number(e.target.value))}
            className={`cursor-pointer rounded-lg border px-2 py-1 text-xs font-bold tabular-nums focus:outline-none focus:ring-1 ${selectCls}`}
          >
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt} className={light ? "" : "bg-slate-900"}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 우: 페이지 네비 (1페이지뿐이면 숨김) */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("prev")}
            disabled={page <= 1}
            onClick={() => goPage(page - 1)}
            className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
              page > 1 ? navBtn : `${navDisabled} pointer-events-none border-transparent`
            }`}
          >
            <span className="material-symbols-outlined text-sm">chevron_left</span>
          </button>
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className={`px-1 text-xs ${muted}`}>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === page ? "page" : undefined}
                onClick={() => goPage(p)}
                className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-bold tabular-nums transition-colors ${
                  p === page ? pageActive : pageIdle
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            aria-label={t("next")}
            disabled={page >= totalPages}
            onClick={() => goPage(page + 1)}
            className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
              page < totalPages ? navBtn : `${navDisabled} pointer-events-none border-transparent`
            }`}
          >
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}
