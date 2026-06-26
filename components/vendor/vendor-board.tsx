"use client";

// 원천 공급자 발주함 보드 (ADR-0023 S3 §6) — 발주함 | 예약현황 | 정산내역.
//   GET /api/vendor/orders 로드(클라 fetch — 수락/거절 후 즉시 재조회 필요).
//   ★ 누수: API가 costVnd(자기 지급액)만 내려줌. 판매가·마진·타 공급자 발주 없음.
//      추가 데이터 호출 금지 — 이 컴포넌트는 /api/vendor/orders shape만 사용.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type VendorStatus = "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;

type VendorOrder = {
  id: string;
  villaName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  itemName: string | null;
  optionLabel: string | null; // 선택 코스/옵션(가격 제거) — "오일 마사지 90분" 등
  type: string | null;
  quantity: number;
  vendorStatus: VendorStatus;
  status: string;
  costVnd: string; // BigInt 문자열 — Number() 금지
  vendorSettledAt: string | null;
};

type Tab = "inbox" | "schedule" | "settlement";

/** VND 점 구분 표기 (15.000.000₫). BigInt 문자열 정규식 — Number() 금지(정밀도 손실 방지) */
function formatVndDot(raw: string): string {
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}₫`;
}

/** BigInt 문자열 합산 (Number 금지) */
function sumVnd(values: string[]): string {
  return values.reduce((acc, v) => acc + BigInt(v || "0"), 0n).toString();
}

/** ISO 날짜 → "dd/MM" (UTC 자정 @db.Date). serviceDate/checkIn 표시용 */
function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** 발주 일정 라벨 — serviceDate 우선, 없으면 checkIn~checkOut */
function scheduleLabel(o: VendorOrder): string {
  if (o.serviceDate) {
    const day = formatDayMonth(o.serviceDate);
    return o.serviceTime ? `${day} ${o.serviceTime}` : day;
  }
  if (o.checkIn && o.checkOut) {
    return `${formatDayMonth(o.checkIn)} - ${formatDayMonth(o.checkOut)}`;
  }
  if (o.checkIn) return formatDayMonth(o.checkIn);
  return "—";
}

export default function VendorBoard() {
  const t = useTranslations("vendor");
  const [orders, setOrders] = useState<VendorOrder[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  // 거절 사유 시트 대상 발주 id (null=닫힘)
  const [rejectTarget, setRejectTarget] = useState<VendorOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/vendor/orders", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { orders: VendorOrder[] };
      setOrders(data.orders);
    } catch {
      setError(true);
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = useCallback(
    async (order: VendorOrder, accept: boolean, rejectReason?: string) => {
      setBusyId(order.id);
      try {
        const res = await fetch(`/api/vendor/orders/${order.id}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accept, rejectReason: rejectReason ?? null }),
        });
        // 409 NOT_PENDING(이미 응답됨) 포함 — 어느 쪽이든 최신 상태로 재조회
        await load();
        setRejectTarget(null);
        if (!res.ok && res.status !== 409) {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  // 섹션별 분류
  const all = orders ?? [];
  const inbox = all.filter((o) => o.vendorStatus === "PENDING_VENDOR");
  const accepted = all
    .filter((o) => o.vendorStatus === "VENDOR_ACCEPTED")
    .sort((a, b) => scheduleSortKey(a) - scheduleSortKey(b));
  // 정산 내역 = 수락/이행된 발주(우리가 지급할 대상). 거절·대기 제외.
  const settleable = all.filter((o) => o.vendorStatus === "VENDOR_ACCEPTED");
  const settled = settleable.filter((o) => o.vendorSettledAt);
  const unsettled = settleable.filter((o) => !o.vendorSettledAt);

  const loading = orders === null;

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-28 pt-16">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
          <p className="text-sm text-neutral-500">{t("subtitle")}</p>
        </div>
        {/* 통계 진입 — 서버 렌더 /vendor/stats (costVnd 기반 매출·발주 통계) */}
        <Link
          href="/vendor/stats"
          className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-teal-700 active:scale-95"
        >
          <span className="material-symbols-outlined text-base">bar_chart</span>
          {t("stats.title")}
        </Link>
      </header>

      {/* 탭 — 발주함 | 예약현황 | 정산 (라벨 3개, 한 화면 1작업) */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {(["inbox", "schedule", "settlement"] as const).map((key) => {
          const active = tab === key;
          const count = key === "inbox" ? inbox.length : 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "relative rounded-lg bg-white py-2 text-center text-sm font-bold text-teal-700 shadow-sm"
                  : "relative rounded-lg py-2 text-center text-sm font-medium text-slate-500"
              }
            >
              {t(`tab.${key}`)}
              {key === "inbox" && count > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-neutral-400">{t("loading")}</p>
      ) : (
        <>
          {error && (
            <button
              type="button"
              onClick={() => void load()}
              className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 active:scale-[0.99]"
            >
              {t("loadError")}
            </button>
          )}

          {tab === "inbox" && (
            <InboxSection
              orders={inbox}
              busyId={busyId}
              t={t}
              onAccept={(o) => respond(o, true)}
              onReject={(o) => setRejectTarget(o)}
            />
          )}

          {tab === "schedule" && <ScheduleSection orders={accepted} t={t} />}

          {tab === "settlement" && (
            <SettlementSection unsettled={unsettled} settled={settled} t={t} />
          )}
        </>
      )}

      {/* 거절 사유 시트 */}
      {rejectTarget && (
        <RejectSheet
          order={rejectTarget}
          busy={busyId === rejectTarget.id}
          t={t}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => respond(rejectTarget, false, reason)}
        />
      )}
    </main>
  );
}

function scheduleSortKey(o: VendorOrder): number {
  const iso = o.serviceDate ?? o.checkIn;
  return iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER;
}

type T = ReturnType<typeof useTranslations<"vendor">>;

// ── 발주함(받은 발주) ───────────────────────────────────────────────
function InboxSection({
  orders,
  busyId,
  t,
  onAccept,
  onReject,
}: {
  orders: VendorOrder[];
  busyId: string | null;
  t: T;
  onAccept: (o: VendorOrder) => void;
  onReject: (o: VendorOrder) => void;
}) {
  if (orders.length === 0) {
    return <EmptyState icon="inbox" title={t("empty.inbox")} hint={t("empty.inboxHint")} />;
  }
  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <div
          key={o.id}
          className="space-y-3 rounded-2xl border-l-4 border-rose-400 bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="truncate text-base font-bold text-neutral-900">
                {o.itemName ?? "—"}
                <span className="ml-2 rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-bold text-teal-700">
                  ×{o.quantity}
                </span>
              </h3>
              {o.optionLabel && (
                <p className="truncate text-sm font-semibold text-teal-700">{o.optionLabel}</p>
              )}
              {o.villaName && (
                <p className="flex items-center gap-1 text-sm text-neutral-600">
                  <span className="material-symbols-outlined text-base text-neutral-400">
                    home
                  </span>
                  {o.villaName}
                </p>
              )}
              <p className="flex items-center gap-1 text-sm text-neutral-600">
                <span className="material-symbols-outlined text-base text-neutral-400">
                  event
                </span>
                {scheduleLabel(o)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                {t("payLabel")}
              </p>
              <p className="text-lg font-extrabold text-teal-700">{formatVndDot(o.costVnd)}</p>
            </div>
          </div>

          {/* 수락 / 거절 — 버튼 2개 (한 화면 1작업) */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => onReject(o)}
              className="rounded-xl border border-neutral-200 bg-white py-3 text-sm font-bold text-neutral-600 transition active:scale-95 disabled:opacity-50"
            >
              {t("reject")}
            </button>
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => onAccept(o)}
              className="rounded-xl bg-teal-600 py-3 text-sm font-bold text-white transition active:scale-95 disabled:opacity-50"
            >
              {busyId === o.id ? t("submitting") : t("accept")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 예약 현황(수락한 발주 일정) ────────────────────────────────────
function ScheduleSection({ orders, t }: { orders: VendorOrder[]; t: T }) {
  if (orders.length === 0) {
    return <EmptyState icon="event_available" title={t("empty.schedule")} hint={t("empty.scheduleHint")} />;
  }
  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <div
          key={o.id}
          className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-teal-500 bg-white p-4 shadow-sm"
        >
          <div className="min-w-0 space-y-1">
            <h3 className="truncate font-bold text-neutral-900">
              {o.itemName ?? "—"}
              <span className="ml-2 text-sm font-semibold text-neutral-500">×{o.quantity}</span>
            </h3>
            {o.optionLabel && (
              <p className="truncate text-sm font-medium text-neutral-600">{o.optionLabel}</p>
            )}
            {o.villaName && <p className="truncate text-sm text-neutral-500">{o.villaName}</p>}
            <p className="text-sm font-semibold text-teal-700">{scheduleLabel(o)}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">
            <span className="material-symbols-outlined text-base [font-variation-settings:'FILL'_1]">
              check_circle
            </span>
            {t("status.accepted")}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 정산 내역 ──────────────────────────────────────────────────────
function SettlementSection({
  unsettled,
  settled,
  t,
}: {
  unsettled: VendorOrder[];
  settled: VendorOrder[];
  t: T;
}) {
  if (unsettled.length === 0 && settled.length === 0) {
    return <EmptyState icon="payments" title={t("empty.settlement")} hint={t("empty.settlementHint")} />;
  }
  const pendingTotal = sumVnd(unsettled.map((o) => o.costVnd));
  const paidTotal = sumVnd(settled.map((o) => o.costVnd));

  return (
    <div className="space-y-5">
      {/* 합계 카드 — VND만(우리 판매가·마진 없음) */}
      <section className="relative overflow-hidden rounded-2xl bg-teal-600 p-6 text-white shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-500 opacity-20" />
        <div className="relative z-10 space-y-4">
          <div>
            <p className="text-sm font-medium text-teal-50 opacity-90">{t("settle.pendingTotal")}</p>
            <h2 className="mt-1 text-4xl font-extrabold tracking-tight">
              {formatVndDot(pendingTotal)}
            </h2>
          </div>
          <div className="h-px w-full bg-white/20" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-teal-50">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>
              {t("settle.paidTotal")}: {formatVndDot(paidTotal)}
            </span>
          </div>
        </div>
      </section>

      {unsettled.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700">{t("settle.pendingTitle")}</h3>
          <div className="space-y-2">
            {unsettled.map((o) => (
              <SettleRow key={o.id} order={o} paid={false} t={t} />
            ))}
          </div>
        </div>
      )}

      {settled.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700">{t("settle.paidTitle")}</h3>
          <div className="space-y-2">
            {settled.map((o) => (
              <SettleRow key={o.id} order={o} paid t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettleRow({ order, paid, t }: { order: VendorOrder; paid: boolean; t: T }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border-l-4 bg-white p-4 shadow-sm ${
        paid ? "border-emerald-500" : "border-slate-300"
      }`}
    >
      <div className="min-w-0 space-y-1">
        <h4 className="truncate font-bold text-neutral-900">
          {order.itemName ?? "—"}
          <span className="ml-2 text-sm font-semibold text-neutral-500">×{order.quantity}</span>
        </h4>
        {order.optionLabel && (
          <p className="truncate text-sm font-medium text-neutral-600">{order.optionLabel}</p>
        )}
        <p className="truncate text-sm text-slate-500">
          {order.villaName ? `${order.villaName} · ` : ""}
          {scheduleLabel(order)}
        </p>
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
            paid
              ? "bg-emerald-100 text-emerald-700"
              : "border border-slate-200 bg-slate-100 text-slate-500"
          }`}
        >
          {paid ? t("settle.paid") : t("settle.pending")}
        </span>
      </div>
      <p className={`shrink-0 text-lg font-bold ${paid ? "text-teal-700" : "text-slate-600"}`}>
        {formatVndDot(order.costVnd)}
      </p>
    </div>
  );
}

// ── 빈 상태 ────────────────────────────────────────────────────────
function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm">
      <span className="material-symbols-outlined text-5xl text-teal-600">{icon}</span>
      <p className="text-sm font-bold text-slate-700">{title}</p>
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  );
}

// ── 거절 사유 입력 시트 ────────────────────────────────────────────
function RejectSheet({
  order,
  busy,
  t,
  onCancel,
  onConfirm,
}: {
  order: VendorOrder;
  busy: boolean;
  t: T;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40">
      <div className="w-full max-w-md space-y-4 rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-neutral-200" />
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-neutral-900">{t("rejectSheet.title")}</h3>
          <p className="text-sm text-neutral-500">
            {order.itemName ?? "—"}
            {order.optionLabel ? ` · ${order.optionLabel}` : ""} ×{order.quantity} ·{" "}
            {scheduleLabel(order)}
          </p>
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder={t("rejectSheet.placeholder")}
          className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-base text-neutral-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-neutral-200 bg-white py-3.5 text-base font-bold text-neutral-600 active:scale-95 disabled:opacity-50"
          >
            {t("rejectSheet.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-xl bg-rose-600 py-3.5 text-base font-bold text-white active:scale-95 disabled:opacity-50"
          >
            {busy ? t("submitting") : t("rejectSheet.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
