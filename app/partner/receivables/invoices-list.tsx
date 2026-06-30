"use client";

// 파트너 청구서 목록 — controlled 페이지네이션 래퍼 (라이트 테마).
//   서버(page.tsx)가 자기 partnerId 스코프로 조회한 전체 목록을 props로 받아
//   클라에서 표시 슬라이스만 한다(데이터 경계 변경 없음).
import { useState, useEffect, useMemo } from "react";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { useTranslations } from "next-intl";
import type { PartnerInvoiceRow } from "@/lib/partner-portal";
import { formatVndDot, formatDate } from "../_format";
import PaymentNoticeButton from "@/components/partner/payment-notice-button";

// 발행된 청구서만(DRAFT/VOID 제외) PDF 다운로드 가능.
const DOWNLOADABLE = new Set(["ISSUED", "PARTIAL", "PAID", "OVERDUE"]);
// 미완납·발행 청구서만 입금 통보 의미 있음(PAID/DRAFT/VOID 제외).
const NOTIFIABLE = new Set(["ISSUED", "PARTIAL", "OVERDUE"]);

const INVOICE_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-500",
  ISSUED: "bg-amber-100 text-amber-700",
  PARTIAL: "bg-blue-100 text-blue-700",
  PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-rose-100 text-rose-700",
  VOID: "bg-neutral-100 text-neutral-400 line-through",
};

export default function InvoicesList({ invoices }: { invoices: PartnerInvoiceRow[] }) {
  const t = useTranslations("partner");

  // 검색(부분일치) — 청구 기간(날짜)·상태 라벨 식별 텍스트. 데이터 경계 변경 없음(표시 필터).
  //   ※ PartnerInvoiceRow에는 청구서번호·빌라명 필드가 없어(서버 미노출) 노출 텍스트로 검색.
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) =>
      `${formatDate(inv.periodStart)} ${formatDate(inv.periodEnd)} ${t(
        `invoiceStatus.${inv.status}`
      )}`
        .toLowerCase()
        .includes(q)
    );
  }, [invoices, search, t]);

  // controlled 페이지네이션 상태 (목록·검색 변경 시 1페이지로 리셋)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [invoices, search]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  // 빈 상태는 전체 기준 유지(검색 결과 0건은 아래 목록 영역에서 안내)
  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
        {t("receivables.invoiceEmpty")}
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
          {t("receivables.invoiceEmpty")}
        </div>
      ) : (
        <ul className="space-y-3">
          {paged.map((inv) => (
          <li
            key={inv.id}
            className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="font-bold text-neutral-900">
                  {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                </h4>
                <p className="text-sm text-neutral-500">
                  {t("receivables.due", { date: formatDate(inv.dueDate) })}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                  INVOICE_STATUS_STYLE[inv.status] ?? "bg-neutral-100 text-neutral-500"
                }`}
              >
                {t(`invoiceStatus.${inv.status}`)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-100 pt-3 text-center">
              <Field label={t("receivables.total")} value={formatVndDot(inv.totalVnd)} />
              <Field label={t("receivables.paid")} value={formatVndDot(inv.paidVnd)} />
            </dl>
            {/* 액션 — PDF 다운로드(A) + 입금 통보(B). 발행 상태에 따라 노출. */}
            {(DOWNLOADABLE.has(inv.status) || NOTIFIABLE.has(inv.status)) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
                {DOWNLOADABLE.has(inv.status) && (
                  <a
                    href={`/api/partner/invoices/${inv.id}/statement`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-base">download</span>
                    {t("receivables.downloadPdf")}
                  </a>
                )}
                {NOTIFIABLE.has(inv.status) && (
                  <PaymentNoticeButton invoiceId={inv.id} />
                )}
              </div>
            )}
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className="text-sm font-bold text-neutral-800">{value}</dd>
    </div>
  );
}
