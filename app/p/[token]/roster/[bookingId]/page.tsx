import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import { PublicFooter } from "../../../_components/public-footer";
import { bookingShortCode } from "../../../_components/public-format";
import { RosterForm } from "../../../_components/roster-form";

/**
 * /p/[token]/roster/[bookingId] — 여행사 셀프 투숙객 명단 입력 (비로그인, ko, 안 B)
 * 교차 토큰 가드 + HOLD/CONFIRMED만. 마진 비공개: 판매가·원가·fx 절대 미select.
 */

export const metadata: Metadata = { title: "투숙객 명단 입력 | Villa PMS" };

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
}: {
  params: Promise<{ token: string; bookingId: string }>;
}) {
  const { token, bookingId } = await params;

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
            href={`/p/${token}/done/${booking.id}`}
            aria-label="뒤로 가기"
            className="active:scale-95 transition-transform hover:bg-gray-50 p-2 rounded-full"
          >
            <span className="material-symbols-outlined text-teal-600">arrow_back</span>
          </Link>
          <h1 className="font-semibold text-lg text-teal-600 ml-2">Villa PMS</h1>
        </header>

        <main className="flex-grow p-6 space-y-6 py-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">투숙객 명단 입력</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              실제 투숙하실 분들의 성함을 입력해주세요. 체크인 준비(임시거주신고)에 사용됩니다.
            </p>
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
                {booking.nights}박 · {booking.guestCount}명
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/50 border border-gray-100 p-6">
            <RosterForm
              token={token}
              bookingId={booking.id}
              initialRoster={booking.guestRoster}
            />
          </div>
        </main>

        <PublicFooter />
      </div>
    </div>
  );
}
