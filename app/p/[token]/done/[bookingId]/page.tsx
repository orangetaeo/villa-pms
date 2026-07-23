import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HoldCountdown } from "../../../_components/hold-countdown";
import { PaymentNoticeButton } from "../../../_components/payment-notice-button";
import { BankAccountsSection } from "../../../_components/bank-accounts";
import { getPublicBankAccounts } from "../../../_components/public-bank";
import { PublicFooter } from "../../../_components/public-footer";
import { LangSelector } from "../../../_components/lang-selector";
import { PartnerAddonSection } from "../../../_components/partner-addon-section";
import { loadPartnerAddon } from "@/lib/partner-addon-load";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { bookingShortCode, formatPublicAmount } from "../../../_components/public-format";
import {
  PUBLIC_LABELS,
  PUBLIC_META,
  PUBLIC_LOCALE_COOKIE,
  resolvePublicLang,
} from "@/lib/public-i18n";

/**
 * /p/[token]/done/[bookingId] — 가예약 완료 (Stitch c3 상태2 변환, 비로그인, 5개 언어 #5)
 * 마진 비공개: select로 판매가·날짜만 — supplierCostVnd·fx 절대 미조회
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  return { title: `${PUBLIC_META[resolvePublicLang(langParam, cookieLang)].done} | Villa Go` };
}

/** c3 export bg-mesh 재현 — globals.css 동결(계약)이라 컴포넌트 인라인 */
const MESH_BG = {
  backgroundImage:
    "radial-gradient(at 0% 0%, rgba(13,148,136,0.05) 0, transparent 50%), radial-gradient(at 100% 0%, rgba(245,158,11,0.05) 0, transparent 50%)",
} as const;

export default async function BookingDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; bookingId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token, bookingId } = await params;
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);
  const t = PUBLIC_LABELS[lang];

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      holdExpiresAt: true,
      saleCurrency: true,
      channel: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      totalSaleUsd: true, // Phase 2 USD: 구매자가 볼 판매가($). fx·원가는 미조회(누수 0)
      proposalItem: { select: { proposal: { select: { token: true, expiresAt: true } } } },
    },
  });
  // 교차 토큰 차단 + HOLD/CONFIRMED 외 상태(만료·취소)는 메인의 서버 판정으로
  if (!booking || booking.proposalItem?.proposal.token !== token) notFound();
  if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
    notFound();
  }

  // Phase 2 USD: USD 전용 계좌는 운영하지 않는다. USD를 KRW 계좌로 폴백하면 오안내가 되므로
  // 계좌 조회를 건너뛰고 "운영자 문의" 중립 메시지를 보여준다.
  const isUsd = booking.saleCurrency === "USD";
  // ★한국·베트남 계좌를 둘 다 국가 라벨과 함께 안내(제안 페이지와 동일 규칙) — 예약 통화 계좌가 맨 위.
  const bankAccounts = isUsd ? [] : await getPublicBankAccounts(booking.saleCurrency);
  const hasBankInfo = bankAccounts.length > 0;

  const total = formatPublicAmount(
    booking.saleCurrency,
    booking.totalSaleKrw,
    booking.totalSaleVnd,
    lang,
    booking.totalSaleUsd
  );

  // 파트너(여행사/랜드사) 부가서비스 요청 — PARTNER 자격 카탈로그만(서버 필터), 판매가만(원가·vendor 비노출)
  const partnerAddon = await loadPartnerAddon(booking.id, booking.saleCurrency, lang, booking.channel === "DIRECT");
  // 신규 부가서비스 요청은 제안 유효기간까지만(ADR-0022 — 만료 후엔 재발급·운영자 경유).
  // API(service-orders POST 410)와 동일 판정 — 폼만 보이고 제출은 실패하는 불일치 방지.
  // 입금통보·명단은 예약 수명주기(HOLD/CONFIRMED) 기준이라 만료와 무관 — 아래 섹션들은 그대로.
  const orderingClosed = booking.proposalItem.proposal.expiresAt.getTime() <= Date.now();

  return (
    <div className="text-slate-900 antialiased">
      <div className="max-w-md mx-auto min-h-screen bg-neutral-50 flex flex-col shadow-2xl relative" style={MESH_BG}>
        <header className="w-full top-0 sticky z-50 bg-white border-b border-gray-100 shadow-sm flex items-center px-4 h-14">
          <Link
            href={`/p/${token}?lang=${lang}`}
            aria-label={t.back}
            className="active:scale-95 transition-transform hover:bg-gray-50 p-2 rounded-full"
          >
            <span className="material-symbols-outlined text-teal-600">arrow_back</span>
          </Link>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark className="text-lg" villa="text-slate-900" go="text-teal-600" />
          </span>
          <div className="ml-auto">
            <LangSelector current={lang} />
          </div>
        </header>

        <main className="flex-grow p-6 space-y-8 py-10">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-teal-50 rounded-full mb-2">
              <span className="material-symbols-outlined icon-fill text-teal-600 text-5xl">
                check_circle
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {t.donePage.title}
            </h2>
            <div className="inline-block px-4 py-1.5 bg-gray-100 text-slate-600 text-sm font-bold rounded-full">
              {t.donePage.bookingNo(bookingShortCode(booking.id))}
            </div>
          </div>

          {hasBankInfo && (
            <BankAccountsSection
              accounts={bankAccounts}
              lang={lang}
              tone="slate"
              labels={{
                label: t.donePage.bankLabel,
                title: t.donePage.bankTitle,
                name: t.donePage.bankName,
                number: t.donePage.bankNumber,
                holder: t.donePage.bankHolder,
              }}
              footer={
                <div className="flex justify-between items-center pt-1">
                  <span className="text-slate-500 font-medium">{t.donePage.amount}</span>
                  <span className="text-2xl font-extrabold text-slate-900">{total}</span>
                </div>
              }
            />
          )}
          {!hasBankInfo && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-slate-500">
              {/* USD는 계좌 미운영 — KRW 계좌 오안내 대신 운영자 문의 중립 메시지 */}
              {isUsd ? t.usdBankNotice : t.donePage.noBankInfo}
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{total}</div>
            </div>
          )}

          {booking.status === BookingStatus.HOLD && booking.holdExpiresAt && (
            <HoldCountdown expiresAtIso={booking.holdExpiresAt.toISOString()} lang={lang} />
          )}

          {/* 입금통보 (B1) — HOLD에서만. 게스트→운영자 "입금했어요" 신호(상태 미변경, 운영자 수동 확정) */}
          {booking.status === BookingStatus.HOLD && (
            <PaymentNoticeButton token={token} bookingId={booking.id} lang={lang} />
          )}

          {/* 투숙객 명단 셀프 입력 (안 B) — 실제 투숙객 성함을 미리 입력 */}
          <Link
            href={`/p/${token}/roster/${booking.id}?lang=${lang}`}
            className="w-full h-14 bg-teal-600 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-xl">group_add</span>
            {t.donePage.rosterCta}
          </Link>

          {/* 부가서비스 요청 (ADR-0023 S4) — 과일 바구니·도시락 등 PARTNER 자격 항목만.
              제안 만료 후엔 신규 요청 폼 대신 마감 안내 + 기존 요청 내역만 (API 410과 정합) */}
          {partnerAddon.catalog.length > 0 && (
            <PartnerAddonSection
              token={token}
              bookingId={booking.id}
              lang={lang}
              saleCurrency={booking.saleCurrency}
              fxVndPerKrw={partnerAddon.fxVndPerKrw}
              catalog={partnerAddon.catalog}
              requestedOrders={partnerAddon.requestedOrders}
              orderingClosed={orderingClosed}
            />
          )}

          <div className="flex gap-3">
            <Link
              href={`/p/${token}?lang=${lang}`}
              className="flex-1 h-14 bg-slate-900 text-white font-bold rounded-lg active:scale-95 transition-all flex items-center justify-center"
            >
              {t.donePage.backToProposal}
            </Link>
          </div>

          <p className="text-xs text-slate-400 text-center leading-relaxed">{t.donePage.footerNote}</p>
        </main>

        <PublicFooter lang={lang} />
      </div>
    </div>
  );
}
