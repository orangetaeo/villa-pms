"use client";

// 정산 화면 클라이언트 뷰 (T4.5 — Stitch b7-settlements 변환)
// 월 이동(?yearMonth=) + 집계 실행(POST /api/settlements) + 상태 전이(PATCH /api/settlements/[id])
// 행 확장 상세는 클라이언트 상태 — 데이터는 RSC에서 전부 주입 (추가 fetch 없음)
// ≥768px: b7 테이블 / <768px: 카드 스택 (responsive-table 패턴 — 행 확장 때문에 직접 구현)
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import QuickDateFilter from "@/components/admin/quick-date-filter";

export type SettlementStatusKey =
  | "DRAFT"
  | "CONFIRMED"
  | "COLLECTED"
  | "FX_ADJUSTED"
  | "PAID";

export interface SettlementItemRow {
  id: string;
  villaName: string;
  checkOutText: string; // "2026.07.05"
  nights: number;
  amountVndText: string; // "4,550,000₫"
}

export interface SettlementRow {
  id: string;
  supplierName: string;
  supplierPhone: string | null;
  totalVndText: string;
  /** 운영자 마진(ADMIN 전용) — 이 공급자 예약의 수납 VND환산 − 지급. 데이터 없으면 null */
  marginVndText: string | null;
  status: SettlementStatusKey;
  paidAtText: string | null; // "2026.07.31"
  items: SettlementItemRow[];
}

interface SummaryProps {
  krwRevenueText: string;
  vndRevenueText: string;
  supplierCount: number;
  totalPayoutText: string;
}

/** 운영자 손익 요약(ADMIN 전용, 정산 고도화 1차) */
export interface FinanceSummaryProps {
  collectedKrwText: string;
  collectedVndText: string;
  collectedVndEquivalentText: string;
  /** 정산 2차 P2-1 — 실수납 합계(Payment.vndEquivalent 합) */
  actualCollectedText: string;
  /** 미수(견적 환산 − 실수납). 양수=받을 돈, 음수=초과수납 */
  outstandingText: string;
  outstandingPositive: boolean;
  payoutText: string;
  marginVndText: string;
  marginPositive: boolean;
  fxMissingCount: number;
  bookingCount: number;
}

// b7 상태 뱃지 색 (초안/확정/지급완료)
const STATUS_BADGE: Record<SettlementStatusKey, string> = {
  DRAFT: "bg-slate-500/10 text-slate-500 border-slate-700/50",
  CONFIRMED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  COLLECTED: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  FX_ADJUSTED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  PAID: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
};

/** "YYYY-MM" ± delta 개월 */
function shiftMonth(yearMonth: string, delta: number): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function SettlementsView({
  yearMonth,
  summary,
  financeSummary,
  rows,
}: {
  yearMonth: string;
  summary: SummaryProps;
  financeSummary: FinanceSummaryProps;
  rows: SettlementRow[];
}) {
  const t = useTranslations("adminSettlements");
  const router = useRouter();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(
    null
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const goMonth = (delta: number) => {
    setNotice(null);
    router.push(`/settlements?yearMonth=${shiftMonth(yearMonth, delta)}`);
  };

  // 집계 실행 — 멱등(POST /api/settlements). 결과 요약(created/updated/skipped) 표시 후 refresh
  const runGenerate = async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data: {
        created: number;
        updated: number;
        skipped: unknown[];
        totalSuppliers: number;
      } = await res.json();
      setNotice({
        kind: "success",
        text: t("generateResult", {
          created: data.created,
          updated: data.updated,
          skipped: data.skipped.length,
          totalSuppliers: data.totalSuppliers,
        }),
      });
      router.refresh();
    } catch {
      setNotice({ kind: "error", text: t("generateError") });
    } finally {
      setGenerating(false);
    }
  };

  // 상태 전이 (P2-2 생애주기) — DRAFT→확정→수납완료→(환차)→지급완료. confirm + 409 안내.
  type TransitionAction = "CONFIRM" | "COLLECT" | "ADJUST_FX" | "MARK_PAID";
  const runTransition = async (
    id: string,
    action: TransitionAction,
    fxAdjustmentVnd?: string
  ) => {
    const dialog: Record<TransitionAction, string> = {
      CONFIRM: t("actions.confirmDialog"),
      COLLECT: t("actions.collectDialog"),
      ADJUST_FX: t("actions.adjustFxDialog"),
      MARK_PAID: t("actions.markPaidDialog"),
    };
    // ADJUST_FX는 prompt에서 이미 금액 확인 — 중복 confirm 생략
    if (action !== "ADJUST_FX" && !window.confirm(dialog[action])) return;
    setPendingId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/settlements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(fxAdjustmentVnd != null ? { fxAdjustmentVnd } : {}),
        }),
      });
      if (res.status === 409) {
        // INVALID_TRANSITION — 다른 곳에서 이미 처리됨. 안내 후 최신 상태 재조회
        setNotice({ kind: "error", text: t("actions.conflict") });
        router.refresh();
        return;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      router.refresh();
    } catch {
      setNotice({ kind: "error", text: t("actions.error") });
    } finally {
      setPendingId(null);
    }
  };

  // 환차 조정 — 금액(VND, +이익/−손실)을 prompt로 받아 ADJUST_FX 전이
  const promptAdjustFx = (id: string) => {
    const raw = window.prompt(t("actions.adjustFxPrompt"));
    if (raw == null) return;
    const cleaned = raw.trim().replace(/[,\s]/g, "");
    if (!/^-?\d+$/.test(cleaned)) {
      setNotice({ kind: "error", text: t("actions.adjustFxInvalid") });
      return;
    }
    void runTransition(id, "ADJUST_FX", cleaned);
  };

  const statusBadge = (status: SettlementStatusKey) => (
    <span
      className={`px-3 py-1 rounded-md text-[10px] font-bold border whitespace-nowrap ${STATUS_BADGE[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );

  // b7 관리 열 — 생애주기(P2-2): DRAFT→확정 / CONFIRMED→수납완료·지급 / COLLECTED→환차·지급 /
  //   FX_ADJUSTED→환차재조정·지급 / PAID→완료 표시. 환차는 선택 단계.
  const outlineBtn =
    "border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 text-[11px] font-bold px-3 py-1.5 rounded transition-all whitespace-nowrap";
  const fxBtn =
    "border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 text-[11px] font-bold px-3 py-1.5 rounded transition-all whitespace-nowrap";
  const payBtn =
    "bg-admin-primary hover:bg-admin-primary-dark disabled:opacity-50 text-white text-[11px] font-bold px-3 py-1.5 rounded transition-all active:scale-95 shadow-lg shadow-blue-900/40 whitespace-nowrap";

  const actionCell = (row: SettlementRow) => {
    const busy = pendingId === row.id;
    const payButton = (
      <button type="button" disabled={busy} onClick={() => runTransition(row.id, "MARK_PAID")} className={payBtn}>
        {busy ? t("actions.processing") : t("actions.markPaid")}
      </button>
    );
    const fxButton = (label: string) => (
      <button type="button" disabled={busy} onClick={() => promptAdjustFx(row.id)} className={fxBtn}>
        {label}
      </button>
    );

    if (row.status === "DRAFT") {
      return (
        <button type="button" disabled={busy} onClick={() => runTransition(row.id, "CONFIRM")} className={outlineBtn}>
          {busy ? t("actions.processing") : t("actions.confirm")}
        </button>
      );
    }
    if (row.status === "CONFIRMED") {
      return (
        <div className="flex justify-end items-center gap-2 flex-wrap">
          <button type="button" disabled={busy} onClick={() => runTransition(row.id, "COLLECT")} className={outlineBtn}>
            {busy ? t("actions.processing") : t("actions.collect")}
          </button>
          {payButton}
        </div>
      );
    }
    if (row.status === "COLLECTED") {
      return (
        <div className="flex justify-end items-center gap-2 flex-wrap">
          {fxButton(t("actions.adjustFx"))}
          {payButton}
        </div>
      );
    }
    if (row.status === "FX_ADJUSTED") {
      return (
        <div className="flex justify-end items-center gap-2 flex-wrap">
          {fxButton(t("actions.adjustFxRedo"))}
          {payButton}
        </div>
      );
    }
    return (
      <div className="flex justify-end items-center gap-2 text-emerald-500 whitespace-nowrap">
        <span className="material-symbols-outlined text-sm">check_circle</span>
        <span className="text-[11px] font-bold tabular-nums">
          {t("actions.paidAt", { date: row.paidAtText ?? "" })}
        </span>
      </div>
    );
  };

  // 확장 상세 — b7 서브 그리드 (빌라명 / 체크아웃 날짜 / 박수 / 원가 금액)
  const detailGrid = (row: SettlementRow) => (
    <>
      <div className="grid grid-cols-6 text-[10px] font-bold text-slate-600 border-b border-slate-800/50 pb-2 mb-2">
        <div className="col-span-2 whitespace-nowrap">{t("detail.colVilla")}</div>
        <div className="text-center whitespace-nowrap">{t("detail.colCheckout")}</div>
        <div className="text-center whitespace-nowrap">{t("detail.colNights")}</div>
        <div className="text-right col-span-2 whitespace-nowrap">{t("detail.colAmount")}</div>
      </div>
      {row.items.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">{t("detail.empty")}</p>
      ) : (
        row.items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-6 py-2 text-[13px] border-b border-slate-800/30 last:border-none"
          >
            <div className="col-span-2 text-slate-300 font-medium">{item.villaName}</div>
            <div className="text-center text-slate-400 tabular-nums">{item.checkOutText}</div>
            <div className="text-center text-slate-400 tabular-nums">
              {t("detail.nightsValue", { count: item.nights })}
            </div>
            <div className="text-right col-span-2 text-slate-100 font-bold tabular-nums">
              {item.amountVndText}
            </div>
          </div>
        ))
      )}
    </>
  );

  return (
    <div>
      {/* 헤더: 타이틀 + 월 선택 + 집계 실행 / 매출·지급 요약 카드 (b7) */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white mb-2">{t("title")}</h1>
          {/* 빠른 월 필터 — 정산은 월 단위라 이번/지난/다음 달만. ?range= 동기화 */}
          <div className="mb-3">
            <QuickDateFilter presets={["thisMonth", "lastMonth", "nextMonth"]} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-4 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/50 w-fit">
              <button
                type="button"
                aria-label={t("monthPrev")}
                onClick={() => goMonth(-1)}
                className="p-1 hover:bg-slate-700 rounded transition-colors"
              >
                <span className="material-symbols-outlined text-slate-400">chevron_left</span>
              </button>
              <span className="text-lg font-bold text-slate-100 min-w-[120px] text-center whitespace-nowrap tabular-nums">
                {yearMonth.replace("-", ".")}
              </span>
              <button
                type="button"
                aria-label={t("monthNext")}
                onClick={() => goMonth(1)}
                className="p-1 hover:bg-slate-700 rounded transition-colors"
              >
                <span className="material-symbols-outlined text-slate-400">chevron_right</span>
              </button>
            </div>
            {/* 집계 실행 — b7에는 없는 기능 버튼 (계약 T4.5 범위), b7 primary 버튼 스타일 준용 */}
            <button
              type="button"
              disabled={generating}
              onClick={runGenerate}
              className="bg-admin-primary hover:bg-admin-primary-dark disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors active:scale-95 whitespace-nowrap"
            >
              <span
                className={`material-symbols-outlined text-sm ${generating ? "animate-spin" : ""}`}
              >
                sync
              </span>
              <span>{generating ? t("generating") : t("generate")}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <SummaryCard
              icon="payments"
              chip="KRW"
              label={t("summary.krwRevenue")}
              value={summary.krwRevenueText}
              sub={t("summary.krwChannel")}
            />
            <SummaryCard
              icon="payments"
              chip="VND"
              label={t("summary.vndRevenue")}
              value={summary.vndRevenueText}
              sub={t("summary.vndChannel")}
            />
            <SummaryCard
              icon="group"
              chip="ACTIVE"
              label={t("summary.suppliers")}
              value={t("summary.suppliersValue", { count: summary.supplierCount })}
            />
            <SummaryCard
              icon="payments"
              chip="TOTAL"
              label={t("summary.totalPayout")}
              value={summary.totalPayoutText}
            />
          </div>
          {/* 통화별 분리 안내 — KRW/VND 합산 금지 (ADR-0003) */}
          <div className="flex items-center gap-1.5 text-slate-500 justify-end">
            <span className="material-symbols-outlined text-sm">info</span>
            <span className="text-[11px] font-medium">{t("summary.currencyNote")}</span>
          </div>
        </div>
      </div>

      {/* 운영자 손익 요약 (정산 고도화 1차) — 수납→VND환산→지급→마진. ADMIN(canViewFinance) 전용 */}
      <section className="mb-8 bg-admin-card border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-admin-primary text-[20px]">trending_up</span>
            <h2 className="font-bold text-slate-100 text-sm whitespace-nowrap">{t("finance.title")}</h2>
          </div>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">
            {t("finance.bookingCount", { count: financeSummary.bookingCount })}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-800">
          {/* 수납 (통화별) */}
          <FinanceCell label={t("finance.collected")} sub={t("summary.currencyNote")}>
            <span className="block text-sm font-bold text-slate-100 tabular-nums">{financeSummary.collectedKrwText}</span>
            <span className="block text-sm font-bold text-slate-100 tabular-nums">{financeSummary.collectedVndText}</span>
          </FinanceCell>
          {/* VND 환산 합 (견적 기준) */}
          <FinanceCell label={t("finance.collectedVndEq")} sub={t("finance.fxSnapshotNote")}>
            <span className="text-lg font-black text-slate-100 tabular-nums">{financeSummary.collectedVndEquivalentText}</span>
          </FinanceCell>
          {/* 실수납 합계 (정산 2차 P2-1 — 실제 입금) */}
          <FinanceCell label={t("finance.actualCollected")} sub={t("finance.actualCollectedSub")}>
            <span className="text-lg font-black text-slate-100 tabular-nums">{financeSummary.actualCollectedText}</span>
          </FinanceCell>
          {/* 미수 (견적 환산 − 실수납) */}
          <FinanceCell label={t("finance.outstanding")} sub={t("finance.outstandingSub")}>
            <span
              className={`text-lg font-black tabular-nums ${
                financeSummary.outstandingPositive ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {financeSummary.outstandingText}
            </span>
          </FinanceCell>
          {/* 지급 (공급자 원가) */}
          <FinanceCell label={t("finance.payout")} sub={t("finance.payoutSub")}>
            <span className="text-lg font-black text-amber-400 tabular-nums">{financeSummary.payoutText}</span>
          </FinanceCell>
          {/* 마진 */}
          <FinanceCell label={t("finance.margin")} sub={t("finance.marginSub")}>
            <span
              className={`text-lg font-black tabular-nums ${
                financeSummary.marginPositive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {financeSummary.marginVndText}
            </span>
          </FinanceCell>
        </div>
        {financeSummary.fxMissingCount > 0 && (
          <div className="px-5 py-2.5 border-t border-slate-800 bg-amber-500/5 flex items-center gap-1.5 text-amber-500">
            <span className="material-symbols-outlined text-sm">warning</span>
            <span className="text-[11px] font-medium">
              {t("finance.fxMissing", { count: financeSummary.fxMissingCount })}
            </span>
          </div>
        )}
      </section>

      {/* 집계 결과·에러 배너 */}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mb-6 px-4 py-3 rounded-xl border text-sm font-medium ${
            notice.kind === "error"
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          }`}
        >
          {notice.text}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-admin-card border border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-500">
          {t("table.empty")}
        </div>
      ) : (
        <>
          {/* 데스크톱(≥768px): b7 재무 테이블 — 행 확장 상세 */}
          <div className="hidden md:block bg-admin-card border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-900/50 border-b border-slate-800">
                <tr>
                  <th className="py-4 px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">
                    {t("table.colSupplier")}
                  </th>
                  <th className="py-4 px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center whitespace-nowrap">
                    {t("table.colCount")}
                  </th>
                  <th className="py-4 px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">
                    {t("table.colTotal")}
                  </th>
                  <th className="py-4 px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">
                    {t("table.colMargin")}
                  </th>
                  <th className="py-4 px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center whitespace-nowrap">
                    {t("table.colStatus")}
                  </th>
                  <th className="py-4 px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">
                    {t("table.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = expanded.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={
                          isOpen
                            ? "bg-slate-800/30"
                            : "border-b border-slate-800 hover:bg-slate-800/20 transition-colors"
                        }
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={isOpen ? t("table.collapse") : t("table.expand")}
                              onClick={() => toggle(row.id)}
                              className="flex items-center"
                            >
                              <span
                                className={`material-symbols-outlined cursor-pointer ${
                                  isOpen
                                    ? "text-admin-primary"
                                    : "text-slate-600 hover:text-slate-400"
                                }`}
                              >
                                {isOpen ? "expand_more" : "chevron_right"}
                              </span>
                            </button>
                            <div>
                              <div className="text-sm font-bold text-white">
                                {row.supplierName}
                              </div>
                              {row.supplierPhone && (
                                <div className="text-[10px] text-slate-500 tabular-nums">
                                  {row.supplierPhone}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
                            {t("table.bookingCount", { count: row.items.length })}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right font-bold tabular-nums text-white">
                          {row.totalVndText}
                        </td>
                        <td className="py-4 px-6 text-right tabular-nums whitespace-nowrap">
                          {row.marginVndText ? (
                            <span
                              className={
                                row.marginVndText.startsWith("-")
                                  ? "font-bold text-red-400"
                                  : "font-bold text-emerald-400"
                              }
                            >
                              {row.marginVndText}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">{statusBadge(row.status)}</td>
                        <td className="py-4 px-6 text-right">{actionCell(row)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-900/20 border-b border-slate-800/50">
                          <td className="p-0" colSpan={6}>
                            <div className="px-16 py-4">{detailGrid(row)}</div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 모바일(<768px): 카드 스택 */}
          <div className="md:hidden flex flex-col gap-3">
            {rows.map((row) => {
              const isOpen = expanded.has(row.id);
              return (
                <div
                  key={row.id}
                  className="bg-admin-card border border-slate-800 rounded-xl p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">
                        {row.supplierName}
                      </div>
                      {row.supplierPhone && (
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          {row.supplierPhone}
                        </div>
                      )}
                    </div>
                    {statusBadge(row.status)}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400 whitespace-nowrap">
                      {t("table.bookingCount", { count: row.items.length })}
                    </span>
                    <span className="font-bold tabular-nums text-white">{row.totalVndText}</span>
                  </div>
                  {row.marginVndText && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 whitespace-nowrap">{t("table.colMargin")}</span>
                      <span
                        className={`font-bold tabular-nums ${
                          row.marginVndText.startsWith("-") ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {row.marginVndText}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(row.id)}
                    className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200 transition-colors w-fit"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {isOpen ? "expand_less" : "expand_more"}
                    </span>
                    <span>{isOpen ? t("table.collapse") : t("table.expand")}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-800 pt-3">{detailGrid(row)}</div>
                  )}
                  <div className="flex justify-end">{actionCell(row)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 푸터 안내 (b7) — 지급 수단 고지 */}
      <footer className="mt-8 flex items-center gap-2 text-slate-500 border-t border-slate-800 pt-6">
        <span className="material-symbols-outlined text-sm">info</span>
        <p className="text-[12px] font-medium whitespace-nowrap">{t("footerNote")}</p>
      </footer>
    </div>
  );
}

// 운영자 손익 셀 (정산 고도화) — 라벨 + 값 + 보조설명. ADMIN 전용 패널 내부.
function FinanceCell({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 flex flex-col gap-1">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
        {label}
      </span>
      <div className="leading-tight">{children}</div>
      {sub && <span className="text-[10px] text-slate-600 leading-tight">{sub}</span>}
    </div>
  );
}

// b7 요약 카드 — KRW/VND 매출(통화 칩), 지급 대상 공급자, 총 지급액
function SummaryCard({
  icon,
  chip,
  label,
  value,
  sub,
}: {
  icon: string;
  chip: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-admin-card p-5 rounded-2xl border border-slate-800 shadow-lg min-w-[200px] flex-1 xl:flex-none hover:border-blue-500/50 transition-all">
      <div className="flex justify-between items-start mb-3">
        <div className="p-2 bg-blue-500/10 rounded-lg">
          <span className="material-symbols-outlined text-blue-500">{icon}</span>
        </div>
        <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">
          {chip}
        </span>
      </div>
      <p className="text-slate-400 text-xs font-medium mb-1">{label}</p>
      <p className="text-2xl font-black text-white tabular-nums text-right whitespace-nowrap">
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-500 mt-1 text-right">{sub}</p>}
    </div>
  );
}
