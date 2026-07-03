"use client";

// app/g/_components/guest-flow.tsx — 게스트 셀프 체크인 흐름 (ADR-0019 v2 게스트 UI 개편)
//   G1 예약확인 → G2 비품 → G3 동의서 서명 → G4 여권 사진(신규) → G5 완료. 단계는 클라 state(라우트 전환 없음).
//   옵션 선택은 흐름에서 분리 → 완료 화면의 "부가 옵션 신청하기" → /g/[token]/options.
//   ★마진 비공개: 판매가만 렌더(미니바=KRW 환율 파생). 원가·마진·환산내역·타예약 0(서버 props에 애초 없음).
import { useState } from "react";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { type PublicLang } from "@/lib/public-i18n";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import GuestSignaturePad from "./guest-signature-pad";
import GuestPassportStep from "./guest-passport-step";
import { guestVndPrice, guestDateRange, guestKrw } from "./guest-format";
import type { GuestFlowProps, GuestBookingView } from "./types";

type Step = 0 | 1 | 2 | 3 | 4; // 0=G1 예약, 1=G2 비품, 2=G3 동의, 3=G4 여권, 4=G5 완료
const STEP_KEYS = ["amenities", "agreement", "passport", "done"] as const;

export default function GuestFlow(props: GuestFlowProps) {
  const { token, lang, booking, amenityGroups, minibar, agreement } = props;
  // 미니바 가격은 VND 기본 표기로 통일(부가옵션 페이지와 동일) — 환율 파생 KRW 미사용
  const L = GUEST_LABELS[lang];

  const [step, setStep] = useState<Step>(0);
  const [amenitiesChecked, setAmenitiesChecked] = useState(false);
  const [signed, setSigned] = useState(props.alreadySigned);
  const [signedVersion, setSignedVersion] = useState<string | null>(props.signedVersion);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submittingAgreement, setSubmittingAgreement] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);

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
          <h1 className="font-bold text-base text-slate-900 ml-1 truncate">{headerTitle(step, L)}</h1>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {step > 0 && (
              <span className="text-xs font-bold text-slate-400 tabular-nums">
                {L.stepCount(Math.min(step, 4), 4)}
              </span>
            )}
            <PublicLangSelector current={lang} />
          </div>
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
                {/* 숙박 요금 — 직접 게스트만 노출(로더에서 게이트, 파트너/공급자 예약은 null) */}
                {(booking.stayChargeVnd || booking.stayChargeKrw != null) && (
                  <div className="flex items-center gap-3 text-sm pt-1 border-t border-slate-100">
                    <span className="material-symbols-outlined text-slate-400 text-[20px]">payments</span>
                    <span className="text-slate-500">{L.home.stayChargeLabel}</span>
                    <span className="ml-auto text-slate-900 font-bold whitespace-nowrap">
                      {booking.stayChargeKrw != null
                        ? guestKrw(booking.stayChargeKrw, lang)
                        : guestVndPrice(booking.stayChargeVnd)}
                    </span>
                  </div>
                )}
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
                    <div key={m.itemKey} className="flex items-center justify-between px-4 py-3.5 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{m.name}</p>
                        {/* #4 비치 수량 — 미니바 항목마다 노출 */}
                        <p className="text-[11px] text-slate-400">{L.amenities.stocked(m.qty)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-slate-900 tabular-nums">
                        {guestVndPrice(m.priceVnd)}
                      </span>
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
              <PublicLangSelector current={lang} />
            </section>

            <section className="border border-slate-200 rounded-xl bg-slate-50/50 p-4 h-56 overflow-y-auto space-y-4 text-sm leading-relaxed text-slate-600">
              {agreement.clauses.map((c, i) => (
                <div key={c.key}>
                  {/* 조항 = 번호 + 전문 1회 — content 앞부분을 절단한 가짜 제목은 중복·혼란(consumer-bugs #6) */}
                  <p>
                    <span className="font-bold text-slate-800">{i + 1}.</span> {c.content}
                  </p>
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

      {/* ───────── G4 여권 사진(신규) ───────── */}
      {step === 3 && (
        <>
          <main className="flex-grow px-5 py-6">
            <GuestPassportStep
              token={token}
              guestCount={booking.guestCount}
              labels={L.passport}
            />
          </main>
          <StickyBar>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="w-full h-14 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
              >
                {L.passport.finishCta}
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="w-full h-10 text-slate-400 text-sm font-semibold"
              >
                {L.passport.skip}
              </button>
            </div>
          </StickyBar>
        </>
      )}

      {/* ───────── G5 완료 ───────── */}
      {step === 4 && (
        <ResultScreen
          token={token}
          lang={lang}
          signed={signed}
          signedVersion={signedVersion}
          booking={booking}
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

/** 와이파이 SSID·비번 복사 버튼 — 클립보드 API(미지원 시 조용히 무시). */
function CopyButton({ value, copyLabel, copiedLabel }: { value: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 미지원 — 무시(텍스트는 그대로 보임) */
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 active:scale-95"
    >
      <span className="material-symbols-outlined text-[15px]">{copied ? "check" : "content_copy"}</span>
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}

function headerTitle(step: Step, L: (typeof GUEST_LABELS)[PublicLang]): string {
  switch (step) {
    case 0: return L.brandTagline;
    case 1: return L.amenities.title;
    case 2: return L.agreement.title;
    case 3: return L.passport.title;
    case 4: return L.result.title.replace(/\n/g, " ");
  }
}

const CATEGORY_ICON: Record<string, string> = {
  KITCHEN: "cooking",
  BATHROOM: "bathtub",
  APPLIANCE: "tv",
  MINIBAR: "local_bar",
};


function ResultScreen({
  token,
  lang,
  signed,
  signedVersion,
  booking,
}: {
  token: string;
  lang: PublicLang;
  signed: boolean;
  signedVersion: string | null;
  booking: GuestBookingView;
}) {
  const L = GUEST_LABELS[lang];
  // 부가 옵션은 신청 내역 허브(/orders)로 진입 — 거기서 요청 확인 + "부가 옵션 신청" 버튼으로 신청 폼(/options)으로.
  const ordersHref = `/g/${token}/orders${lang === "ko" ? "" : `?lang=${lang}`}`;

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

      {/* 출입 정보(A1) — 주소·지도·와이파이. 비번은 서명 완료(signed) 후에만. */}
      {(booking.address || booking.wifiSsid) && (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span className="material-symbols-outlined text-teal-600 text-[20px]">key</span>
            {L.access.title}
          </h3>

          {booking.address && (
            <div className="space-y-1.5">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-slate-400 text-[20px] mt-0.5">location_on</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-slate-400">{L.access.addressLabel}</p>
                  <p className="text-sm text-slate-700 leading-relaxed break-words">{booking.address}</p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-sm font-semibold text-teal-600 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">map</span>
                    {L.access.mapLink}
                  </a>
                </div>
              </div>
            </div>
          )}

          {booking.wifiSsid && (
            <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
              <span className="material-symbols-outlined text-slate-400 text-[20px] mt-0.5">wifi</span>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">{L.access.wifiSsidLabel}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800 break-all">{booking.wifiSsid}</p>
                    <CopyButton value={booking.wifiSsid} copyLabel={L.access.copy} copiedLabel={L.access.copied} />
                  </div>
                </div>
                {/* 비번은 동의서 서명 후에만 노출 */}
                {signed ? (
                  booking.wifiPassword && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">{L.access.wifiPwLabel}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900 tabular-nums break-all">{booking.wifiPassword}</p>
                        <CopyButton value={booking.wifiPassword} copyLabel={L.access.copy} copiedLabel={L.access.copied} />
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    <span className="material-symbols-outlined text-slate-400 text-[16px]">lock</span>
                    <p className="text-[11px] text-slate-500">{L.access.wifiLocked}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 부가 옵션 신청 유도 — 옵션 페이지로 이동 */}
      <section className="bg-gradient-to-br from-teal-50 to-white border border-teal-100 rounded-2xl p-5 space-y-3">
        <p className="text-sm text-slate-500 leading-relaxed">{L.result.optionsHint}</p>
        <a
          href={ordersHref}
          className="w-full h-14 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add_shopping_cart</span>
          {L.result.openOptionsCta}
        </a>
      </section>

      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
        <span className="material-symbols-outlined text-slate-400 text-[20px]">payments</span>
        <p className="text-xs text-slate-500 leading-relaxed">{L.result.settleNote}</p>
      </div>
    </main>
  );
}
