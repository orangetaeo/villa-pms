"use client";

// 미수/여신 파트너별 채권 목록 — 클라 페이지네이션 래퍼 (controlled slice + PaginationBar).
// 데이터는 서버(RSC)가 전량 집계해 표시용 필드만 내려준다(BigInt·Partner 전체 객체 미전달 — 직렬화·누수 차단).
// KPI·Aging 합산은 전 파트너 기준이라 서버가 그대로 그리고, 이 표만 메모리 슬라이스한다.
// 다크 admin 화면(light prop 없음). 패턴: proposals-list.tsx.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

// 서버가 내려주는 표시 전용 행 — 금액은 이미 formatVnd로 문자열화, 판정 결과(overdue/overLimit/has30Plus)는 boolean.
export interface ReceivableRow {
  partnerId: string;
  partnerName: string;
  typeLabel: string; // tp(`types.${type}`)
  tierLabel: string; // tp(`tierShort.${creditTier}`)
  outstandingLabel: string; // formatVnd(outstandingVnd)
  overdue: boolean;
  over30Label: string | null; // aging["30+"]>0 이면 formatVnd, 아니면 null
  overLimit: boolean;
}

export default function ReceivablesTable({ rows }: { rows: ReceivableRow[] }) {
  const t = useTranslations("adminReceivables");
  const tp = useTranslations("adminPartners");

  // 클라 페이지네이션 — 전체 로드 후 메모리 슬라이스 (controlled 모드).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const paged = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize]
  );

  const columns: ResponsiveColumn<ReceivableRow>[] = [
    {
      key: "name",
      header: tp("col.name"),
      cell: (a) => (
        <Link href={`/partners/${a.partnerId}`} className="font-bold text-white hover:text-admin-primary">
          {a.partnerName}
          <span className="block text-[11px] font-normal text-slate-500">
            {a.typeLabel} · {a.tierLabel}
          </span>
        </Link>
      ),
    },
    {
      key: "outstanding",
      header: tp("col.outstanding"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (a) => (
        <span className={a.overdue ? "font-bold text-red-400" : "text-slate-200"}>
          {a.outstandingLabel}
        </span>
      ),
    },
    {
      key: "30+",
      header: tp("aging.30+"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (a) =>
        a.over30Label ? (
          <span className="text-red-400">{a.over30Label}</span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    {
      key: "alerts",
      header: t("alerts"),
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.overdue && (
            <span className="inline-block rounded px-2 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-300">
              {tp("overdue")}
            </span>
          )}
          {a.overLimit && (
            <span className="inline-block rounded px-2 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-300">
              {t("overLimitBadge")}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ResponsiveTable
        columns={columns}
        rows={paged}
        rowKey={(a) => a.partnerId}
        emptyMessage={t("empty")}
        cardSummary={(a) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-white">{a.partnerName}</span>
            <span className={`text-xs ${a.overdue ? "text-red-400 font-bold" : "text-slate-400"}`}>
              {a.outstandingLabel}
              {a.overdue ? ` · ${tp("overdue")}` : ""}
            </span>
          </div>
        )}
      />
      <PaginationBar
        total={rows.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </>
  );
}
