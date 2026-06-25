// /bookings/checkin-sheet — 오늘의 체크인 시트 일괄 프린트 (T-admin-checkin-sheet)
// RSC: prisma 직접 조회 ((admin) 레이아웃 ADMIN 가드 하). 예약 1건 = A4 1페이지.
// 마진 비공개 — 판매가·원가는 select·렌더 어디에도 없음. 보증금만 노출.
// 인쇄 문서 전체(라벨·비품·동의서)가 선택한 게스트 언어(?lang)로 렌더된다. 툴바는 no-print(앱 로케일 유지).
import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BookingStatus, type Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString, parseUtcDateOnly, addUtcDays } from "@/lib/date-vn";
import { todayInVillaTimezone } from "@/lib/timeline";
import { minutesToHHMM } from "@/lib/sales-display";
import { formatThousands } from "@/lib/format";
import { AMENITY_CATEGORIES } from "@/lib/amenities";
import { minibarItemName } from "@/lib/minibar";
import {
  agreementVersionLabel,
  isAgreementLang,
  type AgreementLang,
} from "@/lib/agreement";
import { getAgreementContent } from "@/lib/agreement-store";
import { SHEET_LABELS, AMENITY_CATEGORY_LABEL, amenityLabel } from "@/lib/checkin-sheet-i18n";
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
  const t = await getTranslations("adminCheckinSheet"); // 툴바(no-print) — 앱 로케일
  const tb = await getTranslations("adminBookings");
  const params = await searchParams;

  const today = todayInVillaTimezone();
  const todayStr = toDateOnlyString(today);
  const dateStr =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayStr;
  const date = parseUtcDateOnly(dateStr) ?? today;

  // 인쇄 문서 언어 — 기본은 앱 로케일(ko/vi). 게스트용으로 en/zh/ru 선택 가능.
  const appLocale = await getLocale();
  const defaultLang: AgreementLang = isAgreementLang(appLocale) ? appLocale : "ko";
  const lang: AgreementLang = isAgreementLang(params.lang) ? params.lang : defaultLang;
  const L = SHEET_LABELS[lang];

  // 발행본 동의서 — 운영자 편집본(AppSetting) 또는 코드 기본값 폴백. 인쇄 시트에 반영.
  const agreement = await getAgreementContent();

  // 미니바 회사표준(#2b) — 전 빌라 공통 1세트. 인쇄 시트에 표준 목록 + 소모 손기입란.
  const minibarStandard = await prisma.minibarItem.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { nameKo: true, nameVi: true, unitPriceVnd: true },
  });
  const minibarRows = minibarStandard.map((m) => ({
    label: minibarItemName(m, lang),
    unitPriceVnd: m.unitPriceVnd,
  }));

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
          // 비품 — 입실 확인 + 미니바 정산표용. unitPrice = 미니바 고객 청구 단가(VND, 게스트 노출 OK).
          // ※ 빌라 판매가(totalSale*)·원가(supplierCostVnd)와 무관 — 마진 비공개 규칙 대상 아님.
          amenities: {
            select: {
              category: true,
              itemKey: true,
              customLabel: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      },
      checkInRecord: { select: { signatureUrl: true } },
    },
  });

  const fmt = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");
  const prevStr = toDateOnlyString(addUtcDays(date, -1));
  const nextStr = toDateOnlyString(addUtcDays(date, 1));
  const isToday = dateStr === todayStr;
  const langQs = `&lang=${lang}`; // 날짜 이동 시 선택 언어 보존

  const navLink =
    "inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors";

  return (
    <div className="space-y-6">
      {/* 툴바 — 인쇄 시 숨김 (앱 로케일 유지) */}
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
              href={`/bookings/checkin-sheet?lang=${lang}`}
              className="text-sm text-slate-400 hover:text-white underline px-1"
            >
              {t("today")}
            </Link>
          )}
          <AgreementLangSelect value={lang} label={t("langSelect")} />
          <PrintButton label={t("printButton")} />
        </div>
      </div>

      <p className="no-print text-sm text-slate-500">{t("count", { n: bookings.length })}</p>

      {bookings.length === 0 ? (
        <div className="no-print bg-admin-card rounded-xl border border-slate-800 p-12 text-center text-slate-400">
          {t("empty")}
        </div>
      ) : (
        <div className="print-sheet space-y-6">
          {bookings.map((b) => {
            const v = b.villa;
            const hasDeposit = b.depositAmount != null && b.depositCurrency != null;
            const depositHeld = b.depositStatus === "HELD";
            const alreadySigned = !!b.checkInRecord?.signatureUrl;
            // 비품 — 카테고리 순서대로 그룹화. 미니바는 회사표준(#2b)으로 분리 → 빌라별 그룹에서 제외.
            const amenityGroups = AMENITY_CATEGORIES.filter((cat) => cat !== "MINIBAR")
              .map((cat) => ({
                cat,
                items: v.amenities.filter((a) => a.category === cat),
              }))
              .filter((g) => g.items.length > 0);

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
                      {L.checkInDate}
                    </p>
                    <p className="text-xl font-black tabular-nums">{fmt(b.checkIn)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">#{b.id.slice(-8)}</p>
                  </div>
                </header>

                <div className="px-7 py-5 space-y-5">
                  {/* ① 예약 정보 */}
                  <section>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                      {L.reservation}
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <Field label={L.guest} value={b.guestName} />
                      <Field label={L.guests} value={L.guestsValue(b.guestCount, v.maxGuests)} />
                      {b.guestRoster && (
                        <div className="col-span-2">
                          <dt className="text-[11px] uppercase tracking-widest text-slate-400">
                            {L.roster}
                          </dt>
                          <dd className="font-semibold whitespace-pre-wrap">{b.guestRoster}</dd>
                        </div>
                      )}
                      <Field label={L.phone} value={b.guestPhone || "—"} />
                      <Field
                        label={L.channel}
                        value={
                          b.agencyName
                            ? `${b.agencyName} (${L.channels[b.channel]})`
                            : L.channels[b.channel]
                        }
                      />
                      <Field
                        label={L.stay}
                        value={`${fmt(b.checkIn)} → ${fmt(b.checkOut)} (${L.nights(b.nights)})`}
                      />
                      <Field
                        label={L.times}
                        value={`${minutesToHHMM(v.checkInTime)} / ${minutesToHHMM(v.checkOutTime)}`}
                      />
                      <Field label={L.breakfast} value={b.breakfastIncluded ? L.yes : L.no} />
                    </dl>
                  </section>

                  {/* ② 보증금 */}
                  <section>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                      {L.deposit}
                    </h3>
                    {!hasDeposit ? (
                      <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {L.depositNone}
                      </div>
                    ) : depositHeld ? (
                      <div className="rounded-lg border-2 border-green-600 bg-green-50 px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-green-800">{L.depositHeld}</span>
                        <span className="text-lg font-black tabular-nums text-green-800">
                          {money(b.depositAmount!, b.depositCurrency!)}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-lg border-2 border-red-600 bg-red-50 px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-black text-red-700 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">priority_high</span>
                          {L.depositRequired}
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
                        {L.wifi}
                      </h3>
                      <div className="flex flex-wrap gap-x-10 gap-y-1 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3">
                        {v.wifiSsid && (
                          <div>
                            <span className="text-[11px] uppercase tracking-widest text-slate-400">
                              {L.wifiId}
                            </span>
                            <p className="text-lg font-black tabular-nums">{v.wifiSsid}</p>
                          </div>
                        )}
                        {v.wifiPassword && (
                          <div>
                            <span className="text-[11px] uppercase tracking-widest text-slate-400">
                              {L.wifiPw}
                            </span>
                            <p className="text-lg font-black tabular-nums">{v.wifiPassword}</p>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* ④ 비품 — 박스 표. 미니바는 가격·수량 인쇄, 남은수량·합계는 체크아웃 시 손기입 */}
                  {amenityGroups.length > 0 && (
                    <section>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                        {L.amenities}
                      </h3>
                      <table className="w-full border-collapse border border-slate-400 text-sm">
                        <thead>
                          <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
                            <th className="border border-slate-300 px-2 py-1.5 text-left">{L.amenityTable.item}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-right w-24">{L.amenityTable.price}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-center w-14">{L.amenityTable.stocked}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-center w-24">{L.amenityTable.remaining}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-right w-24">{L.amenityTable.total}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {amenityGroups.map((g) => (
                            <Fragment key={g.cat}>
                              <tr className="bg-slate-50">
                                <td
                                  colSpan={5}
                                  className="border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600"
                                >
                                  {AMENITY_CATEGORY_LABEL[g.cat][lang]}
                                </td>
                              </tr>
                              {g.items.map((a, i) => (
                                <tr key={`${g.cat}-${a.itemKey}-${i}`}>
                                  <td className="border border-slate-300 px-2 py-2">
                                    {amenityLabel(a.itemKey, lang, a.customLabel)}
                                  </td>
                                  <td className="border border-slate-300 px-2 py-2 text-right tabular-nums">
                                    {a.unitPrice != null ? `${formatThousands(a.unitPrice)}₫` : ""}
                                  </td>
                                  <td className="border border-slate-300 px-2 py-2 text-center tabular-nums">
                                    {a.quantity}
                                  </td>
                                  {/* 남은수량 — 체크아웃 시 손기입(빈 칸) */}
                                  <td className="border border-slate-300 px-2 py-2"></td>
                                  {/* 합계 — 체크아웃 시 손기입(빈 칸) */}
                                  <td className="border border-slate-300 px-2 py-2"></td>
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}

                  {/* ④-2 미니바(회사표준, #2b) — 표준 품목·단가 인쇄, 소모 수량·합계는 체크아웃 시 손기입 */}
                  {minibarRows.length > 0 && (
                    <section>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                        {L.minibar.title}
                      </h3>
                      <table className="w-full border-collapse border border-slate-400 text-sm">
                        <thead>
                          <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
                            <th className="border border-slate-300 px-2 py-1.5 text-left">{L.amenityTable.item}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-right w-24">{L.amenityTable.price}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-center w-20">{L.minibar.consumed}</th>
                            <th className="border border-slate-300 px-2 py-1.5 text-right w-24">{L.amenityTable.total}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {minibarRows.map((m, i) => (
                            <tr key={`mb-${i}`}>
                              <td className="border border-slate-300 px-2 py-2">{m.label}</td>
                              <td className="border border-slate-300 px-2 py-2 text-right tabular-nums">
                                {formatThousands(m.unitPriceVnd)}₫
                              </td>
                              {/* 소모 수량 — 체크아웃 시 손기입(빈 칸) */}
                              <td className="border border-slate-300 px-2 py-2"></td>
                              {/* 합계 — 체크아웃 시 손기입(빈 칸) */}
                              <td className="border border-slate-300 px-2 py-2"></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}

                  {/* ⑤ 동의서 + 서명란 — 선택 언어 */}
                  <section>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center justify-between">
                      <span>{L.agreement}</span>
                      <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">
                        {agreementVersionLabel(agreement)}
                      </span>
                    </h3>
                    <p className="text-sm font-bold mb-1">{agreement.docTitle[lang]}</p>
                    {/* 자유 텍스트 본문 — 운영자가 번호 매긴 그대로 줄바꿈 보존 */}
                    <p className="text-[11px] leading-relaxed text-slate-600 whitespace-pre-line">
                      {agreement.body[lang]}
                    </p>

                    {alreadySigned ? (
                      <p className="mt-3 text-xs font-bold text-green-700">{L.alreadySigned}</p>
                    ) : (
                      <div className="mt-4 grid grid-cols-2 gap-6">
                        <SignBox label={L.guestSign} />
                        <SignBox label={L.staffConfirm} />
                      </div>
                    )}
                    <p className="mt-3 text-xs text-slate-500">{L.signDate}: ____________________</p>
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
