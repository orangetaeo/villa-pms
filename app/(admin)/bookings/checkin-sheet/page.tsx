// /bookings/checkin-sheet — 오늘의 체크인 시트 일괄 프린트 (T-admin-checkin-sheet)
// RSC: prisma 직접 조회 ((admin) 레이아웃 ADMIN 가드 하). 예약 1건 = A4 1페이지.
// 마진 비공개 — 판매가·원가는 select·렌더 어디에도 없음. 보증금만 노출.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookingStatus, type Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString, parseUtcDateOnly, addUtcDays } from "@/lib/date-vn";
import { todayInVillaTimezone } from "@/lib/timeline";
import { minutesToHHMM } from "@/lib/sales-display";
import { formatThousands } from "@/lib/format";
import {
  AGREEMENT_CLAUSES,
  AGREEMENT_DOC_TITLE,
  AGREEMENT_VERSION,
  buildClauseOrder,
  isAgreementLang,
  type AgreementLang,
} from "@/lib/agreement";
import PrintButton from "./print-button";
import AgreementLangSelect from "./agreement-lang-select";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCheckinSheet");
  return { title: `${t("title")} — Villa PMS` };
}

function money(amount: number, currency: Currency): string {
  const n = formatThousands(amount);
  return currency === "KRW" ? `${n}원` : currency === "USD" ? `$${n}` : `${n}₫`;
}

export default async function CheckinSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; lang?: string }>;
}) {
  const t = await getTranslations("adminCheckinSheet");
  const tb = await getTranslations("adminBookings");
  const params = await searchParams;

  const today = todayInVillaTimezone();
  const todayStr = toDateOnlyString(today);
  const dateStr =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayStr;
  const date = parseUtcDateOnly(dateStr) ?? today;

  // 게스트 언어 선택 — 기본 vi. 인쇄 동의서는 한국어(기록용) + 게스트 언어 병기(같으면 1개).
  const guestLang: AgreementLang = isAgreementLang(params.lang) ? params.lang : "vi";
  const agreementLangs: AgreementLang[] = guestLang === "ko" ? ["ko"] : ["ko", guestLang];

  // 금일 체크인 = CONFIRMED (기존 "오늘 체크인" 프리셋·통계와 동일 의미)
  const bookings = await prisma.booking.findMany({
    where: { checkIn: date, status: BookingStatus.CONFIRMED },
    orderBy: [{ villa: { complex: "asc" } }, { checkIn: "asc" }],
    select: {
      id: true,
      channel: true,
      agencyName: true,
      guestName: true,
      guestCount: true,
      guestPhone: true,
      guestRoster: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      breakfastIncluded: true,
      // 보증금만 — 판매가(totalSale*)·원가(supplierCostVnd)는 절대 select 금지 (마진 비공개)
      depositAmount: true,
      depositCurrency: true,
      depositStatus: true,
      villa: {
        select: {
          name: true,
          complex: true,
          address: true,
          hasPool: true,
          maxGuests: true,
          checkInTime: true,
          checkOutTime: true,
          // WiFi — ADMIN 전용 체크인 화면이라 노출 OK (/p 공개페이지엔 절대 금지)
          wifiSsid: true,
          wifiPassword: true,
        },
      },
      checkInRecord: { select: { signatureUrl: true } },
    },
  });

  const fmt = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");
  const prevStr = toDateOnlyString(addUtcDays(date, -1));
  const nextStr = toDateOnlyString(addUtcDays(date, 1));
  const isToday = dateStr === todayStr;
  // 날짜 이동 링크에 선택 언어 보존 (기본 vi는 생략)
  const langQs = guestLang === "vi" ? "" : `&lang=${guestLang}`;

  const navLink =
    "inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors";

  return (
    <div className="space-y-6">
      {/* 툴바 — 인쇄 시 숨김 */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/bookings" className="text-sm text-slate-400 hover:text-white">
            ← {tb("list.title")}
          </Link>
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/bookings/checkin-sheet?date=${prevStr}${langQs}`} className={navLink} aria-label={t("prevDay")}>
            <span className="material-symbols-outlined text-base">chevron_left</span>
          </Link>
          <div className="px-3 py-2 rounded-lg bg-admin-card border border-slate-700 text-sm font-bold text-white tabular-nums whitespace-nowrap">
            {fmt(date)}
            {isToday && <span className="ml-2 text-[11px] text-admin-primary">{t("today")}</span>}
          </div>
          <Link href={`/bookings/checkin-sheet?date=${nextStr}${langQs}`} className={navLink} aria-label={t("nextDay")}>
            <span className="material-symbols-outlined text-base">chevron_right</span>
          </Link>
          {!isToday && (
            <Link
              href={`/bookings/checkin-sheet${langQs ? `?${langQs.slice(1)}` : ""}`}
              className="text-sm text-slate-400 hover:text-white underline px-1"
            >
              {t("today")}
            </Link>
          )}
          <AgreementLangSelect value={guestLang} label={t("langSelect")} />
          <PrintButton label={t("printButton")} />
        </div>
      </div>

      <p className="no-print text-sm text-slate-500">
        {t("count", { n: bookings.length })}
      </p>

      {bookings.length === 0 ? (
        <div className="no-print bg-admin-card rounded-xl border border-slate-800 p-12 text-center text-slate-400">
          {t("empty")}
        </div>
      ) : (
        <div className="print-sheet space-y-6">
          {bookings.map((b) => {
            const v = b.villa;
            const clauseOrder = buildClauseOrder(v.hasPool);
            const hasDeposit = b.depositAmount != null && b.depositCurrency != null;
            const depositHeld = b.depositStatus === "HELD";
            const alreadySigned = !!b.checkInRecord?.signatureUrl;

            return (
              <article
                key={b.id}
                className="print-page bg-white text-slate-900 rounded-xl border border-slate-300 shadow-sm overflow-hidden mx-auto max-w-3xl"
              >
                {/* 헤더 */}
                <header className="flex items-start justify-between gap-4 px-7 py-5 border-b-2 border-slate-900">
                  <div>
                    <h2 className="text-2xl font-black leading-tight">{v.name}</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {[v.complex, v.address].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      {t("sheet.checkInDate")}
                    </p>
                    <p className="text-xl font-black tabular-nums">{fmt(b.checkIn)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">#{b.id.slice(-8)}</p>
                  </div>
                </header>

                <div className="px-7 py-5 space-y-5">
                  {/* ① 예약 정보 */}
                  <section>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                      {t("sheet.reservation")}
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <Field label={t("sheet.guest")} value={b.guestName} />
                      <Field
                        label={t("sheet.guests")}
                        value={t("sheet.guestsValue", { n: b.guestCount, max: v.maxGuests })}
                      />
                      {b.guestRoster && (
                        <div className="col-span-2">
                          <dt className="text-[11px] uppercase tracking-widest text-slate-400">
                            {t("sheet.roster")}
                          </dt>
                          <dd className="font-semibold whitespace-pre-wrap">{b.guestRoster}</dd>
                        </div>
                      )}
                      <Field label={t("sheet.phone")} value={b.guestPhone || "—"} />
                      <Field
                        label={t("sheet.channel")}
                        value={
                          b.agencyName
                            ? `${b.agencyName} (${tb(`channels.${b.channel}`)})`
                            : tb(`channels.${b.channel}`)
                        }
                      />
                      <Field
                        label={t("sheet.stay")}
                        value={`${fmt(b.checkIn)} → ${fmt(b.checkOut)} (${t("sheet.nights", { n: b.nights })})`}
                      />
                      <Field
                        label={t("sheet.times")}
                        value={`${minutesToHHMM(v.checkInTime)} / ${minutesToHHMM(v.checkOutTime)}`}
                      />
                      <Field
                        label={t("sheet.breakfast")}
                        value={b.breakfastIncluded ? t("sheet.yes") : t("sheet.no")}
                      />
                    </dl>
                  </section>

                  {/* ② 보증금 */}
                  <section>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                      {t("sheet.deposit")}
                    </h3>
                    {!hasDeposit ? (
                      <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {t("sheet.depositNone")}
                      </div>
                    ) : depositHeld ? (
                      <div className="rounded-lg border-2 border-green-600 bg-green-50 px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-green-800">{t("sheet.depositHeld")}</span>
                        <span className="text-lg font-black tabular-nums text-green-800">
                          {money(b.depositAmount!, b.depositCurrency!)}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-lg border-2 border-red-600 bg-red-50 px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-black text-red-700 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">priority_high</span>
                          {t("sheet.depositRequired")}
                        </span>
                        <span className="text-xl font-black tabular-nums text-red-700">
                          {money(b.depositAmount!, b.depositCurrency!)}
                        </span>
                      </div>
                    )}
                  </section>

                  {/* ③ WiFi */}
                  {(v.wifiSsid || v.wifiPassword) && (
                    <section>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                        {t("sheet.wifi")}
                      </h3>
                      <div className="flex flex-wrap gap-x-10 gap-y-1 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3">
                        {v.wifiSsid && (
                          <div>
                            <span className="text-[11px] uppercase tracking-widest text-slate-400">
                              {t("sheet.wifiId")}
                            </span>
                            <p className="text-lg font-black tabular-nums">{v.wifiSsid}</p>
                          </div>
                        )}
                        {v.wifiPassword && (
                          <div>
                            <span className="text-[11px] uppercase tracking-widest text-slate-400">
                              {t("sheet.wifiPw")}
                            </span>
                            <p className="text-lg font-black tabular-nums">{v.wifiPassword}</p>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* ④ 동의서 + 서명란 — 한국어(기록용) + 게스트 언어 병기 */}
                  <section>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center justify-between">
                      <span>{t("sheet.agreement")}</span>
                      <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">
                        v{AGREEMENT_VERSION}
                      </span>
                    </h3>
                    <div className="space-y-3">
                      {agreementLangs.map((lang) => (
                        <div key={lang}>
                          <p className="text-sm font-bold mb-1">{AGREEMENT_DOC_TITLE[lang]}</p>
                          <ol className="text-[11px] leading-relaxed text-slate-600 space-y-1">
                            {clauseOrder.map((key, i) => (
                              <li key={key}>
                                {i + 1}. {AGREEMENT_CLAUSES[key][lang]}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>

                    {alreadySigned ? (
                      <p className="mt-3 text-xs font-bold text-green-700">{t("sheet.alreadySigned")}</p>
                    ) : (
                      <div className="mt-4 grid grid-cols-2 gap-6">
                        <SignBox label={t("sheet.guestSign")} />
                        <SignBox label={t("sheet.staffConfirm")} />
                      </div>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      {t("sheet.signDate")}: ____________________
                    </p>
                  </section>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-widest text-slate-400">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function SignBox({ label }: { label: string }) {
  return (
    <div>
      <div className="h-16 border-b border-slate-400"></div>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
