"use client";

// 예약 부가옵션 주문 패널 (ADR-0019 S2, Stitch b20) — 주문 목록 + 옵션 추가 + 행별 상태 액션.
//   /api/bookings/[id]/service-orders (POST) + /api/service-orders/[id] (PATCH). 저장 후 router.refresh().
//   ★ 마진 비공개: 원가(costVnd)·확정가 조정칸은 showCost(canViewFinance)일 때만. 서버 페이로드에서도 제외됨.
//   게스트 요청(requestedVia=GUEST·REQUESTED) 행은 amber 강조("요청 대기"). 합계는 resolveOrderPricing 재사용.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatThousands } from "@/lib/format";
import {
  parseCatalogOptions,
  resolveOrderPricing,
  type CatalogOptions,
} from "@/lib/service-catalog";

// 서버에서 직렬화되어 내려오는 카탈로그 항목(주문 추가용) — 판매가만(원가 없음)
export interface OrderCatalogItem {
  id: string;
  type: string;
  nameKo: string;
  unitLabelKo: string;
  priceKrw: number | null;
  priceVnd: string | null;
  options: unknown;
}

export interface SelectedOptionSnapshot {
  group: "variant" | "addon" | "modifier";
  key: string;
  labelKo: string;
}

export interface OrderRow {
  id: string;
  type: string;
  status: "REQUESTED" | "CONFIRMED" | "DELIVERED" | "CANCELLED";
  nameKo: string; // 카탈로그명(없으면 type 라벨)
  quantity: number;
  priceKrw: number;
  priceVnd: string | null;
  costVnd?: string | null; // showCost일 때만
  requestedVia: "ADMIN" | "GUEST";
  guestNote: string | null;
  selectedOptions: SelectedOptionSnapshot[];
}

const STATUS_BADGE: Record<string, string> = {
  REQUESTED: "bg-amber-500/15 text-amber-400",
  CONFIRMED: "bg-blue-500/15 text-blue-400",
  DELIVERED: "bg-emerald-500/15 text-emerald-400",
  CANCELLED: "bg-slate-600/30 text-slate-400",
};

export default function ServiceOrdersPanel({
  bookingId,
  catalog,
  orders,
  showCost,
}: {
  bookingId: string;
  catalog: OrderCatalogItem[];
  orders: OrderRow[];
  showCost: boolean;
}) {
  const t = useTranslations("adminServiceOrders");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // 확정가 입력(행별, VND) — showCost만
  const [confirmPrice, setConfirmPrice] = useState<Record<string, string>>({});

  const pendingGuest = orders.filter(
    (o) => o.requestedVia === "GUEST" && o.status === "REQUESTED"
  ).length;

  const refresh = () => router.refresh();
  const fail = () => setMessage({ ok: false, text: t("error") });

  async function patchStatus(orderId: string, status: OrderRow["status"], extra?: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  function handleConfirm(order: OrderRow) {
    // showCost면 입력한 확정가(VND)를 함께 보냄(미입력 시 가격 미변경, 상태만 확정)
    const extra: Record<string, unknown> = {};
    if (showCost) {
      const p = confirmPrice[order.id];
      if (p && /^\d{1,15}$/.test(p)) extra.priceVnd = p;
    }
    patchStatus(order.id, "CONFIRMED", extra);
  }

  function handleCancel(order: OrderRow) {
    if (!confirm(t("cancelConfirm"))) return;
    patchStatus(order.id, "CANCELLED");
  }

  return (
    <section className="bg-admin-card border border-[#334155] rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 gap-3">
        <h2 className="font-bold text-sm text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">restaurant</span>
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
          {pendingGuest > 0 && (
            <span className="bg-amber-500/15 text-amber-400 text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
              {t("guestPending", { n: pendingGuest })}
            </span>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="p-6 text-sm text-admin-muted">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-admin-muted text-[11px] font-bold uppercase tracking-wider border-b border-slate-700 bg-slate-900/40">
              <tr>
                <th className="text-left px-6 py-3">{t("colMenu")}</th>
                <th className="text-center px-2 py-3">{t("colQty")}</th>
                <th className="text-center px-2 py-3">{t("colVia")}</th>
                <th className="text-right px-3 py-3">{t("colSale")}</th>
                {showCost && <th className="text-right px-3 py-3">{t("colCost")}</th>}
                <th className="text-center px-3 py-3">{t("colStatus")}</th>
                <th className="text-right px-6 py-3">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {orders.map((o) => {
                const isPendingGuest = o.requestedVia === "GUEST" && o.status === "REQUESTED";
                const terminal = o.status === "CANCELLED";
                const optSummary = o.selectedOptions.map((s) => s.labelKo).join(", ");
                return (
                  <tr
                    key={o.id}
                    className={
                      isPendingGuest
                        ? "bg-amber-500/5"
                        : terminal
                          ? "opacity-60"
                          : "hover:bg-slate-700/30 transition"
                    }
                  >
                    <td className="px-6 py-3">
                      <p
                        className={`font-medium ${terminal ? "text-slate-300 line-through" : "text-white"}`}
                      >
                        {o.nameKo}
                      </p>
                      {optSummary && (
                        <p className="text-[11px] text-slate-500 mt-0.5">{optSummary}</p>
                      )}
                      {o.guestNote && (
                        <p className="text-[11px] text-amber-400/80 mt-0.5 italic">“{o.guestNote}”</p>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center tabular-nums text-slate-300">{o.quantity}</td>
                    <td className="px-2 py-3 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          o.requestedVia === "GUEST"
                            ? "bg-teal-500/15 text-teal-300"
                            : "bg-slate-600/40 text-slate-300"
                        }`}
                      >
                        {o.requestedVia === "GUEST" ? t("viaGuest") : t("viaAdmin")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white font-semibold whitespace-nowrap">
                      {o.priceKrw > 0 ? `${formatThousands(o.priceKrw)}원` : ""}
                      {o.priceKrw > 0 && o.priceVnd ? <br /> : null}
                      {o.priceVnd ? (
                        <span className="text-slate-300 font-normal">
                          {formatThousands(o.priceVnd)}₫
                        </span>
                      ) : o.priceKrw > 0 ? null : (
                        "—"
                      )}
                    </td>
                    {showCost && (
                      <td className="px-3 py-3 text-right tabular-nums text-slate-400 whitespace-nowrap">
                        {o.costVnd && o.costVnd !== "0" ? `${formatThousands(o.costVnd)}₫` : "—"}
                      </td>
                    )}
                    <td className="px-3 py-3 text-center">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                          STATUS_BADGE[o.status]
                        }`}
                      >
                        {t(`status.${o.status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <RowActions
                        order={o}
                        showCost={showCost}
                        busy={busy}
                        confirmPrice={confirmPrice[o.id] ?? ""}
                        setConfirmPrice={(v) =>
                          setConfirmPrice((s) => ({ ...s, [o.id]: v.replace(/\D/g, "") }))
                        }
                        onConfirm={() => handleConfirm(o)}
                        onDeliver={() => patchStatus(o.id, "DELIVERED")}
                        onCancel={() => handleCancel(o)}
                        t={t}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 옵션 추가 */}
      <div className="px-6 py-4 border-t border-slate-700 bg-slate-900/30">
        {adding ? (
          <AddOrderForm
            bookingId={bookingId}
            catalog={catalog}
            busy={busy}
            setBusy={setBusy}
            onDone={() => {
              setAdding(false);
              setMessage({ ok: true, text: t("saved") });
              refresh();
            }}
            onFail={fail}
            onClose={() => setAdding(false)}
            t={t}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={catalog.length === 0}
            className="flex items-center gap-2 bg-admin-primary hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-bold rounded-lg px-4 py-2 whitespace-nowrap transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t("addTitle")}
          </button>
        )}
      </div>
    </section>
  );
}

// ── 행별 상태 액션 ─────────────────────────────────────────────────────────────
function RowActions({
  order,
  showCost,
  busy,
  confirmPrice,
  setConfirmPrice,
  onConfirm,
  onDeliver,
  onCancel,
  t,
}: {
  order: OrderRow;
  showCost: boolean;
  busy: boolean;
  confirmPrice: string;
  setConfirmPrice: (v: string) => void;
  onConfirm: () => void;
  onDeliver: () => void;
  onCancel: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const btnGhost =
    "text-xs font-bold border border-slate-700 hover:bg-slate-800 text-slate-400 rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50";

  if (order.status === "REQUESTED") {
    return (
      <div className="flex items-center justify-end gap-2">
        {showCost && (
          <input
            inputMode="numeric"
            value={confirmPrice ? formatThousands(confirmPrice) : ""}
            onChange={(e) => setConfirmPrice(e.target.value)}
            placeholder={t("confirmPricePlaceholder")}
            aria-label={t("confirmPricePlaceholder")}
            className="w-28 bg-admin-bg border border-slate-700 rounded px-2 py-1 text-xs text-white tabular-nums text-right focus:border-admin-primary focus:outline-none"
          />
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50"
        >
          {t("actions.confirm")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>
          {t("actions.cancel")}
        </button>
      </div>
    );
  }
  if (order.status === "CONFIRMED") {
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDeliver}
          disabled={busy}
          className="text-xs font-bold bg-admin-primary hover:bg-blue-600 text-white rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-50"
        >
          {t("actions.deliver")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>
          {t("actions.cancel")}
        </button>
      </div>
    );
  }
  return <div className="text-right text-slate-600 text-xs">—</div>;
}

// ── 옵션 추가 폼 (카탈로그 선택 → variant/addon/modifier → 수량 → 합계 미리보기) ──────
function AddOrderForm({
  bookingId,
  catalog,
  busy,
  setBusy,
  onDone,
  onFail,
  onClose,
  t,
}: {
  bookingId: string;
  catalog: OrderCatalogItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
  onFail: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [itemId, setItemId] = useState<string>(catalog[0]?.id ?? "");
  const [variantKey, setVariantKey] = useState<string>("");
  const [addonKeys, setAddonKeys] = useState<string[]>([]);
  const [modifierKeys, setModifierKeys] = useState<string[]>([]);
  const [quantity, setQuantity] = useState<string>("1");
  const [guestNote, setGuestNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const item = catalog.find((c) => c.id === itemId);
  const options: CatalogOptions = useMemo(
    () => (item ? parseCatalogOptions(item.options) : {}),
    [item]
  );

  // 항목 전환 시 옵션 선택 초기화 (첫 variant 자동선택)
  function selectItem(id: string) {
    setItemId(id);
    const next = catalog.find((c) => c.id === id);
    const opts = next ? parseCatalogOptions(next.options) : {};
    setVariantKey(opts.variants && opts.variants.length > 0 ? opts.variants[0].key : "");
    setAddonKeys([]);
    setModifierKeys([]);
    setError(null);
  }

  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);

  // 합계 미리보기 — 서버와 동일 로직(resolveOrderPricing). 선택 오류는 미리보기 미표시.
  const preview = useMemo(() => {
    if (!item) return null;
    try {
      return resolveOrderPricing(
        { priceKrw: item.priceKrw, priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
        options,
        { variantKey: variantKey || null, addonKeys, modifierKeys, quantity: qty }
      );
    } catch {
      return null;
    }
  }, [item, options, variantKey, addonKeys, modifierKeys, qty]);

  function toggleAddon(key: string) {
    setAddonKeys((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }
  function toggleModifier(key: string) {
    setModifierKeys((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  async function handleAdd() {
    if (!item) return;
    if ((options.variants?.length ?? 0) > 0 && !variantKey) {
      setError(t("variantRequired"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/service-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId: item.id,
          variantKey: variantKey || null,
          addonKeys,
          modifierKeys,
          quantity: qty,
          guestNote: guestNote.trim() || null,
          status: "REQUESTED",
        }),
      });
      if (!res.ok) throw new Error();
      onDone();
    } catch {
      onFail();
    } finally {
      setBusy(false);
    }
  }

  const selCls =
    "w-full bg-admin-bg border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-admin-primary focus:outline-none";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-300 uppercase tracking-wide">{t("addTitle")}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-white"
          aria-label={t("cancelAdd")}
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-2">
          <label className="text-xs text-slate-500">{t("selectMenu")}</label>
          <select
            value={itemId}
            onChange={(e) => selectItem(e.target.value)}
            aria-label={t("selectMenu")}
            className={`mt-1 ${selCls}`}
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameKo}
                {c.unitLabelKo ? ` / ${c.unitLabelKo}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("quantity")}</label>
          <input
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))}
            aria-label={t("quantity")}
            className="mt-1 w-full bg-admin-bg border border-slate-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:border-admin-primary focus:outline-none"
          />
        </div>
      </div>

      {/* variants — 1택 */}
      {(options.variants?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs text-slate-500">{t("variant")}</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {options.variants!.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setVariantKey(v.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  variantKey === v.key
                    ? "bg-admin-primary text-white border-admin-primary"
                    : "bg-admin-bg text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                {v.labelKo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* addons — 다중 */}
      {(options.addons?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs text-slate-500">{t("addons")}</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {options.addons!.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => toggleAddon(a.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  addonKeys.includes(a.key)
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-admin-bg text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                {a.labelKo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* modifiers — 토글 */}
      {(options.modifiers?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs text-slate-500">{t("modifiers")}</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {options.modifiers!.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => toggleModifier(m.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  modifierKeys.includes(m.key)
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-admin-bg text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                {m.labelKo}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-slate-500">{t("guestNote")}</label>
        <input
          value={guestNote}
          onChange={(e) => setGuestNote(e.target.value)}
          placeholder={t("guestNotePlaceholder")}
          maxLength={500}
          className={`mt-1 ${selCls}`}
        />
      </div>

      {/* 합계 미리보기 (resolveOrderPricing 재사용) */}
      {preview && (
        <div className="flex items-center justify-between bg-admin-bg border border-slate-700 rounded-lg px-4 py-2.5">
          <span className="text-sm text-slate-400">{t("total")}</span>
          <div className="text-right tabular-nums">
            {preview.totalPriceKrw != null && (
              <p className="text-white font-bold">{formatThousands(preview.totalPriceKrw)}원</p>
            )}
            {preview.totalPriceVnd != null && (
              <p className="text-slate-300 font-semibold">
                {formatThousands(preview.totalPriceVnd.toString())}₫
              </p>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50"
        >
          {t("cancelAdd")}
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !item}
          className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 whitespace-nowrap transition-all"
        >
          <span className="material-symbols-outlined text-base">add</span>
          {busy ? t("adding") : t("add")}
        </button>
      </div>
    </div>
  );
}
