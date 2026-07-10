"use client";

// 공급자 vi 체크아웃 폼 (T10.5, a-supplier-checkout) — 라이트 모바일 390px.
// 파손 토글(차감액) → 보증금 정산 요약 → 미니바 소모 정산(D6) → 완료.
// 사진 비교 섹션은 정책 변경(2026-07-10)으로 제거 — 파손 시에만 메모·차감액 입력.
// 미니바: 판매가(VND)만 표시·합산. 원가(costVnd)·마진 절대 비노출. 가격은 서버가 스냅샷 재계산(클라 전송 가격 무시).
// 완료 → lib/checkout.completeCheckout: CHECKED_OUT + CleaningTask + isSellable=false(검수 게이트).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { InlineGuide } from "@/components/inline-guide";

/** 미니바 품목 — 판매가(VND, 동 단위 문자열)와 비치 par 수량만. 원가·마진 없음. */
export interface MinibarItemView {
  id: string;
  label: string;
  unitPriceVnd: string; // 판매가 (BigInt → 문자열)
  par: number; // 비치 수량 (VillaMinibarStock.qty ?? MinibarItem.stockQty)
}

/** VND 천단위 dot 포맷 — 5000000 → "5.000.000" */
function formatVndInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** BigInt VND → dot 표기 (표시 전용) */
function formatVndBig(v: bigint): string {
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export default function SupplierCheckoutForm({
  bookingId,
  minibar,
  depositVnd,
}: {
  bookingId: string;
  minibar: MinibarItemView[];
  /** 수취 보증금(VND 동 단위 문자열) — 없으면 null(보증금 미수취) */
  depositVnd: string | null;
}) {
  const t = useTranslations("supplierCheckout");
  const router = useRouter();

  // 파손
  const [damageFound, setDamageFound] = useState(false);
  const [damageNote, setDamageNote] = useState("");
  const [deductionVnd, setDeductionVnd] = useState(""); // dot 포맷

  // 미니바 소모 수량 (itemId → consumed)
  const [consumed, setConsumed] = useState<Record<string, number>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepConsumed = (itemId: string, delta: number, par: number) => {
    setConsumed((prev) => {
      const next = Math.max(0, Math.min(par, (prev[itemId] ?? 0) + delta));
      return { ...prev, [itemId]: next };
    });
  };

  // 미니바 합계 (판매가 × 소비수량) — 표시·확인용. 서버가 동일 산식으로 재계산(권위)
  const minibarTotal = minibar.reduce((sum, m) => {
    const qty = consumed[m.id] ?? 0;
    return sum + BigInt(m.unitPriceVnd) * BigInt(qty);
  }, 0n);

  const depositBig = depositVnd ? BigInt(depositVnd) : 0n;
  const deductionBig = damageFound ? BigInt(deductionVnd.replace(/\D/g, "") || "0") : 0n;
  const refundBig = depositBig - deductionBig;

  // 파손 ON이면 lib/checkout 요건 충족: 상세 내용(note) 필수 + 차감액 > 0 (보증금 수취 시 차감 반영).
  //   note는 lib의 "상세 내용 또는 증빙 사진" 요건을, 차감액은 보증금 차감 정합을 만족시킨다.
  const damageValid = !damageFound || (damageNote.trim().length > 0 && deductionBig > 0n);
  const canSubmit = damageValid && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const minibarLines = minibar
        .filter((m) => (consumed[m.id] ?? 0) > 0)
        .map((m) => ({
          minibarItemId: m.id,
          consumedQty: consumed[m.id] ?? 0,
          stockedQty: m.par,
        }));
      const res = await fetch(`/api/supplier/bookings/${bookingId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 상태 사진은 정책 변경(2026-07-10)으로 미전송 — 파손 시에만 메모·차감액.
          damageFound,
          ...(damageFound && damageNote.trim() ? { damageNote: damageNote.trim() } : {}),
          ...(damageFound && deductionBig > 0n
            ? { deductionVnd: deductionBig.toString() }
            : {}),
          ...(minibarLines.length > 0 ? { minibarLines } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? t("submitError"));
        return;
      }
      router.push("/my-bookings");
      router.refresh();
    } catch {
      setError(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="mx-auto max-w-md space-y-4 px-4 pb-44 pt-4">
        {/* 파손 리포트 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#DC2626]">report</span>
              <h2 className="font-bold text-neutral-800">{t("damage.title")}</h2>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                aria-label={t("damage.title")}
                checked={damageFound}
                onChange={(e) => setDamageFound(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-7 w-12 rounded-full bg-neutral-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-all after:content-[''] peer-checked:bg-[#DC2626] peer-checked:after:translate-x-5" />
            </label>
          </div>
          {damageFound && (
            <div className="space-y-4 border-t border-neutral-100 px-4 pb-4 pt-4">
              <p className="-mt-1 text-[11px] font-medium text-neutral-400">{t("damage.hint")}</p>
              <div>
                <label className="text-[10px] font-bold uppercase text-neutral-400">
                  {t("damage.note")}
                </label>
                <textarea
                  value={damageNote}
                  onChange={(e) => setDamageNote(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm focus:ring-2 focus:ring-teal-500"
                  placeholder={t("damage.notePlaceholder")}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-neutral-400">
                  {t("damage.deduction")}
                </label>
                <div className="mt-1.5 flex h-14 items-center gap-2 rounded-xl border-2 border-[#DC2626]/40 bg-red-50 px-4 focus-within:ring-2 focus-within:ring-[#DC2626]">
                  <span className="material-symbols-outlined text-[#DC2626]">remove_circle</span>
                  <input
                    value={deductionVnd}
                    onChange={(e) => setDeductionVnd(formatVndInput(e.target.value))}
                    inputMode="numeric"
                    placeholder="0"
                    className="min-w-0 flex-1 border-none bg-transparent p-0 text-lg font-extrabold tabular-nums text-[#DC2626] placeholder-red-200 focus:ring-0"
                  />
                  <span className="font-bold text-[#DC2626]">₫</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 보증금 정산 요약 — 보증금 수취 시에만 (받은 cọc → 차감 → 환불) */}
        {depositVnd && (
          <section className="rounded-2xl bg-teal-600 p-5 text-white shadow-lg shadow-teal-900/10">
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="opacity-80">{t("deposit.received")}</span>
                <span className="font-semibold tabular-nums">{formatVndBig(depositBig)}₫</span>
              </div>
              {damageFound && deductionBig > 0n && (
                <div className="flex justify-between">
                  <span className="opacity-80">{t("deposit.deduction")}</span>
                  <span className="font-semibold tabular-nums text-amber-200">
                    − {formatVndBig(deductionBig)}₫
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-white/20 pt-3">
                <span className="font-bold">{t("deposit.refund")}</span>
                <span className="text-2xl font-extrabold tabular-nums">
                  {formatVndBig(refundBig > 0n ? refundBig : 0n)}₫
                </span>
              </div>
            </div>
          </section>
        )}

        {/* 미니바 소모 정산 (D6) — 판매가(VND)만, 원가·마진 비노출 */}
        {minibar.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
              <span className="material-symbols-outlined text-teal-600">local_bar</span>
              <h2 className="font-bold text-neutral-800">{t("minibar.title")}</h2>
              <span className="ml-auto whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-400">
                {t("minibar.hint")}
              </span>
            </div>
            {/* 인라인 가이드 — 소비 수량만 입력, 미니바 대금은 보증금과 별도 수취 (T-tutorial-onboarding-9) */}
            <div className="px-4 pt-3">
              <InlineGuide text={t("guide.minibar")} />
            </div>
            <div className="divide-y divide-neutral-100">
              {minibar.map((m) => {
                const qty = consumed[m.id] ?? 0;
                const line = BigInt(m.unitPriceVnd) * BigInt(qty);
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight text-neutral-800">{m.label}</p>
                      <p className="text-[11px] text-neutral-400">
                        {t("minibar.parPrice", {
                          par: m.par,
                          price: formatVndBig(BigInt(m.unitPriceVnd)),
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <button
                        type="button"
                        aria-label={t("minibar.decrease")}
                        onClick={() => stepConsumed(m.id, -1, m.par)}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition-transform active:scale-90"
                      >
                        <span className="material-symbols-outlined text-[18px]">remove</span>
                      </button>
                      <span
                        className={
                          qty > 0
                            ? "w-6 text-center text-lg font-extrabold tabular-nums"
                            : "w-6 text-center text-lg font-extrabold tabular-nums text-neutral-300"
                        }
                      >
                        {qty}
                      </span>
                      <button
                        type="button"
                        aria-label={t("minibar.increase")}
                        onClick={() => stepConsumed(m.id, 1, m.par)}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition-transform active:scale-90"
                      >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                      </button>
                    </div>
                    <div className="w-20 shrink-0 text-right">
                      <span
                        className={
                          qty > 0
                            ? "font-bold tabular-nums text-neutral-800"
                            : "font-bold tabular-nums text-neutral-300"
                        }
                      >
                        {formatVndBig(line)}₫
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-teal-100 bg-teal-50 px-4 py-3">
              <span className="font-bold text-teal-800">{t("minibar.total")}</span>
              <span className="text-xl font-extrabold tabular-nums text-teal-700">
                {formatVndBig(minibarTotal)}₫
              </span>
            </div>
          </section>
        )}
      </main>

      {/* Sticky 완료 CTA */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-neutral-100 bg-white/95 px-4 pt-3 backdrop-blur">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="mb-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-lg font-bold text-white shadow-lg shadow-teal-900/10 transition-all active:scale-[0.98] disabled:opacity-40"
        >
          <span className="material-symbols-outlined">logout</span>
          {submitting ? t("submitting") : t("submit")}
        </button>
        {error ? (
          <p className="mb-2 text-center text-xs font-medium text-red-500">{error}</p>
        ) : (
          <p className="mb-2 text-center text-[11px] font-medium text-neutral-400">
            {t("submitCaption")}
          </p>
        )}
      </div>
    </>
  );
}
