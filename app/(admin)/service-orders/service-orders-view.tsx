"use client";

// 부가서비스 정산·중계 허브 (다크 운영자 테마).
//   ★성능: 발주가 수천 건이라 서버 사이드 필터·페이지네이션. 뷰/필터/페이지 변경 시 /api/service-orders를
//     페이지 단위로 조회(한 번에 10건). 첫 화면은 SSR이 준 기본 뷰(입금 대기) 1페이지로 즉시 렌더.
//   탭: 정산(공급자별 묶음 입금) | 중계현황(전 발주 상태 조회·예약 딥링크).
//   ★ 누수 경계: canViewFinance 전용. costVnd(공급자 지급액)만, 판매가·마진은 API가 미반환(원칙2).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import PaginationBar from "@/components/pagination-bar";
import { formatVnd } from "@/lib/format";
import type {
  HubOrder,
  HubOptions,
  HubResult,
  HubSummary,
} from "@/lib/service-orders-hub";

type SettleMethod = "CASH" | "BANK_TRANSFER" | "OTHER";
type Order = HubOrder;
type T = ReturnType<typeof useTranslations<"adminServiceOrders">>;

type Filters = {
  range: string;
  itemId: string;
  vendorId: string;
  partnerId: string;
  villaId: string;
  guest: string;
};
const EMPTY_FILTERS: Filters = { range: "all", itemId: "", vendorId: "", partnerId: "", villaId: "", guest: "" };
const RANGE_KEYS = ["all", "yesterday", "today", "tomorrow", "thisWeek", "lastWeek", "thisMonth", "lastMonth"] as const;

/** BigInt 문자열 합산(현재 페이지 그룹 합계용) */
function sumVnd(values: string[]): string {
  return values.reduce((acc, v) => acc + BigInt(v || "0"), 0n).toString();
}
function dayMonth(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function fullDate(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
function scheduleLabel(o: Order): string {
  if (o.serviceDate) return o.serviceTime ? `${dayMonth(o.serviceDate)} ${o.serviceTime}` : dayMonth(o.serviceDate);
  if (o.checkIn && o.checkOut) return `${dayMonth(o.checkIn)} - ${dayMonth(o.checkOut)}`;
  if (o.checkIn) return dayMonth(o.checkIn);
  return "—";
}
function bankLine(info: unknown): string | null {
  if (!info) return null;
  if (typeof info === "string") return info.trim() || null;
  if (typeof info === "object") {
    const o = info as Record<string, unknown>;
    const parts = [o.bank, o.account, o.holder, o.accountNumber, o.name].filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

type VendorGroup = { id: string; vendorName: string; phone: string | null; bank: string | null; orders: Order[] };
/** 현재 페이지 rows → 공급자별 그룹(vendorId 기준, 공급자명 오름차순). id=vendorId(React key·동명 충돌 방지). */
function groupOrdersByVendor(list: Order[]): VendorGroup[] {
  const m = new Map<string, VendorGroup>();
  for (const o of list) {
    const key = o.vendorId ?? "—";
    if (!m.has(key)) {
      m.set(key, { id: key, vendorName: o.vendorName ?? "—", phone: o.vendorPhone, bank: bankLine(o.vendorBankInfo), orders: [] });
    }
    m.get(key)!.orders.push(o);
  }
  return Array.from(m.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
}

export default function ServiceOrdersView({
  initial,
  options,
  pageSize: initialPageSize,
}: {
  initial: HubResult;
  options: HubOptions;
  pageSize: number;
}) {
  const t = useTranslations("adminServiceOrders");

  const [tab, setTab] = useState<"settle" | "status">("settle");
  const [settleSub, setSettleSub] = useState<"pending" | "paid">("pending");
  const [statusChip, setStatusChip] = useState<
    "all" | "pending" | "accepted" | "proposal" | "rejected" | "cancelled"
  >("all");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [guestInput, setGuestInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [data, setData] = useState<HubResult>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const view: "pending" | "paid" | "status" = tab === "settle" ? settleSub : "status";

  // 고객명 입력 디바운스(300ms) → filters.guest. 값이 실제로 바뀔 때만 반영(불필요 재조회 방지).
  useEffect(() => {
    const tmr = setTimeout(() => {
      setFilters((f) => (f.guest === guestInput ? f : { ...f, guest: guestInput }));
      if (guestInput) setPage(1);
    }, 300);
    return () => clearTimeout(tmr);
  }, [guestInput]);

  // 뷰/필터/페이지 변경 시 서버 조회. 첫 렌더는 SSR initial 사용(마운트 스킵). 경쟁 응답은 최신 id만 반영.
  const mounted = useRef(false);
  const reqId = useRef(0);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const qs = new URLSearchParams();
    qs.set("view", view);
    if (view === "status") qs.set("status", statusChip);
    if (filters.range !== "all") qs.set("range", filters.range);
    if (filters.itemId) qs.set("itemId", filters.itemId);
    if (filters.vendorId) qs.set("vendorId", filters.vendorId);
    if (filters.partnerId) qs.set("partnerId", filters.partnerId);
    if (filters.villaId) qs.set("villaId", filters.villaId);
    if (filters.guest.trim()) qs.set("guest", filters.guest.trim());
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    const id = ++reqId.current;
    setLoading(true);
    fetch(`/api/service-orders?${qs.toString()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json() as Promise<HubResult>;
      })
      .then((json) => {
        if (id === reqId.current) {
          setData(json);
          setError(false);
        }
      })
      .catch(() => {
        if (id === reqId.current) setError(true);
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [view, statusChip, filters, page, pageSize, refreshKey]);

  const changeFilters = useCallback((f: Filters) => {
    setFilters(f);
    setPage(1);
  }, []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("hub.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("hub.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white active:scale-95"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          {t("hub.reload")}
        </button>
      </header>

      {/* 합계 카드 — 전역 대기·완료(필터 무관) */}
      {/* 코치마크 앵커 */}
      <div data-tour="sorders-summary" className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            {t("hub.summary.unsettledTotal")}
            <span className="text-[10px] font-normal text-slate-400">({t("hub.summary.allBasis")})</span>
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-white">{formatVnd(data.summary.pendingVnd)}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {t("hub.summary.vendorCount")}: {data.summary.unsettledCount}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {t("hub.summary.paidTotal")}
            <span className="text-[10px] font-normal text-slate-400">({t("hub.summary.allBasis")})</span>
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-white">{formatVnd(data.summary.paidVnd)}</p>
          <p className="mt-0.5 text-xs text-slate-400">{data.summary.settledCount}</p>
        </div>
      </div>

      {/* 제안 현황 칩(ADR-0035) — 전역 스냅샷(필터 무관): 미해결 제안·고객 거절. 있을 때만. */}
      {(data.summary.proposalPendingCount > 0 || data.summary.declinedCount > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {data.summary.proposalPendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">
              <span className="material-symbols-outlined text-sm">hourglass_top</span>
              {t("hub.proposalActive", { n: data.summary.proposalPendingCount })}
            </span>
          )}
          {data.summary.declinedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-300">
              <span className="material-symbols-outlined text-sm">cancel</span>
              {t("hub.declinedChip", { n: data.summary.declinedCount })}
            </span>
          )}
          <span className="text-[10px] font-normal text-slate-500">({t("hub.summary.allBasis")})</span>
        </div>
      )}

      {/* 탭 — 정산 | 중계현황 */}
      {/* 코치마크 앵커 */}
      <div data-tour="sorders-tabs" className="flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {(["settle", "status"] as const).map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex-1 rounded-lg bg-admin-primary py-2 text-center text-sm font-bold text-white shadow"
                  : "flex-1 rounded-lg py-2 text-center text-sm font-medium text-slate-400 hover:text-white"
              }
            >
              {t(`hub.tab.${key}`)}
            </button>
          );
        })}
      </div>

      <FilterBar
        options={options}
        filters={filters}
        guestValue={guestInput}
        onChange={changeFilters}
        onGuestChange={setGuestInput}
        t={t}
      />

      {tab === "settle" && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-800/60 p-1">
          {(["pending", "paid"] as const).map((key) => {
            const active = settleSub === key;
            const count = key === "pending" ? data.summary.unsettledCount : data.summary.settledCount;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSettleSub(key);
                  setPage(1);
                }}
                className={
                  active
                    ? "rounded-lg bg-slate-700 py-2 text-center text-sm font-bold text-white"
                    : "rounded-lg py-2 text-center text-sm font-medium text-slate-400 hover:text-white"
                }
              >
                {t(`hub.sub.${key}`)}
                <span
                  className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                    active
                      ? key === "pending"
                        ? "bg-amber-500/30 text-amber-200"
                        : "bg-emerald-500/30 text-emerald-200"
                      : "bg-slate-700 text-slate-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {tab === "status" && (
        <div className="flex flex-wrap gap-2">
          {(["all", "pending", "accepted", "proposal", "rejected", "cancelled"] as const).map((f) => {
            const active = statusChip === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setStatusChip(f);
                  setPage(1);
                }}
                className={
                  active
                    ? "rounded-full bg-admin-primary px-3 py-1.5 text-xs font-bold text-white"
                    : "rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
                }
              >
                {t(`hub.filter.${f}`)}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <button
          type="button"
          onClick={refresh}
          className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 active:scale-[0.99]"
        >
          {t("hub.loadError")}
        </button>
      )}

      <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {tab === "settle" && settleSub === "pending" ? (
          <PendingList rows={data.rows} total={data.total} page={page} pageSize={pageSize} loading={loading} t={t} onSettled={refresh} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
        ) : tab === "settle" ? (
          <PaidList rows={data.rows} total={data.total} page={page} pageSize={pageSize} loading={loading} t={t} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
        ) : (
          <StatusList rows={data.rows} total={data.total} page={page} pageSize={pageSize} loading={loading} t={t} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
        )}
      </div>
    </div>
  );
}

// ── 입금 대기(공급자별 묶음, 현재 페이지 rows를 그룹핑) ──────────────────
function PendingList({
  rows,
  total,
  page,
  pageSize,
  loading,
  t,
  onSettled,
  onPage,
  onPageSize,
}: {
  rows: Order[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  t: T;
  onSettled: () => void;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 페이지 rows가 바뀌면 해당 페이지 전건 기본 선택.
  useEffect(() => {
    setSelected(new Set(rows.map((o) => o.id)));
  }, [rows]);
  const [settleTarget, setSettleTarget] = useState<{ vendorName: string; orderIds: string[]; total: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  const groups = useMemo(() => groupOrdersByVendor(rows), [rows]);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submitSettle = async (method: SettleMethod, note: string) => {
    if (!settleTarget) return;
    setBusy(true);
    setSettleError(null);
    try {
      const res = await fetch("/api/service-orders/settle-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: settleTarget.orderIds, vendorSettleMethod: method, vendorSettleNote: note || null }),
      });
      if (!res.ok) {
        setSettleError(t("hub.modal.error"));
        return;
      }
      // settled=0 → 대상이 이미 정산됐거나 상태가 바뀜(stale). 성공으로 오인 방지.
      const json = (await res.json().catch(() => ({ settled: 0 }))) as { settled?: number };
      if (!json.settled) {
        setSettleError(t("hub.modal.noneSettled"));
        onSettled(); // 최신 상태로 갱신(이미 처리됐을 수 있음)
        return;
      }
      setSettleTarget(null);
      onSettled();
    } catch {
      setSettleError(t("hub.modal.error"));
    } finally {
      setBusy(false);
    }
  };

  if (!loading && rows.length === 0) {
    return <Empty icon="payments" text={t("hub.emptyPending")} />;
  }
  return (
    <div className="space-y-4">
      {groups.map((grp) => {
        const selIds = grp.orders.filter((o) => selected.has(o.id)).map((o) => o.id);
        const selTotal = sumVnd(grp.orders.filter((o) => selected.has(o.id)).map((o) => o.costVnd));
        return (
          <section key={grp.id} className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-base font-bold text-white">
                  <span className="material-symbols-outlined text-base text-slate-400">storefront</span>
                  {grp.vendorName}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {grp.phone ? `${grp.phone} · ` : ""}
                  {t("hub.vendorOrders", { n: grp.orders.length })}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <span className="material-symbols-outlined align-middle text-sm">account_balance</span>{" "}
                  {grp.bank ?? t("hub.noBank")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-extrabold text-white">{formatVnd(sumVnd(grp.orders.map((o) => o.costVnd)))}</p>
                <button
                  type="button"
                  disabled={selIds.length === 0}
                  onClick={() => setSettleTarget({ vendorName: grp.vendorName, orderIds: selIds, total: selTotal })}
                  className="mt-1 rounded-lg bg-admin-primary px-3 py-1.5 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
                >
                  {t("hub.settleSelected", { n: selIds.length })}
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {grp.orders.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2.5 transition hover:border-slate-600"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    className="h-4 w-4 shrink-0 accent-admin-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {o.itemName ?? "—"}
                      <span className="ml-1.5 text-xs font-medium text-slate-400">×{o.quantity}</span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {o.villaName ? `${o.villaName} · ` : ""}
                      {scheduleLabel(o)}
                      {o.optionLabel ? ` · ${o.optionLabel}` : ""}
                    </p>
                    {/* 이행 완료 보고(vendorCompletedAt) — 입금 전 이행 여부 확인용 배지 */}
                    {o.vendorCompletedAt && <CompletedBadge at={o.vendorCompletedAt} t={t} />}
                  </div>
                  <Link
                    href={`/bookings/${o.bookingId}`}
                    className="shrink-0 text-slate-500 transition hover:text-admin-primary"
                    title={t("hub.viewBooking")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                  </Link>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-slate-200">{formatVnd(o.costVnd)}</p>
                </label>
              ))}
            </div>
          </section>
        );
      })}
      <PaginationBar total={total} page={page} pageSize={pageSize} onPageChange={onPage} onPageSizeChange={onPageSize} />

      {settleTarget && (
        <SettleModal
          target={settleTarget}
          busy={busy}
          error={settleError}
          t={t}
          onCancel={() => {
            setSettleTarget(null);
            setSettleError(null);
          }}
          onConfirm={submitSettle}
        />
      )}
    </div>
  );
}

// ── 입금 완료 ──────────────────────────────────────────────────────
function PaidList({
  rows,
  total,
  page,
  pageSize,
  loading,
  t,
  onPage,
  onPageSize,
}: {
  rows: Order[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  t: T;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  if (!loading && rows.length === 0) {
    return <Empty icon="task_alt" text={t("hub.emptyPaid")} />;
  }
  return (
    <div className="space-y-2">
      {rows.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-emerald-500 bg-slate-900/40 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">
              {o.itemName ?? "—"}
              <span className="ml-1.5 text-xs font-medium text-slate-400">×{o.quantity}</span>
            </p>
            <p className="truncate text-xs text-slate-500">
              {o.vendorName ? `${o.vendorName} · ` : ""}
              {o.villaName ? `${o.villaName} · ` : ""}
              {scheduleLabel(o)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {o.vendorSettleMethod ? t(`hub.method.${o.vendorSettleMethod}`) : ""}
              {o.vendorSettledAt ? `${o.vendorSettleMethod ? " · " : ""}${fullDate(o.vendorSettledAt)}` : ""}
              {o.vendorSettleNote ? ` · ${o.vendorSettleNote}` : ""}
            </p>
          </div>
          <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">{formatVnd(o.costVnd)}</p>
        </div>
      ))}
      <PaginationBar total={total} page={page} pageSize={pageSize} onPageChange={onPage} onPageSizeChange={onPageSize} />
    </div>
  );
}

// ── 중계현황 ────────────────────────────────────────────────────────
function StatusList({
  rows,
  total,
  page,
  pageSize,
  loading,
  t,
  onPage,
  onPageSize,
}: {
  rows: Order[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  t: T;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  if (!loading && rows.length === 0) {
    return <Empty icon="inbox" text={t("hub.emptyStatus")} />;
  }
  return (
    <div className="space-y-2">
      {rows.map((o) => (
        <Link
          key={o.id}
          href={`/bookings/${o.bookingId}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 transition hover:border-admin-primary/60"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">
              {o.itemName ?? "—"}
              <span className="ml-1.5 text-xs font-medium text-slate-400">×{o.quantity}</span>
            </p>
            <p className="truncate text-xs text-slate-500">
              {o.vendorName ? `${o.vendorName} · ` : ""}
              {o.villaName ? `${o.villaName} · ` : ""}
              {scheduleLabel(o)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <VendorStatusBadge order={o} t={t} />
              {/* 미해결 시간 제안 — 운영자 적용/무시 또는 고객 응답 대기(고객확정이 막혀 있는 건) */}
              {o.proposalPending && o.status !== "CANCELLED" && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  {t("hub.proposalBadge")}
                </span>
              )}
              {/* 고객 거절(DECLINED) — 아직 재응답 전(PENDING_VENDOR)일 때만 경고 뱃지(ADR-0035).
                  공급자가 원래 시간으로 재수락해 CONFIRMED가 되면 미표시(outcome은 통계에 계상되나 UI 경고는 미해소만). */}
              {o.vendorProposalOutcome === "DECLINED" &&
                o.vendorStatus === "PENDING_VENDOR" &&
                o.status !== "CANCELLED" && (
                  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                    {t("hub.declinedBadge")}
                  </span>
                )}
              {/* 이행 완료 보고(vendorCompletedAt) */}
              {o.vendorCompletedAt && <CompletedBadge at={o.vendorCompletedAt} t={t} />}
              {o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED" && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    o.vendorSettledAt ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  {o.vendorSettledAt ? t("hub.settled") : t("hub.unsettledBadge")}
                </span>
              )}
            </div>
          </div>
          <p className="shrink-0 text-sm font-bold tabular-nums text-slate-200">{formatVnd(o.costVnd)}</p>
        </Link>
      ))}
      <PaginationBar total={total} page={page} pageSize={pageSize} onPageChange={onPage} onPageSizeChange={onPageSize} />
    </div>
  );
}

// 공급자 이행 완료 보고 배지 — "이행 완료 dd/MM" (emerald 계열, 정산·중계 목록 공용)
function CompletedBadge({ at, t }: { at: string; t: T }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
      <span className="material-symbols-outlined text-[12px]">task_alt</span>
      {t("hub.completedBadge", { date: dayMonth(at) })}
    </span>
  );
}

function VendorStatusBadge({ order, t }: { order: Order; t: T }) {
  if (order.status === "CANCELLED") {
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-300">{t("hub.vstatus.CANCELLED")}</span>;
  }
  const map: Record<string, string> = {
    PENDING_VENDOR: "bg-blue-500/20 text-blue-300",
    VENDOR_ACCEPTED: "bg-teal-500/20 text-teal-300",
    VENDOR_REJECTED: "bg-slate-600/40 text-slate-300",
  };
  const key = order.vendorStatus ?? "PENDING_VENDOR";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${map[key] ?? "bg-slate-700 text-slate-300"}`}>{t(`hub.vstatus.${key}`)}</span>;
}

// ── 필터 바 (셀렉터는 id 값, 라벨은 서버 옵션) ──────────────────────────
function FilterBar({
  options,
  filters,
  guestValue,
  onChange,
  onGuestChange,
  t,
}: {
  options: HubOptions;
  filters: Filters;
  guestValue: string;
  onChange: (f: Filters) => void;
  onGuestChange: (v: string) => void;
  t: T;
}) {
  const tq = useTranslations("quickDateFilter");
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const selectCls =
    "min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-slate-200 outline-none focus:border-admin-primary";
  return (
    <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {RANGE_KEYS.map((k) => {
          const active = filters.range === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => set({ range: k })}
              className={
                active
                  ? "whitespace-nowrap rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-bold text-white"
                  : "whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
              }
            >
              {tq(k)}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <select aria-label={t("hub.filters.item")} value={filters.itemId} onChange={(e) => set({ itemId: e.target.value })} className={selectCls}>
          <option value="">{t("hub.filters.item")}</option>
          {options.items.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select aria-label={t("hub.filters.vendor")} value={filters.vendorId} onChange={(e) => set({ vendorId: e.target.value })} className={selectCls}>
          <option value="">{t("hub.filters.vendor")}</option>
          {options.vendors.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select aria-label={t("hub.filters.partner")} value={filters.partnerId} onChange={(e) => set({ partnerId: e.target.value })} className={selectCls}>
          <option value="">{t("hub.filters.partner")}</option>
          {options.partners.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select aria-label={t("hub.filters.villa")} value={filters.villaId} onChange={(e) => set({ villaId: e.target.value })} className={selectCls}>
          <option value="">{t("hub.filters.villa")}</option>
          {options.villas.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="search"
          value={guestValue}
          onChange={(e) => onGuestChange(e.target.value)}
          placeholder={t("hub.filters.guestPlaceholder")}
          className={selectCls}
        />
      </div>
    </div>
  );
}

// ── 입금 처리 모달 ────────────────────────────────────────────────────
function SettleModal({
  target,
  busy,
  error,
  t,
  onCancel,
  onConfirm,
}: {
  target: { vendorName: string; orderIds: string[]; total: string };
  busy: boolean;
  error?: string | null;
  t: T;
  onCancel: () => void;
  onConfirm: (method: SettleMethod, note: string) => void;
}) {
  const [method, setMethod] = useState<SettleMethod>("BANK_TRANSFER");
  const [note, setNote] = useState("");
  const methods: SettleMethod[] = ["BANK_TRANSFER", "CASH", "OTHER"];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div>
          <h3 className="text-lg font-bold text-white">{t("hub.modal.title")}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {t("hub.modal.desc", { vendor: target.vendorName, n: target.orderIds.length, total: formatVnd(target.total) })}
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-400">{t("hub.modal.method")}</p>
          <div className="grid grid-cols-3 gap-2">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={
                  method === m
                    ? "rounded-lg bg-admin-primary py-2 text-sm font-bold text-white"
                    : "rounded-lg border border-slate-700 bg-slate-800/60 py-2 text-sm font-medium text-slate-300 hover:text-white"
                }
              >
                {t(`hub.method.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-400">{t("hub.modal.note")}</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t("hub.modal.notePlaceholder")}
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-admin-primary"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-700 bg-slate-800/60 py-3 text-sm font-bold text-slate-300 hover:text-white disabled:opacity-50"
          >
            {t("hub.modal.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || target.orderIds.length === 0}
            onClick={() => onConfirm(method, note.trim())}
            className="rounded-lg bg-admin-primary py-3 text-sm font-bold text-white active:scale-95 disabled:opacity-50"
          >
            {busy ? t("hub.modal.submitting") : t("hub.modal.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-12 text-center">
      <span className="material-symbols-outlined text-4xl text-slate-600">{icon}</span>
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}
