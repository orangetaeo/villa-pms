"use client";

// 파트너 채권 목록 — controlled 페이지네이션 래퍼 (라이트 테마).
//   서버(page.tsx)가 자기 partnerId 스코프로 조회한 전체 목록을 props로 받아
//   클라에서 표시 슬라이스만 한다(데이터 경계 변경 없음).
import { useState, useEffect, useMemo } from "react";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { useTranslations } from "next-intl";
import { formatVillaName } from "@/lib/villa-name";
import type { PartnerReceivableRow } from "@/lib/partner-portal";
import { formatVndDot, formatDate, formatDayMonth } from "../_format";

const RECEIVABLE_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PARTIAL: "bg-blue-100 text-blue-700",
  PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-rose-100 text-rose-700",
  WRITTEN_OFF: "bg-neutral-100 text-neutral-500",
};

export default function ReceivablesList({
  receivables,
}: {
  receivables: PartnerReceivableRow[];
}) {
  const t = useTranslations("partner");

  // 검색(부분일치) — 빌라명(한국어·베트남어 병기) 식별 텍스트만. 데이터 경계 변경 없음(표시 필터).
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receivables;
    return receivables.filter((r) =>
      formatVillaName({ name: r.villaName, nameVi: r.villaNameVi })
        .toLowerCase()
        .includes(q)
    );
  }, [receivables, search]);

  // controlled 페이지네이션 상태 (목록·검색 변경 시 1페이지로 리셋)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [receivables, search]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  // 빈 상태는 전체 기준 유지(검색 결과 0건은 아래 목록 영역에서 안내)
  if (receivables.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
        {t("receivables.empty")}
      </div>
    );
  }

  return (
    <>
      {/* 검색 — 라이트(파트너 포털) */}
      <div className="mb-3">
        <ListSearch
          light
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={setSearch}
          className="max-w-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
          {t("receivables.empty")}
        </div>
      ) : (
        <ul className="space-y-3">
          {paged.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate font-bold text-neutral-900">
                  {formatVillaName({ name: r.villaName, nameVi: r.villaNameVi })}
                </h4>
                <p className="text-sm text-neutral-500">
                  {formatDayMonth(r.checkIn)} – {formatDayMonth(r.checkOut)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                  RECEIVABLE_STATUS_STYLE[r.status] ?? "bg-neutral-100 text-neutral-500"
                }`}
              >
                {t(`receivableStatus.${r.status}`)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-neutral-100 pt-3 text-center">
              <Field label={t("receivables.total")} value={formatVndDot(r.totalVnd)} />
              <Field
                label={t("receivables.paid")}
                value={formatVndDot(
                  (BigInt(r.depositPaidVnd) + BigInt(r.balancePaidVnd)).toString()
                )}
              />
              <Field
                label={t("receivables.balance")}
                value={formatVndDot(r.outstandingVnd)}
                emphasis
              />
            </dl>
            <p className="mt-2 text-right text-xs text-neutral-400">
              {t("receivables.due", { date: formatDate(r.dueDate) })}
            </p>
          </li>
          ))}
        </ul>
      )}

      {/* 라이트 테마 — 파트너 포털 (검색 필터 후 건수 기준) */}
      {filtered.length > 0 && (
        <PaginationBar
          light
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function Field({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className={`text-sm font-bold ${emphasis ? "text-rose-600" : "text-neutral-800"}`}>
        {value}
      </dd>
    </div>
  );
}
