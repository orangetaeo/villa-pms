"use client";

// 부가서비스 정산·중계 허브 (다크 운영자 테마). /api/service-orders 로드(클라 fetch — 정산 후 즉시 재조회).
//   탭: 정산(공급자별 묶음 입금) | 중계현황(전 발주 상태 조회·예약 딥링크).
//   ★ 누수 경계: 이 화면은 canViewFinance 전용. costVnd(공급자 지급액)는 표시하되, 우리 판매가·마진은
//      API가 애초에 내려주지 않는다(원칙2). 표기 통화는 VND 단일(공급자 지급 통화).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import ListSearch from "@/components/list-search";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatVnd } from "@/lib/format";

type VendorStatus = "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;
type SettleMethod = "CASH" | "BANK_TRANSFER" | "OTHER";

type Order = {
  id: string;
  bookingId: string;
  villaName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  itemName: string | null;
  optionLabel: string | null;
  type: string | null;
  quantity: number;
  guestCount: number | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  vendorBankInfo: unknown;
  vendorStatus: VendorStatus;
  status: string;
  costVnd: string;
  vendorSettledAt: string | null;
  vendorSettleMethod: SettleMethod | null;
  vendorSettleNote: string | null;
  poSentAt: string | null;
  vendorRespondedAt: string | null;
  createdAt: string;
};

type T = ReturnType<typeof useTranslations<"adminServiceOrders">>;

/** BigInt 문자열 합산 (Number 금지 — 정밀도 손실 방지) */
function sumVnd(values: string[]): string {
  return values.reduce((acc, v) => acc + BigInt(v || "0"), 0n).toString();
}

/** ISO 날짜 → "dd/MM" (serviceDate/checkIn @db.Date UTC 자정) */
function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** ISO(UTC) → "dd/MM/yyyy" — 정산일 등 전체 날짜 */
function fullDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
function scheduleLabel(o: Order): string {
  if (o.serviceDate) return o.serviceTime ? `${dayMonth(o.serviceDate)} ${o.serviceTime}` : dayMonth(o.serviceDate);
  if (o.checkIn && o.checkOut) return `${dayMonth(o.checkIn)} - ${dayMonth(o.checkOut)}`;
  if (o.checkIn) return dayMonth(o.checkIn);
  return "—";
}

/** 정산 계좌(bankInfo Json) → 한 줄 표기. 객체({bank,account,holder}) 또는 문자열 방어적 처리. */
function bankLine(info: unknown): string | null {
  if (!info) return null;
  if (typeof info === "string") return info.trim() || null;
  if (typeof info === "object") {
    const o = info as Record<string, unknown>;
    const parts = [o.bank, o.account, o.holder, o.accountNumber, o.name]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

function usePaged<X>(items: X[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  return {
    paged,
    page: safePage,
    pageSize,
    setPage,
    setPageSize: (s: number) => {
      setPageSize(s);
      setPage(1);
    },
  };
}

export default function ServiceOrdersView() {
  const t = useTranslations("adminServiceOrders");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"settle" | "status">("settle");

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/service-orders", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { orders: Order[] };
      setOrders(data.orders);
    } catch {
      setError(true);
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = orders ?? [];
  // 정산 대상 = 공급자 수락 + 미취소. 그중 미정산/정산완료로 분리.
  const settleable = all.filter((o) => o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED");
  const unsettled = settleable.filter((o) => !o.vendorSettledAt);
  const settled = settleable.filter((o) => o.vendorSettledAt);

  const loading = orders === null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("hub.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("hub.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white active:scale-95"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          {t("hub.reload")}
        </button>
      </header>

      {/* 탭 — 정산 | 중계현황 */}
      <div className="flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {(["settle", "status"] as const).map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
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

      {error && (
        <button
          type="button"
          onClick={() => void load()}
          className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 active:scale-[0.99]"
        >
          {t("hub.loadError")}
        </button>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-slate-500">…</p>
      ) : tab === "settle" ? (
        <SettleTab unsettled={unsettled} settled={settled} t={t} onDone={load} />
      ) : (
        <StatusTab orders={all} t={t} />
      )}
    </div>
  );
}

// ── 정산 탭 — 입금 대기(공급자별 묶음) | 입금 완료 ──────────────────────
function SettleTab({
  unsettled,
  settled,
  t,
  onDone,
}: {
  unsettled: Order[];
  settled: Order[];
  t: T;
  onDone: () => Promise<void>;
}) {
  const [sub, setSub] = useState<"pending" | "paid">(
    unsettled.length === 0 && settled.length > 0 ? "paid" : "pending"
  );
  // 선택 상태(입금 처리 대상 orderId) — 로드/변경 시 미정산 전건을 기본 선택.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(unsettled.map((o) => o.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsettled.map((o) => o.id).join(",")]);

  const [settleTarget, setSettleTarget] = useState<{
    vendorName: string;
    orderIds: string[];
    total: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // 검색어 — 빌라·품목·공급자 부분일치(입금대기·입금완료 공통). 합계 카드는 전체 기준 유지.
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const matchOrder = (o: Order) =>
    !q || [o.villaName, o.itemName, o.vendorName].some((f) => f?.toLowerCase().includes(q));

  // 합계 카드는 검색과 무관하게 전체 기준(미정산·완료 총액).
  const pendingTotal = sumVnd(unsettled.map((o) => o.costVnd));
  const paidTotal = sumVnd(settled.map((o) => o.costVnd));

  const filteredUnsettled = unsettled.filter(matchOrder);

  // 공급자별 그룹(미정산, 검색 반영) — vendorId 기준.
  const groups = useMemo(() => {
    const m = new Map<string, { vendorName: string; phone: string | null; bank: string | null; orders: Order[] }>();
    for (const o of filteredUnsettled) {
      const key = o.vendorId ?? "—";
      if (!m.has(key)) {
        m.set(key, {
          vendorName: o.vendorName ?? "—",
          phone: o.vendorPhone,
          bank: bankLine(o.vendorBankInfo),
          orders: [],
        });
      }
      m.get(key)!.orders.push(o);
    }
    return Array.from(m.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsettled, q]);

  // 공급자 그룹 페이지네이션(입금 대기) — 공급자가 많아도 한 페이지만 렌더.
  const groupsPage = usePaged(groups);

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
    try {
      await fetch("/api/service-orders/settle-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: settleTarget.orderIds, vendorSettleMethod: method, vendorSettleNote: note || null }),
      });
      setSettleTarget(null);
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  // 입금 완료(검색 반영, 최근 정산순).
  const filteredSettled = settled
    .filter(matchOrder)
    .sort((a, b) => (b.vendorSettledAt ?? "").localeCompare(a.vendorSettledAt ?? ""));
  const paidPage = usePaged(filteredSettled);

  return (
    <div className="space-y-5">
      {/* 합계 카드 — 미정산·정산완료 나란히 (VND 단일) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            {t("hub.summary.unsettledTotal")}
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-white">{formatVnd(pendingTotal)}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {t("hub.summary.vendorCount")}: {groups.length}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {t("hub.summary.paidTotal")}
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-white">{formatVnd(paidTotal)}</p>
          <p className="mt-0.5 text-xs text-slate-400">{settled.length}</p>
        </div>
      </div>

      {/* 서브 필터 — 입금 대기 | 입금 완료 */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-800/60 p-1">
        {(["pending", "paid"] as const).map((key) => {
          const active = sub === key;
          const count = key === "pending" ? unsettled.length : settled.length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSub(key)}
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

      <ListSearch value={search} onChange={setSearch} placeholder={t("hub.searchPlaceholder")} />

      {sub === "pending" ? (
        groups.length === 0 ? (
          <Empty icon="payments" text={q ? t("hub.emptySearch") : t("hub.emptyPending")} />
        ) : (
          <div className="space-y-4">
            {groupsPage.paged.map((grp) => {
              const selIds = grp.orders.filter((o) => selected.has(o.id)).map((o) => o.id);
              const selTotal = sumVnd(grp.orders.filter((o) => selected.has(o.id)).map((o) => o.costVnd));
              return (
                <section key={grp.vendorName} className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-4">
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
                        onClick={() =>
                          setSettleTarget({ vendorName: grp.vendorName, orderIds: selIds, total: selTotal })
                        }
                        className="mt-1 rounded-lg bg-admin-primary px-3 py-1.5 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
                      >
                        {t("hub.settleSelected", { n: selIds.length })}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {grp.orders.map((o) => {
                      const checked = selected.has(o.id);
                      return (
                        <label
                          key={o.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2.5 transition hover:border-slate-600"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
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
                      );
                    })}
                  </div>
                </section>
              );
            })}
            <PaginationBar
              total={groups.length}
              page={groupsPage.page}
              pageSize={groupsPage.pageSize}
              onPageChange={groupsPage.setPage}
              onPageSizeChange={groupsPage.setPageSize}
            />
          </div>
        )
      ) : filteredSettled.length === 0 ? (
        <Empty icon="task_alt" text={q ? t("hub.emptySearch") : t("hub.emptyPaid")} />
      ) : (
        <div className="space-y-2">
          {paidPage.paged.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-emerald-500 bg-slate-900/40 p-3"
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
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {o.vendorSettleMethod ? t(`hub.method.${o.vendorSettleMethod}`) : ""}
                  {o.vendorSettledAt ? `${o.vendorSettleMethod ? " · " : ""}${fullDate(o.vendorSettledAt)}` : ""}
                  {o.vendorSettleNote ? ` · ${o.vendorSettleNote}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">{formatVnd(o.costVnd)}</p>
            </div>
          ))}
          <PaginationBar
            total={filteredSettled.length}
            page={paidPage.page}
            pageSize={paidPage.pageSize}
            onPageChange={paidPage.setPage}
            onPageSizeChange={paidPage.setPageSize}
          />
        </div>
      )}

      {settleTarget && (
        <SettleModal
          target={settleTarget}
          busy={busy}
          t={t}
          onCancel={() => setSettleTarget(null)}
          onConfirm={submitSettle}
        />
      )}
    </div>
  );
}

// ── 중계현황 탭 — 전 발주 상태 조회 + 예약 딥링크 ──────────────────────
function StatusTab({ orders, t }: { orders: Order[]; t: T }) {
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "rejected" | "cancelled">("all");
  const [search, setSearch] = useState("");

  const matchFilter = (o: Order): boolean => {
    switch (filter) {
      case "pending":
        return o.vendorStatus === "PENDING_VENDOR" && o.status !== "CANCELLED";
      case "accepted":
        return o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED";
      case "rejected":
        return o.vendorStatus === "VENDOR_REJECTED";
      case "cancelled":
        return o.status === "CANCELLED";
      default:
        return true;
    }
  };
  const q = search.trim().toLowerCase();
  const filtered = orders.filter(
    (o) =>
      matchFilter(o) &&
      (!q || [o.villaName, o.itemName, o.vendorName].some((f) => f?.toLowerCase().includes(q)))
  );
  const page = usePaged(filtered);

  const filters = ["all", "pending", "accepted", "rejected", "cancelled"] as const;
  // 필터별 건수 — filter state와 무관한 순수 조건 판정.
  const inBucket = (o: Order, f: (typeof filters)[number]): boolean => {
    switch (f) {
      case "pending":
        return o.vendorStatus === "PENDING_VENDOR" && o.status !== "CANCELLED";
      case "accepted":
        return o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED";
      case "rejected":
        return o.vendorStatus === "VENDOR_REJECTED";
      case "cancelled":
        return o.status === "CANCELLED";
      default:
        return true;
    }
  };
  const countOf = (f: (typeof filters)[number]) =>
    f === "all" ? orders.length : orders.filter((o) => inBucket(o, f)).length;

  return (
    <div className="space-y-4">
      {/* 필터 칩 */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                active
                  ? "rounded-full bg-admin-primary px-3 py-1.5 text-xs font-bold text-white"
                  : "rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
              }
            >
              {t(`hub.filter.${f}`)}
              <span className="ml-1 opacity-70">{countOf(f)}</span>
            </button>
          );
        })}
      </div>

      <ListSearch value={search} onChange={setSearch} placeholder={t("hub.searchPlaceholder")} />

      {filtered.length === 0 ? (
        <Empty icon="inbox" text={t("hub.emptyStatus")} />
      ) : (
        <div className="space-y-2">
          {page.paged.map((o) => (
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
                  {o.vendorStatus === "VENDOR_ACCEPTED" && o.status !== "CANCELLED" && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        o.vendorSettledAt
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
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
          <PaginationBar
            total={filtered.length}
            page={page.page}
            pageSize={page.pageSize}
            onPageChange={page.setPage}
            onPageSizeChange={page.setPageSize}
          />
        </div>
      )}
    </div>
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

// ── 입금 처리 모달 ────────────────────────────────────────────────────
function SettleModal({
  target,
  busy,
  t,
  onCancel,
  onConfirm,
}: {
  target: { vendorName: string; orderIds: string[]; total: string };
  busy: boolean;
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
