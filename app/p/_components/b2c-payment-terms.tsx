// B2C 계약금/잔금 결제 안내 + 잔금 환율 변동 공시 (ADR-0048 P5b) — 공개 book 화면 표시.
//   DIRECT(일반고객) 제안에서만 렌더. 순수 표시(누수 없음 — 확정/예상 금액과 안내 문구만).
//   잔금은 "약"(실확정은 D-14 환율). 금액은 청구통화 최소단위(bigint).
import { Currency } from "@prisma/client";
import type { PublicLang } from "@/lib/public-i18n";
import { B2C_PAYMENT_TERMS } from "@/lib/b2c-terms";
import { formatPublicAmount } from "./public-format";

export function B2cPaymentTerms({
  lang,
  currency,
  deposit,
  balanceApprox,
  fullPrepay,
}: {
  lang: PublicLang;
  currency: Currency;
  deposit: bigint;
  balanceApprox: bigint;
  fullPrepay: boolean;
}) {
  const t = B2C_PAYMENT_TERMS[lang];
  // 청구통화 1건 금액 포맷 (formatPublicAmount는 통화별 컬럼을 받음)
  const fmt = (amount: bigint) =>
    formatPublicAmount(
      currency,
      currency === Currency.KRW ? Number(amount) : null,
      currency === Currency.VND ? amount : null,
      lang,
      currency === Currency.USD ? Number(amount) : null
    );

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-teal-600 text-base">payments</span>
        {t.heading}
      </h3>

      {/* 금액 분할 */}
      <div className="rounded-lg bg-neutral-50 border border-neutral-100 divide-y divide-neutral-100">
        {fullPrepay ? (
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-sm text-slate-600">{t.fullLabel}</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">{fmt(deposit)}</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-slate-600">{t.depositLabel}</span>
              <span className="text-sm font-bold text-teal-700 tabular-nums">{fmt(deposit)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-slate-600">{t.balanceLabel}</span>
              <span className="text-sm font-semibold text-slate-500 tabular-nums">≈ {fmt(balanceApprox)}</span>
            </div>
          </>
        )}
      </div>

      {/* 안내 문구 */}
      <ul className="space-y-1 text-xs text-slate-500 leading-relaxed list-disc list-inside">
        {t.paymentLines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      {/* ★잔금 환율 변동 공시 — 분할(잔금 있음)이고 ★청구통화가 VND가 아닐 때만.
          VND 청구는 잔금이 동(앵커) 고정이라 환율 변동이 없어 공시 부적합(KRW/USD 청구만 잔금이 FX로 확정). */}
      {!fullPrepay && currency !== Currency.VND && (
        <p className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800 leading-relaxed">
          <span className="material-symbols-outlined text-amber-500 text-sm align-middle mr-1">info</span>
          {t.fxDisclosure}
        </p>
      )}
    </section>
  );
}
