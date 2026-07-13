// /g/[token]/receipt — 게스트 정산 내역(영수증) (비로그인 공개, T-guest-settlement-receipt)
//
// ★ 누수 차단(원칙2): 게스트=한국 여행객. 자기 예약 하나의 체크아웃 정산 결과만.
//   판매가·수납액만(원가·마진·벤더·타예약 0 — 로더가 select 단계에서 배제).
//   토큰 없음=404. 만료·회수=안내 화면. 체크아웃 전=/g/[token] redirect. 언어: ?lang= > p-locale 쿠키 > ko.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loadGuestReceipt } from "@/lib/guest-receipt";
import { PUBLIC_LOCALE_COOKIE, resolvePublicLang, type PublicLang } from "@/lib/public-i18n";
import { pickI18n } from "@/lib/service-display";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { formatThousands, formatDateTime } from "@/lib/format";
import { guestVnd, guestKrw, guestDateRange } from "../../_components/guest-format";
import { GuestExpiredView } from "../../_components/guest-expired-view";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

export const metadata: Metadata = { title: "정산 내역 — Villa Go" };

async function getContactSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["CONTACT_KAKAO_URL", "CONTACT_PHONE"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { kakaoUrl: get("CONTACT_KAKAO_URL"), phone: get("CONTACT_PHONE") };
}

// 보증금·수납 통화별 표기 — VND=₫, KRW=원/₩, USD=$. (판매가 표기 규칙과 동일 접미)
function money(amount: string | number, currency: string | null, lang: PublicLang): string {
  const n = formatThousands(amount);
  if (currency === "KRW") return `${n}${lang === "ko" ? "원" : "₩"}`;
  if (currency === "USD") return `$${n}`;
  return `${n}₫`; // VND 기본
}

const METHOD_LABEL = (
  method: string,
  L: (typeof GUEST_LABELS)[PublicLang]["receipt"]
): string =>
  method === "CASH"
    ? L.methodCash
    : method === "BANK_TRANSFER"
      ? L.methodBank
      : method === "DEPOSIT"
        ? L.methodDeposit
        : L.methodOther;

export default async function GuestReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;

  const data = await loadGuestReceipt(token);
  if (!data) notFound();

  if (data.state !== "OK") {
    const contact = await getContactSettings();
    return <GuestExpiredView lang={lang} kakaoUrl={contact.kakaoUrl} phone={contact.phone} />;
  }
  // 체크아웃 전(정산 없음) — 체크인 포털로 되돌린다.
  if (!data.ready || !data.booking) {
    redirect(`/g/${token}${suffix}`);
  }

  const L = GUEST_LABELS[lang];
  const R = L.receipt;
  const booking = data.booking;

  // 부가서비스 표시명 — 카탈로그 로케일 해석(없으면 서비스 타입 라벨 폴백).
  const serviceName = (s: (typeof data.services)[number]): string =>
    s.nameKo
      ? pickI18n(s.nameKo, s.nameI18n, lang)
      : (L.serviceTypes[s.type as keyof typeof L.serviceTypes] ?? s.type);

  const priceOf = (priceKrw: number | null, priceVnd: string | null): string =>
    priceKrw != null && priceKrw > 0
      ? guestKrw(priceKrw, lang)
      : priceVnd
        ? guestVnd(priceVnd)
        : "—";

  // 총 이용 금액 — record 캐시(guestChargeVnd = 미니바 + VND옵션, guestChargeKrw = KRW옵션).
  const chargeVnd = data.usage.guestChargeVnd;
  const chargeKrw = data.usage.guestChargeKrw;
  const fx = data.usage.fxVndPerKrw;
  // 환산 합계(≈) — VND·KRW 둘 다 있고 환율 있을 때만. 전부 VND로 환산 표기.
  const approxVnd =
    fx && chargeVnd && chargeKrw != null && chargeKrw > 0
      ? (BigInt(chargeVnd) + BigInt(Math.round(chargeKrw * fx))).toString()
      : null;

  const dep = data.deposit;
  const st = data.settlement;

  // 미수납 잔액(≈) — 청구 환산 − 결제 환산(수납 라인 우선, 구 데이터는 settled* 폴백).
  //   환산 불가 통화가 끼면(환율 스냅샷 없음) 계산 생략(오표기 방지). 끝전 1만₫ 면제(운영자 화면과 동일 규칙).
  const outstandingVnd = (() => {
    const fxUsd = data.usage.fxVndPerUsd;
    const kr = chargeKrw ?? 0;
    if (kr > 0 && !fx) return null;
    const charge = BigInt(chargeVnd ?? "0") + (kr > 0 && fx ? BigInt(Math.round(kr * fx)) : 0n);
    let paidVnd = 0n;
    let paidKrw = 0;
    let paidUsd = 0;
    if (st.lines.length > 0) {
      for (const l of st.lines) {
        if (l.currency === "VND") paidVnd += BigInt(l.amount);
        else if (l.currency === "KRW") paidKrw += Number(l.amount);
        else if (l.currency === "USD") paidUsd += Number(l.amount);
      }
    } else {
      paidVnd = BigInt(st.settledVnd ?? "0");
      paidKrw = st.settledKrw ?? 0;
      paidUsd = st.settledUsd ?? 0;
    }
    if ((paidKrw > 0 && !fx) || (paidUsd > 0 && !fxUsd)) return null;
    const paid =
      paidVnd +
      (paidKrw > 0 && fx ? BigInt(Math.round(paidKrw * fx)) : 0n) +
      (paidUsd > 0 && fxUsd ? BigInt(Math.round(paidUsd * fxUsd)) : 0n);
    const rest = charge - paid;
    return rest > 10_000n ? rest.toString() : null;
  })();

  return (
    <div className="bg-slate-50 text-slate-900 antialiased">
      <div className="max-w-md mx-auto min-h-screen bg-white flex flex-col shadow-2xl">
        {/* 헤더 */}
        <header className="w-full sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-100">
          <div className="flex items-center h-14 px-4">
            <span className="flex items-center gap-1.5">
              <VillaGoMark className="h-6 w-auto" />
              <VillaGoWordmark className="text-lg" villa="text-slate-900" go="text-teal-600" />
            </span>
            <div className="ml-auto">
              <PublicLangSelector current={lang} />
            </div>
          </div>
        </header>

        <main className="flex-grow px-5 py-6 space-y-6">
          {/* 제목 */}
          <section className="space-y-1">
            <div className="inline-flex items-center gap-2">
              <span className="material-symbols-outlined text-teal-600">receipt_long</span>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{R.pageTitle}</h1>
            </div>
            <p className="text-sm text-slate-500">{R.pageSubtitle}</p>
          </section>

          {/* 예약 요약 */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
            <div>
              <h2 className="font-bold text-lg text-slate-900">{booking.villaName}</h2>
              {booking.complex && <p className="text-xs text-slate-400 mt-0.5">{booking.complex}</p>}
            </div>
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
              <span className="material-symbols-outlined text-slate-400 text-[20px]">person</span>
              <span className="text-slate-500">{R.guestLabel}</span>
              <span className="ml-auto text-slate-800 font-semibold">{booking.guestName}</span>
            </div>
          </section>

          {/* 미니바 이용 내역 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500 text-[20px]">local_bar</span>
              {R.minibarTitle}
            </h3>
            {data.minibar.length === 0 ? (
              <p className="text-sm text-slate-400 px-1">{R.minibarEmpty}</p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {data.minibar.map((m, i) => (
                  <div key={`${m.nameKo}-${i}`} className="flex items-center justify-between px-4 py-3 gap-3">
                    <div className="min-w-0">
                      {/* nameKo=체크아웃 시점 스냅샷(ko 고정) */}
                      <p className="text-sm font-semibold text-slate-800 truncate">{m.nameKo}</p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {R.qtyUnit(m.consumedQty)} · {guestVnd(m.unitPriceVnd)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-slate-900 tabular-nums">
                      {guestVnd(m.lineVnd)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 부가서비스 내역 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-teal-600 text-[20px]">room_service</span>
              {R.serviceTitle}
            </h3>
            {data.services.length === 0 ? (
              <p className="text-sm text-slate-400 px-1">{R.serviceEmpty}</p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {data.services.map((s) => {
                  const opts = s.selectedOptions
                    .map((o) => pickI18n(o.labelKo, o.labelI18n ?? null, lang))
                    .filter(Boolean);
                  return (
                    <div key={s.id} className="flex items-start justify-between px-4 py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {serviceName(s)}
                          {s.quantity > 1 && (
                            <span className="text-slate-400 font-normal"> × {s.quantity}</span>
                          )}
                        </p>
                        {opts.length > 0 && (
                          <p className="text-[11px] text-slate-400">{opts.join(" · ")}</p>
                        )}
                        {/* 이용일·시각 (테오 요청 2026-07-13) — 날짜는 언어중립 숫자 표기 */}
                        {(s.serviceDate || s.serviceTime) && (
                          <p className="text-[11px] text-slate-400 tabular-nums flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">event</span>
                            {[s.serviceDate?.replaceAll("-", "."), s.serviceTime].filter(Boolean).join(" ")}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-bold text-slate-900 tabular-nums">
                        {priceOf(s.priceKrw, s.priceVnd)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 총 이용 금액 */}
          <section className="bg-slate-900 text-white rounded-2xl p-5 space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">{R.usageTitle}</h3>
            <div className="space-y-1.5">
              {chargeVnd && (
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-400">VND</span>
                  <span className="text-xl font-extrabold tabular-nums">{guestVnd(chargeVnd)}</span>
                </div>
              )}
              {chargeKrw != null && chargeKrw > 0 && (
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-400">KRW</span>
                  <span className="text-xl font-extrabold tabular-nums">{guestKrw(chargeKrw, lang)}</span>
                </div>
              )}
              {!chargeVnd && (chargeKrw == null || chargeKrw === 0) && (
                <span className="text-xl font-extrabold tabular-nums">{guestVnd("0")}</span>
              )}
            </div>
            {approxVnd && (
              <p className="text-[11px] text-slate-400 tabular-nums pt-1">
                {R.usageApprox(guestVnd(approxVnd))}
              </p>
            )}
          </section>

          {/* 보증금 정산 */}
          {dep && (
            <section className="space-y-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-500 text-[20px]">savings</span>
                {R.depositTitle}
              </h3>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden text-sm">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-500">{R.depositReceived}</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {dep.amount != null ? money(dep.amount, dep.currency, lang) : "—"}
                  </span>
                </div>
                {/* 신 데이터: 상계·파손 분리 표기 / 구 데이터: 차감 총액만 */}
                {dep.hasSettlementLines && BigInt(dep.offsetVnd) > 0n && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-slate-500">{R.depositOffset}</span>
                    <span className="font-semibold text-slate-600 tabular-nums">
                      − {money(dep.offsetVnd, "VND", lang)}
                    </span>
                  </div>
                )}
                {(dep.damageFound || BigInt(dep.damageDeductVnd) > 0n) &&
                  (dep.hasSettlementLines ? (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-slate-500">{R.damageDeduct}</span>
                      <span className="font-semibold text-rose-600 tabular-nums">
                        − {money(dep.damageDeductVnd, "VND", lang)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-slate-500">{R.totalDeduct}</span>
                      <span className="font-semibold text-rose-600 tabular-nums">
                        − {money(dep.totalDeductVnd, "VND", lang)}
                      </span>
                    </div>
                  ))}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                  <span className="font-bold text-slate-800">{R.refund}</span>
                  <span className="font-extrabold text-teal-700 tabular-nums">
                    {dep.refundAmount != null ? money(dep.refundAmount, dep.currency, lang) : "—"}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* 결제 내역(수단별) */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-slate-500 text-[20px]">payments</span>
              {R.paymentTitle}
            </h3>
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden text-sm">
              {st.lines.length > 0 ? (
                st.lines.map((l, i) => (
                  <div key={`${l.method}-${l.currency}-${i}`} className="flex items-center justify-between px-4 py-3">
                    <span className="text-slate-500">{METHOD_LABEL(l.method, R)}</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {money(l.amount, l.currency, lang)}
                    </span>
                  </div>
                ))
              ) : (
                // 구 데이터 폴백 — 통화별 실수납 합계만(수단 분리 없음)
                <>
                  {st.settledVnd && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-slate-500">{R.paidLabel} (VND)</span>
                      <span className="font-semibold text-slate-800 tabular-nums">{money(st.settledVnd, "VND", lang)}</span>
                    </div>
                  )}
                  {st.settledKrw != null && st.settledKrw > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-slate-500">{R.paidLabel} (KRW)</span>
                      <span className="font-semibold text-slate-800 tabular-nums">{money(st.settledKrw, "KRW", lang)}</span>
                    </div>
                  )}
                  {st.settledUsd != null && st.settledUsd > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-slate-500">{R.paidLabel} (USD)</span>
                      <span className="font-semibold text-slate-800 tabular-nums">{money(st.settledUsd, "USD", lang)}</span>
                    </div>
                  )}
                  {!st.settledVnd &&
                    (st.settledKrw == null || st.settledKrw === 0) &&
                    (st.settledUsd == null || st.settledUsd === 0) && (
                      <div className="px-4 py-3 text-slate-400">—</div>
                    )}
                </>
              )}
              {/* 미수납 잔액 — 청구가 결제(보증금 차감 포함)로 다 채워지지 않은 경우만 (구 데이터 대비) */}
              {outstandingVnd && (
                <div className="flex items-center justify-between px-4 py-3 bg-rose-50">
                  <span className="font-bold text-rose-700">{R.outstandingLabel}</span>
                  <span className="font-extrabold text-rose-700 tabular-nums">
                    ≈ {money(outstandingVnd, "VND", lang)}
                  </span>
                </div>
              )}
            </div>
            {st.settledAt && (
              <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400">
                <span className="material-symbols-outlined text-[15px]">schedule</span>
                <span>
                  {R.settledAtLabel}: <span className="tabular-nums">{formatDateTime(new Date(st.settledAt))}</span>
                </span>
              </div>
            )}
          </section>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
            <span className="material-symbols-outlined text-slate-400 text-[20px]">info</span>
            <p className="text-xs text-slate-500 leading-relaxed">{R.note}</p>
          </div>
        </main>

        <footer className="bg-slate-50 border-t border-slate-100 py-6 flex flex-col items-center gap-2 px-6 text-center">
          <span className="flex items-center gap-1.5 opacity-70">
            <VillaGoMark className="h-4 w-auto" />
            <VillaGoWordmark villa="text-slate-400" go="text-teal-600/70" />
          </span>
          <p className="text-[11px] text-slate-400">{L.footerNote}</p>
        </footer>
      </div>
    </div>
  );
}
