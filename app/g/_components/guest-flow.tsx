"use client";

// app/g/_components/guest-flow.tsx — 게스트 셀프 체크인 5단계 한 흐름 (ADR-0019 S3, design g1~g5)
//   G1 예약확인 → G2 비품 → G3 동의서 서명 → G4 옵션 → G5 완료. 단계는 클라 state(라우트 전환 없음).
//   ★마진 비공개: 판매가만 렌더. 원가·마진·환산·타예약 0(서버 props에 애초 없음).
import { useMemo, useState } from "react";
import {
  resolveOrderPricing,
  ServiceSelectionError,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import type { PublicLang } from "@/lib/public-i18n";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import GuestSignaturePad from "./guest-signature-pad";
import { OptionCard, type CardSelection } from "./option-card";
import { guestPrice, guestVnd, guestDateRange } from "./guest-format";
import type { GuestFlowProps, GuestRequestedOrder } from "./types";

type Step = 0 | 1 | 2 | 3 | 4; // 0=G1, 1=G2, 2=G3, 3=G4, 4=G5
const STEP_KEYS = ["amenities", "agreement", "addons", "done"] as const;

const toVndStr = (v: bigint | null): string | null => (v == null ? null : v.toString());

export default function GuestFlow(props: GuestFlowProps) {
  const { token, lang, booking, amenityGroups, minibar, agreement, catalog } = props;
  const L = GUEST_LABELS[lang];

  const [step, setStep] = useState<Step>(0);
  const [amenitiesChecked, setAmenitiesChecked] = useState(false);
  const [signed, setSigned] = useState(props.alreadySigned);
  const [signedVersion, setSignedVersion] = useState<string | null>(props.signedVersion);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submittingAgreement, setSubmittingAgreement] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  // G4 선택 상태(카탈로그 항목별)
  const [selections, setSelections] = useState<Record<string, CardSelection>>(() =>
    Object.fromEntries(
      catalog.map((c) => [
        c.id,
        { variantKey: c.variants[0]?.key ?? null, addonKeys: [], modifierKeys: [], quantity: 0 },
      ])
    )
  );
  const [submittingOrders, setSubmittingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // G5에 보여줄 요청 내역(서버 props + 새로 요청한 것 병합)
  const [requestedOrders, setRequestedOrders] = useState<GuestRequestedOrder[]>(
    props.requestedOrders
  );

  // ── G4 합계 미리보기(선택된 항목 합산) ──
  const cardOptions = useMemo(() => {
    const map: Record<string, CatalogOptions> = {};
    for (const c of catalog) {
      map[c.id] = {
        variants: c.variants.map((o) => ({ key: o.key, labelKo: o.label, priceKrw: o.priceKrw, priceVnd: o.priceVnd })),
        addons: c.addons.map((o) => ({ key: o.key, labelKo: o.label, priceKrw: o.priceKrw, priceVnd: o.priceVnd })),
        modifiers: c.modifiers.map((o) => ({ key: o.key, labelKo: o.label, priceKrw: o.priceKrw, priceVnd: o.priceVnd })),
      };
    }
    return map;
  }, [catalog]);

  const grandTotal = useMemo(() => {
    let krw = 0;
    let hasKrw = false;
    let vnd = 0n;
    let hasVnd = false;
    for (const c of catalog) {
      const sel = selections[c.id];
      if (!sel || sel.quantity < 1) continue;
      try {
        const p = resolveOrderPricing(
          { priceKrw: c.priceKrw, priceVnd: c.priceVnd ? BigInt(c.priceVnd) : null },
          cardOptions[c.id],
          { variantKey: sel.variantKey, addonKeys: sel.addonKeys, modifierKeys: sel.modifierKeys, quantity: sel.quantity }
        );
        if (p.totalPriceKrw != null) { krw += p.totalPriceKrw; hasKrw = true; }
        if (p.totalPriceVnd != null) { vnd += p.totalPriceVnd; hasVnd = true; }
      } catch (e) {
        if (!(e instanceof ServiceSelectionError)) throw e;
      }
    }
    return { krw, hasKrw, vnd, hasVnd };
  }, [catalog, selections, cardOptions]);

  const grandTotalStr = grandTotal.hasKrw
    ? guestPrice(grandTotal.krw, null, lang)
    : grandTotal.hasVnd
      ? guestVnd(grandTotal.vnd.toString())
      : guestPrice(0, null, lang);

  const anySelected = catalog.some((c) => (selections[c.id]?.quantity ?? 0) > 0);

  // ── 동의서 서명 확정 ──
  const submitAgreement = async () => {
    if (!signatureUrl || !agreeChecked || submittingAgreement) return;
    setSubmittingAgreement(true);
    setAgreementError(null);
    try {
      const res = await fetch(`/api/g/${token}/agreement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureUrl }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      setSigned(true);
      setSignedVersion(data?.agreementVersion ?? agreement.version);
      setStep(3);
    } catch {
      setAgreementError(L.agreement.error);
    } finally {
      setSubmittingAgreement(false);
    }
  };

  // ── 옵션 요청 ──
  const submitOrders = async () => {
    if (submittingOrders) return;
    const chosen = catalog.filter((c) => (selections[c.id]?.quantity ?? 0) > 0);
    if (chosen.length === 0) {
      setStep(4);
      return;
    }
    setSubmittingOrders(true);
    setOrdersError(null);
    try {
      const created: GuestRequestedOrder[] = [];
      for (const c of chosen) {
        const sel = selections[c.id];
        const res = await fetch(`/api/g/${token}/service-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalogItemId: c.id,
            variantKey: sel.variantKey ?? undefined,
            addonKeys: sel.addonKeys,
            modifierKeys: sel.modifierKeys,
            quantity: sel.quantity,
          }),
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        // 미리보기 가격으로 G5 표시(서버 재계산값과 동일해야 함)
        let prKrw: number | null = null;
        let prVnd: string | null = null;
        try {
          const p = resolveOrderPricing(
            { priceKrw: c.priceKrw, priceVnd: c.priceVnd ? BigInt(c.priceVnd) : null },
            cardOptions[c.id],
            { variantKey: sel.variantKey, addonKeys: sel.addonKeys, modifierKeys: sel.modifierKeys, quantity: sel.quantity }
          );
          prKrw = p.totalPriceKrw;
          prVnd = toVndStr(p.totalPriceVnd);
        } catch { /* 미리보기 실패는 무시 */ }
        const data = await res.json();
        created.push({
          id: data?.id ?? c.id,
          type: c.type,
          name: c.name,
          status: "REQUESTED",
          quantity: sel.quantity,
          priceKrw: prKrw,
          priceVnd: prVnd,
        });
      }
      setRequestedOrders((prev) => [...created, ...prev]);
      setStep(4);
    } catch {
      setOrdersError(L.addons.error);
    } finally {
      setSubmittingOrders(false);
    }
  };

  // ── 진행바(상단) ── 단계별 채움 폭(G5는 full)
  const barWidth = ["w-1/4", "w-2/4", "w-3/4", "w-full", "w-full"][step];

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white flex flex-col shadow-2xl relative">
      {/* 헤더 + 진행바 */}
      <header className="w-full sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="flex items-center h-14 px-3">
          {step > 0 && step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="p-2 rounded-full hover:bg-slate-50 active:scale-95"
            >
              <span className="material-symbols-outlined text-slate-600">arrow_back</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 pl-1">
              <VillaGoMark className="h-6 w-auto" />
              <VillaGoWordmark className="text-lg" villa="text-slate-900" go="text-teal-600" />
            </span>
          )}
          <h1 className="font-bold text-base text-slate-900 ml-1">{headerTitle(step, L)}</h1>
          {step > 0 && (
            <span className="ml-auto text-xs font-bold text-slate-400 tabular-nums">
              {L.stepCount(Math.min(step, 4), 4)}
            </span>
          )}
        </div>
        {step > 0 && (
          <div className="h-1 bg-slate-100">
            <div className={`h-1 bg-teal-600 ${barWidth}`} />
          </div>
        )}
      </header>

      {/* ───────── G1 예약 확인 ───────── */}
      {step === 0 && (
        <>
          <main className="flex-grow px-6 py-7 space-y-7">
            <section className="space-y-2">
              <p className="text-sm font-semibold text-teal-600">{L.home.kicker}</p>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 leading-snug">
                {L.home.title}
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed">{L.home.subtitle}</p>
            </section>

            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-lg text-slate-900">{booking.villaName}</h3>
                  {booking.complex && (
                    <p className="text-xs text-slate-400 mt-0.5">{booking.complex}</p>
                  )}
                </div>
                <span className="shrink-0 bg-teal-50 text-teal-700 text-[11px] font-bold px-2.5 py-1 rounded-full">
                  {L.home.badgeConfirmed}
                </span>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 text-sm">
                  <span className="material-symbols-outlined text-slate-400 text-[20px]">calendar_today</span>
                  <span className="text-slate-700 font-medium tabular-nums">
                    {guestDateRange(booking.checkIn, booking.checkOut, lang)}
                  </span>
                  <span className="ml-auto text-slate-500 font-semibold whitespace-nowrap">
                    {L.home.nights(booking.nights)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="material-symbols-outlined text-slate-400 text-[20px]">group</span>
                  <span className="text-slate-700 font-medium">{L.home.guests(booking.guestCount)}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="material-symbols-outlined text-slate-400 text-[20px]">restaurant</span>
                  <span className="text-slate-700 font-medium">
                    {booking.breakfastIncluded ? L.home.breakfastOn : L.home.breakfastOff}
                  </span>
                </div>
              </div>
            </section>

            {/* 4-step progress preview */}
            <section>
              <ol className="flex items-center justify-between">
                {STEP_KEYS.map((k, i) => (
                  <li key={k} className="contents">
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <span className="w-9 h-9 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm font-bold">
                        {i + 1}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400 text-center">
                        {L.steps[k]}
                      </span>
                    </div>
                    {i < STEP_KEYS.length - 1 && (
                      <span className="h-px flex-1 bg-slate-200 mt-[-18px]" />
                    )}
                  </li>
                ))}
              </ol>
            </section>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
              <span className="material-symbols-outlined text-slate-400 text-[20px]">lock</span>
              <p className="text-xs text-slate-500 leading-relaxed">{L.home.privacyNote}</p>
            </div>
          </main>
          <StickyBar>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-full h-14 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              {L.home.startCta}
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </StickyBar>
        </>
      )}

      {/* ───────── G2 비품 확인 ───────── */}
      {step === 1 && (
        <>
          <main className="flex-grow px-5 py-6 space-y-7">
            <p className="text-sm text-slate-500 leading-relaxed">{L.amenities.intro}</p>

            {amenityGroups.map((g) => (
              <section key={g.category} className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-teal-600 text-[20px]">
                    {CATEGORY_ICON[g.category] ?? "check_circle"}
                  </span>
                  {g.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {g.items.map((label, i) => (
                    <span
                      key={`${g.category}-${i}`}
                      className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-full px-3 py-1.5"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </section>
            ))}

            {minibar.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-500 text-[20px]">local_bar</span>
                    {L.amenities.minibarTitle}
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400">{L.amenities.minibarPaid}</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                  {minibar.map((m) => (
                    <div key={m.itemKey} className="flex items-center justify-between px-4 py-3.5">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                        <p className="text-[11px] text-slate-400">{L.amenities.stocked(m.qty)}</p>
                      </div>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">{guestVnd(m.priceVnd)}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-[18px]">info</span>
                  <p className="text-xs text-slate-500 leading-relaxed">{L.amenities.minibarNote}</p>
                </div>
              </section>
            )}

            <label className="flex items-center gap-3 bg-teal-50/60 border border-teal-100 rounded-xl px-4 py-4 cursor-pointer">
              <input
                type="checkbox"
                checked={amenitiesChecked}
                onChange={(e) => setAmenitiesChecked(e.target.checked)}
                className="w-6 h-6 rounded-md border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm font-semibold text-slate-800">{L.amenities.confirmCheck}</span>
            </label>
          </main>
          <StickyBar>
            <button
              type="button"
              disabled={!amenitiesChecked}
              onClick={() => setStep(2)}
              className="w-full h-14 bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
            >
              {L.next}
            </button>
          </StickyBar>
        </>
      )}

      {/* ───────── G3 동의서 서명 ───────── */}
      {step === 2 && (
        <>
          <main className="flex-grow px-5 py-6 space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-slate-900">{agreement.docTitle}</h2>
                <span className="shrink-0 bg-slate-100 text-slate-500 text-[11px] font-bold px-2.5 py-1 rounded-full">
                  {L.agreement.versionChip(agreement.version)}
                </span>
              </div>
              <LangChips current={lang} />
            </section>

            <section className="border border-slate-200 rounded-xl bg-slate-50/50 p-4 h-56 overflow-y-auto space-y-4 text-sm leading-relaxed text-slate-600">
              {agreement.clauses.map((c, i) => (
                <div key={c.key}>
                  <p className="font-bold text-slate-800 mb-1">
                    {i + 1}. {c.content.split(/[:：]/)[0].slice(0, 24)}
                  </p>
                  <p>{c.content}</p>
                </div>
              ))}
            </section>

            {signed ? (
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center gap-3">
                <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>
                  task_alt
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{L.agreement.alreadySigned}</p>
                  {signedVersion && (
                    <p className="text-[11px] text-slate-400">{L.agreement.alreadySignedAt(signedVersion)}</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <GuestSignaturePad
                  token={token}
                  labels={L.agreement}
                  onSigned={(url) => setSignatureUrl(url)}
                />
                {signatureUrl && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">check</span>
                    {L.agreement.signLabel}
                  </p>
                )}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreeChecked}
                    onChange={(e) => setAgreeChecked(e.target.checked)}
                    className="w-6 h-6 rounded-md border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm font-semibold text-slate-800">{L.agreement.agreeCheck}</span>
                </label>
                {agreementError && <p className="text-xs text-red-500">{agreementError}</p>}
              </>
            )}
          </main>
          <StickyBar>
            {signed ? (
              <button
                type="button"
                onClick={() => setStep(3)}
                className="w-full h-14 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
              >
                {L.next}
              </button>
            ) : (
              <button
                type="button"
                disabled={!signatureUrl || !agreeChecked || submittingAgreement}
                onClick={submitAgreement}
                className="w-full h-14 bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
              >
                {submittingAgreement ? L.agreement.submitting : L.agreement.submitCta}
              </button>
            )}
          </StickyBar>
        </>
      )}

      {/* ───────── G4 옵션 선택 ───────── */}
      {step === 3 && (
        <>
          <main className="flex-grow px-4 py-5 space-y-4 pb-40 bg-slate-50">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3">
              <span className="material-symbols-outlined text-amber-500 text-[20px]">info</span>
              <p className="text-xs text-amber-800 leading-relaxed">{L.addons.banner}</p>
            </div>

            {catalog.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">{L.result.empty}</p>
            ) : (
              catalog.map((c) => (
                <OptionCard
                  key={c.id}
                  item={c}
                  labels={L.addons}
                  lang={lang}
                  selection={
                    selections[c.id] ?? {
                      variantKey: c.variants[0]?.key ?? null,
                      addonKeys: [],
                      modifierKeys: [],
                      quantity: 0,
                    }
                  }
                  onChange={(next) => setSelections((prev) => ({ ...prev, [c.id]: next }))}
                  badgeText={typeBadgeLabel(c.type)}
                />
              ))
            )}
            {ordersError && <p className="text-xs text-red-500 text-center">{ordersError}</p>}
          </main>
          <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 py-3.5 space-y-3 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
            {anySelected && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">{L.addons.estTotal}</span>
                <span className="text-xl font-extrabold text-teal-600 tabular-nums">{grandTotalStr}</span>
              </div>
            )}
            <button
              type="button"
              disabled={submittingOrders}
              onClick={submitOrders}
              className="w-full h-14 bg-teal-600 disabled:opacity-60 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
            >
              {submittingOrders ? L.addons.requesting : anySelected ? L.addons.requestCta : L.addons.goNext}
            </button>
          </div>
        </>
      )}

      {/* ───────── G5 완료 ───────── */}
      {step === 4 && (
        <ResultScreen
          lang={lang}
          signed={signed}
          signedVersion={signedVersion}
          orders={requestedOrders}
        />
      )}

      {/* 푸터(G1·G5만) */}
      {(step === 0 || step === 4) && (
        <footer className="bg-slate-50 border-t border-slate-100 py-6 flex flex-col items-center gap-2 px-6 text-center">
          <span className="flex items-center gap-1.5 opacity-70">
            <VillaGoMark className="h-4 w-auto" />
            <VillaGoWordmark villa="text-slate-400" go="text-teal-600/70" />
          </span>
          {step === 0 && <p className="text-[11px] text-slate-400">{L.footerNote}</p>}
        </footer>
      )}
    </div>
  );
}

// ── 보조 컴포넌트/함수 ──

function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-100 px-6 py-4">
      {children}
    </div>
  );
}

function headerTitle(step: Step, L: (typeof GUEST_LABELS)[PublicLang]): string {
  switch (step) {
    case 0: return L.brandTagline;
    case 1: return L.amenities.title;
    case 2: return L.agreement.title;
    case 3: return L.addons.title;
    case 4: return L.result.title.replace(/\n/g, " ");
  }
}

const CATEGORY_ICON: Record<string, string> = {
  KITCHEN: "cooking",
  BATHROOM: "bathtub",
  APPLIANCE: "tv",
  MINIBAR: "local_bar",
};

function typeBadgeLabel(type: string): string {
  // 카탈로그명이 이미 표시되므로 배지는 짧은 타입 라벨(언어 중립 약어) — 미정의 타입은 원문
  const map: Record<string, string> = {
    MASSAGE: "SPA",
    BARBER: "BARBER",
    CAR_RENTAL: "CAR",
    MOTORBIKE_RENTAL: "BIKE",
    BBQ: "BBQ",
    TICKET: "TICKET",
    GUIDE: "GUIDE",
    BREAKFAST: "BREAKFAST",
  };
  return map[type] ?? type;
}

/** 언어 칩(동의서 본문 언어 전환) — 선택 시 ?lang= 갱신해 서버 재렌더(조항 번역 반영). */
function LangChips({ current }: { current: PublicLang }) {
  const chips: { lang: PublicLang; label: string }[] = [
    { lang: "ko", label: "한국어" },
    { lang: "vi", label: "Tiếng Việt" },
    { lang: "en", label: "English" },
    { lang: "zh", label: "中文" },
    { lang: "ru", label: "Русский" },
  ];
  const go = (lang: PublicLang) => {
    if (typeof window === "undefined" || lang === current) return;
    document.cookie = `p-locale=${lang}; path=/; max-age=31536000; samesite=lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    url.hash = "agreement";
    window.location.href = url.toString();
  };
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c.lang}
          type="button"
          onClick={() => go(c.lang)}
          className={`text-xs rounded-full px-3 py-1.5 ${
            c.lang === current
              ? "font-bold bg-teal-600 text-white"
              : "font-medium bg-slate-50 border border-slate-200 text-slate-600"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function ResultScreen({
  lang,
  signed,
  signedVersion,
  orders,
}: {
  lang: PublicLang;
  signed: boolean;
  signedVersion: string | null;
  orders: GuestRequestedOrder[];
}) {
  const L = GUEST_LABELS[lang];
  const total = useMemo(() => {
    let krw = 0;
    let hasKrw = false;
    let vnd = 0n;
    let hasVnd = false;
    for (const o of orders) {
      if (o.priceKrw != null) { krw += o.priceKrw; hasKrw = true; }
      if (o.priceVnd != null && o.priceVnd !== "") { vnd += BigInt(o.priceVnd); hasVnd = true; }
    }
    return { krw, hasKrw, vnd, hasVnd };
  }, [orders]);
  const totalStr = total.hasKrw
    ? guestPrice(total.krw, null, lang)
    : total.hasVnd
      ? guestVnd(total.vnd.toString())
      : null;

  const statusLabel = (s: string) =>
    s === "REQUESTED" ? L.result.statusPending : s === "CONFIRMED" ? L.result.statusConfirmed : L.result.statusOther;

  return (
    <main className="flex-grow px-5 py-7 space-y-6 bg-white">
      <section className="text-center space-y-3 pt-2">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-50 rounded-full">
          <span className="material-symbols-outlined text-green-600 text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 whitespace-pre-line">
          {L.result.title}
        </h2>
        <p className="text-sm text-slate-500">{L.result.subtitle}</p>
      </section>

      {signed && (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>
            task_alt
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">{L.result.agreementDone}</p>
            {signedVersion && (
              <p className="text-[11px] text-slate-400">{L.result.agreementDoneAt(signedVersion)}</p>
            )}
          </div>
        </section>
      )}

      {orders.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800">{L.result.requestedTitle}</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3.5">
                <p className="text-sm font-semibold text-slate-800">
                  {o.name} <span className="text-slate-400 font-normal">× {o.quantity}</span>
                </p>
                <div className="flex items-center gap-2">
                  <span className="bg-amber-50 text-amber-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {statusLabel(o.status)}
                  </span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {guestPrice(o.priceKrw, o.priceVnd, lang)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {totalStr && (
            <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50">
              <span className="text-sm font-semibold text-slate-600">{L.result.estTotal}</span>
              <span className="text-base font-extrabold text-teal-600 tabular-nums">{totalStr}</span>
            </div>
          )}
        </section>
      )}

      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
        <span className="material-symbols-outlined text-slate-400 text-[20px]">payments</span>
        <p className="text-xs text-slate-500 leading-relaxed">{L.result.settleNote}</p>
      </div>
    </main>
  );
}
