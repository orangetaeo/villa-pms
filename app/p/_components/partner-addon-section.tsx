"use client";

// app/p/_components/partner-addon-section.tsx — /p done 파트너 부가서비스 요청 섹션 (ADR-0023 S4, §5)
//   여행사/랜드사가 과일 바구니·도시락 등 PARTNER 자격 항목을 요청. /g 게스트 옵션 UI를 /p 톤으로 미러.
//   ★마진 비공개: 판매가만 표기(원가·vendorId·마진 없음). 표시 통화는 saleCurrency(KRW면 fx로 파생, VND면 ₫).
//   요청 → POST /api/p/[token]/service-orders. 성공 시 "요청 접수 — 운영자 확인 후 안내" + 요청 내역 갱신.
import { useMemo, useState } from "react";
import {
  resolveOrderPricing,
  ServiceSelectionError,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { priceKrwCeil } from "@/lib/service-display";
import { formatThousands } from "@/lib/format";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";
import { catalogImage } from "@/lib/service-image";
import type { Currency } from "@prisma/client";
import type {
  PartnerCatalogView,
  PartnerOption,
  PartnerRequestedOrder,
} from "@/lib/partner-addon-load";

interface Selection {
  variantKey: string | null;
  addonKeys: string[];
  modifierKeys: string[];
  quantity: number;
  /** 요청사항(선택, 최대 500자). 이행자에게 전달되는 특이사항. 미입력이면 null. */
  guestNote: string | null;
}

const NOTE_MAX = 500;

function emptySelection(variantKey: string | null): Selection {
  return { variantKey, addonKeys: [], modifierKeys: [], quantity: 0, guestNote: null };
}

const optToDef = (o: PartnerOption) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd });

export function PartnerAddonSection({
  token,
  bookingId,
  lang,
  saleCurrency,
  fxVndPerKrw,
  catalog,
  requestedOrders: initialOrders,
}: {
  token: string;
  bookingId: string;
  lang: PublicLang;
  saleCurrency: Currency;
  fxVndPerKrw: string | null;
  catalog: PartnerCatalogView[];
  requestedOrders: PartnerRequestedOrder[];
}) {
  const t = PUBLIC_LABELS[lang].partnerAddon;
  const krwSuffix = PUBLIC_LABELS[lang].krwSuffix;

  const [selections, setSelections] = useState<Record<string, Selection>>(() =>
    Object.fromEntries(catalog.map((c) => [c.id, emptySelection(c.variants[0]?.key ?? null)]))
  );
  const [requested, setRequested] = useState<PartnerRequestedOrder[]>(initialOrders);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 판매가 표기 — saleCurrency=KRW면 fx로 KRW 올림(없으면 문의), VND면 ₫.
  const fmtPrice = (vndStr: string | null | undefined): string => {
    if (vndStr == null || vndStr === "") return "—";
    if (saleCurrency === "KRW") {
      if (fxVndPerKrw) {
        const krw = priceKrwCeil(BigInt(vndStr), fxVndPerKrw);
        if (krw > 0) return `${formatThousands(krw)}${krwSuffix}`;
      }
      return t.priceInquiry;
    }
    return `${formatThousands(vndStr)}₫`;
  };
  const fmtDelta = (vndStr: string | null | undefined): string => {
    if (vndStr == null || vndStr === "") return "";
    const neg = vndStr.startsWith("-");
    if (saleCurrency === "KRW" && fxVndPerKrw) {
      const abs = neg ? vndStr.slice(1) : vndStr;
      const krw = priceKrwCeil(BigInt(abs || "0"), fxVndPerKrw);
      if (krw > 0) return `${neg ? "−" : "+"}${formatThousands(krw)}${krwSuffix}`;
    }
    if (saleCurrency === "VND") return `${neg ? "" : "+"}${formatThousands(vndStr)}₫`;
    return "";
  };
  const fmtKrwSnapshot = (priceKrw: number | null, priceVnd: string | null): string => {
    if (saleCurrency === "KRW" && priceKrw != null && priceKrw > 0) {
      return `${formatThousands(priceKrw)}${krwSuffix}`;
    }
    return fmtPrice(priceVnd);
  };

  const cardOptions = useMemo(() => {
    const map: Record<string, CatalogOptions> = {};
    for (const c of catalog) {
      map[c.id] = {
        variants: c.variants.map(optToDef),
        addons: c.addons.map(optToDef),
        modifiers: c.modifiers.map(optToDef),
      };
    }
    return map;
  }, [catalog]);

  const previewVnd = (c: PartnerCatalogView, sel: Selection): bigint | null => {
    if (sel.quantity < 1) return null;
    try {
      return resolveOrderPricing(
        { priceVnd: c.priceVnd ? BigInt(c.priceVnd) : null },
        cardOptions[c.id],
        { variantKey: sel.variantKey, addonKeys: sel.addonKeys, modifierKeys: sel.modifierKeys, quantity: sel.quantity }
      ).totalPriceVnd;
    } catch (e) {
      if (e instanceof ServiceSelectionError) return null;
      throw e;
    }
  };

  const anySelected = catalog.some((c) => (selections[c.id]?.quantity ?? 0) > 0);

  const submit = async () => {
    if (submitting) return;
    const chosen = catalog.filter((c) => (selections[c.id]?.quantity ?? 0) > 0);
    if (chosen.length === 0) return;
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      const created: PartnerRequestedOrder[] = [];
      for (const c of chosen) {
        const sel = selections[c.id];
        const res = await fetch(`/api/p/${token}/service-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId,
            catalogItemId: c.id,
            variantKey: sel.variantKey ?? undefined,
            addonKeys: sel.addonKeys,
            modifierKeys: sel.modifierKeys,
            quantity: sel.quantity,
            guestNote: sel.guestNote ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json().catch(() => ({}));
        const pv = previewVnd(c, sel);
        created.push({
          id: data?.id ?? c.id,
          type: c.type,
          name: c.name,
          status: "REQUESTED",
          quantity: sel.quantity,
          priceKrw: pv != null && saleCurrency === "KRW" && fxVndPerKrw ? priceKrwCeil(pv, fxVndPerKrw) : null,
          priceVnd: pv != null ? pv.toString() : null,
        });
      }
      setRequested((prev) => [...created, ...prev]);
      setSelections(
        Object.fromEntries(catalog.map((c) => [c.id, emptySelection(c.variants[0]?.key ?? null)]))
      );
      setDone(true);
    } catch {
      setError(t.error);
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (s: string) =>
    s === "REQUESTED" ? t.statusPending : s === "CONFIRMED" ? t.statusConfirmed : t.statusOther;

  return (
    <section className="bg-white rounded-2xl shadow-xl shadow-slate-100/50 border border-gray-100 p-6 space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-bold text-teal-600 tracking-wider">{t.label}</p>
        <h4 className="text-lg font-bold">{t.title}</h4>
        <p className="text-sm text-slate-500 leading-relaxed">{t.subtitle}</p>
      </div>

      {catalog.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">{t.empty}</p>
      ) : (
        <div className="space-y-3">
          {catalog.map((c) => {
            const sel = selections[c.id] ?? emptySelection(c.variants[0]?.key ?? null);
            const set = (next: Selection) => setSelections((p) => ({ ...p, [c.id]: next }));
            const pv = previewVnd(c, sel);
            const priceStr = pv != null ? fmtPrice(pv.toString()) : fmtPrice(c.priceVnd);
            const active = sel.quantity > 0;
            const photo = catalogImage(c.type, c.photoUrl);
            return (
              <div
                key={c.id}
                className={`rounded-xl overflow-hidden ${
                  active ? "border-2 border-teal-200" : "border border-gray-100"
                }`}
              >
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="w-full h-32 object-cover" alt={c.name} src={photo} loading="lazy" decoding="async" />
                )}
                <div className="p-4 space-y-3">
                  <div>
                    <h5 className="font-bold text-base text-slate-900">{c.name}</h5>
                    {c.desc && <p className="text-xs text-slate-500 mt-0.5">{c.desc}</p>}
                  </div>

                  {/* variants — 1택, 가격 대체 */}
                  {c.variants.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {c.variants.map((v) => {
                        const on = sel.variantKey === v.key;
                        return (
                          <button
                            key={v.key}
                            type="button"
                            onClick={() => set({ ...sel, variantKey: v.key })}
                            className={`rounded-lg px-3 py-2 text-left ${
                              on ? "border-2 border-teal-500 bg-teal-50" : "border border-gray-200 bg-white"
                            }`}
                          >
                            <p className={`text-xs font-bold ${on ? "text-teal-700" : "text-slate-500"}`}>
                              {v.label}
                            </p>
                            <p className="text-sm font-extrabold tabular-nums text-slate-800">
                              {fmtPrice(v.priceVnd)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* addons — 다중, 가산 */}
                  {c.addons.length > 0 && (
                    <div className="space-y-1.5">
                      {c.addons.map((a) => (
                        <label
                          key={a.key}
                          className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={sel.addonKeys.includes(a.key)}
                              onChange={() =>
                                set({
                                  ...sel,
                                  addonKeys: sel.addonKeys.includes(a.key)
                                    ? sel.addonKeys.filter((k) => k !== a.key)
                                    : [...sel.addonKeys, a.key],
                                })
                              }
                              className="w-5 h-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                            />
                            <span className="text-sm text-slate-800">{a.label}</span>
                          </span>
                          <span className="text-xs font-semibold text-teal-600 tabular-nums">
                            {fmtDelta(a.priceVnd)}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* modifiers — 토글, 가산 */}
                  {c.modifiers.map((m) => (
                    <label
                      key={m.key}
                      className="flex items-center justify-between rounded-lg border border-fuchsia-100 bg-fuchsia-50/40 px-3 py-2 cursor-pointer"
                    >
                      <span className="text-sm font-semibold text-slate-800">{m.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-bold text-teal-600 tabular-nums">
                          {fmtDelta(m.priceVnd)}
                        </span>
                        <input
                          type="checkbox"
                          checked={sel.modifierKeys.includes(m.key)}
                          onChange={() =>
                            set({
                              ...sel,
                              modifierKeys: sel.modifierKeys.includes(m.key)
                                ? sel.modifierKeys.filter((k) => k !== m.key)
                                : [...sel.modifierKeys, m.key],
                            })
                          }
                          className="w-5 h-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                        />
                      </span>
                    </label>
                  ))}

                  {/* 가격 + 수량 스테퍼 */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-extrabold text-slate-900 tabular-nums">{priceStr}</span>
                      {c.unitLabel && <span className="text-xs text-slate-400">/ {c.unitLabel}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        aria-label={t.decrease}
                        onClick={() => set({ ...sel, quantity: Math.max(0, sel.quantity - 1) })}
                        className="w-9 h-9 rounded-full border border-gray-200 text-slate-400 flex items-center justify-center text-lg active:scale-95"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-bold tabular-nums">{sel.quantity}</span>
                      <button
                        type="button"
                        aria-label={t.increase}
                        onClick={() => set({ ...sel, quantity: sel.quantity + 1 })}
                        className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-lg active:scale-95"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* 요청사항(선택) — 특이사항을 이행자(원천 공급자)에게 전달. 최대 500자. */}
                  {active && (
                    <div className="pt-1">
                      <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                        {t.noteLabel}
                      </label>
                      <textarea
                        rows={2}
                        maxLength={NOTE_MAX}
                        aria-label={t.noteLabel}
                        placeholder={t.notePlaceholder}
                        value={sel.guestNote ?? ""}
                        onChange={(e) => set({ ...sel, guestNote: e.target.value || null })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:ring-teal-500 focus:border-teal-500 resize-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {catalog.length > 0 && (
        <button
          type="button"
          disabled={submitting || !anySelected}
          onClick={submit}
          className="w-full h-14 bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform"
        >
          {submitting ? t.requesting : t.requestCta}
        </button>
      )}

      {done && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-teal-600 text-[20px]">check_circle</span>
          <p className="text-sm text-teal-800 leading-relaxed">{t.requested}</p>
        </div>
      )}

      {/* 요청 내역 */}
      {requested.length > 0 && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
            <h5 className="text-sm font-bold text-slate-700">{t.requestedTitle}</h5>
          </div>
          <div className="divide-y divide-gray-50">
            {requested.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 gap-2">
                <p className="text-sm font-semibold text-slate-800 min-w-0 truncate">
                  {o.name} <span className="text-slate-400 font-normal">× {o.quantity}</span>
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="bg-amber-50 text-amber-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {statusLabel(o.status)}
                  </span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {fmtKrwSnapshot(o.priceKrw, o.priceVnd)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 leading-relaxed">{t.settleNote}</p>
    </section>
  );
}
