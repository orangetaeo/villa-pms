import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import { PublicFooter } from "../../../_components/public-footer";
import { LangSelector } from "../../../_components/lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { bookingShortCode } from "../../../_components/public-format";
import { RosterForm } from "../../../_components/roster-form";
import {
  PUBLIC_LABELS,
  PUBLIC_META,
  PUBLIC_LOCALE_COOKIE,
  resolvePublicLang,
} from "@/lib/public-i18n";

/**
 * /p/[token]/roster/[bookingId] — 여행사 셀프 투숙객 명단 입력 (비로그인, 5개 언어 #5, 안 B)
 * 교차 토큰 가드 + HOLD/CONFIRMED만. 마진 비공개: 판매가·원가·fx 절대 미select.
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  return { title: `${PUBLIC_META[resolvePublicLang(langParam, cookieLang)].roster} | Villa Go` };
}

/** c3 export bg-mesh 재현 (done 페이지와 동일) */
const MESH_BG = {
  backgroundImage:
    "radial-gradient(at 0% 0%, rgba(13,148,136,0.05) 0, transparent 50%), radial-gradient(at 100% 0%, rgba(245,158,11,0.05) 0, transparent 50%)",
} as const;

function fmtDate(d: Date): string {
  return toDateOnlyString(d).replaceAll("-", ".");
}

export default async function RosterInputPage({
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
      checkIn: true,
      checkOut: true,
      nights: true,
      guestCount: true,
      guestRoster: true,
      villa: { select: { name: true } },
      proposalItem: { select: { proposal: { select: { token: true } } } },
    },
  });
  // 교차 토큰 차단 + 체크인 이후·취소·만료는 입력 불가
  if (!booking || booking.proposalItem?.proposal.token !== token) notFound();
  if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
    notFound();
  }

  return (
    <div className="text-slate-900 antialiased">
      <div
        className="max-w-md mx-auto min-h-screen bg-neutral-50 flex flex-col shadow-2xl relative"
        style={MESH_BG}
      >
        <header className="w-full top-0 sticky z-50 bg-white border-b border-gray-100 shadow-sm flex items-center px-4 h-14">
          <Link
            href={`/p/${token}/done/${booking.id}?lang=${lang}`}
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

        <main className="flex-grow p-6 space-y-6 py-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t.rosterPage.title}</h2>
            <p className="text-sm text-slate-500 leading-relaxed">{t.rosterPage.subtitle}</p>
          </div>

          {/* 예약 요약 — 가격 없음(마진 비공개), 어느 예약인지 확인용만 */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/50 border border-gray-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-900 font-bold">{booking.villa.name}</span>
              <span className="px-3 py-1 bg-gray-100 text-slate-600 text-xs font-bold rounded-full">
                {bookingShortCode(booking.id)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="tabular-nums font-semibold">{fmtDate(booking.checkIn)}</span>
              <span className="text-slate-300">→</span>
              <span className="tabular-nums font-semibold">{fmtDate(booking.checkOut)}</span>
              <span className="px-2 py-0.5 bg-teal-50 text-teal-700 text-[11px] font-bold rounded-full">
                {t.rosterPage.summary(booking.nights, booking.guestCount)}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/50 border border-gray-100 p-6">
            <RosterForm
              token={token}
              bookingId={booking.id}
              initialRoster={booking.guestRoster}
              lang={lang}
            />
          </div>
        </main>

        <PublicFooter lang={lang} />
      </div>
    </div>
  );
}
