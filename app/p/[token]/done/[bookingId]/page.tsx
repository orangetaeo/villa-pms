import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HoldCountdown } from "../../../_components/hold-countdown";
import { CopyButton } from "../../../_components/copy-button";
import { bookingShortCode, formatPublicAmount } from "../../../_components/public-format";

/**
 * /p/[token]/done/[bookingId] — 가예약 완료 (Stitch c3 상태2 변환, 비로그인 ko)
 * 마진 비공개: select로 판매가·날짜만 — supplierCostVnd·fx 절대 미조회
 */

export const metadata: Metadata = { title: "가예약 완료 | Villa PMS" };

const BANK_KEYS = ["BANK_NAME", "BANK_ACCOUNT_NUMBER", "BANK_ACCOUNT_HOLDER"] as const;

/** c3 export bg-mesh 재현 — globals.css 동결(계약)이라 컴포넌트 인라인 */
const MESH_BG = {
  backgroundImage:
    "radial-gradient(at 0% 0%, rgba(13,148,136,0.05) 0, transparent 50%), radial-gradient(at 100% 0%, rgba(245,158,11,0.05) 0, transparent 50%)",
} as const;

export default async function BookingDonePage({
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
      holdExpiresAt: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      proposalItem: { select: { proposal: { select: { token: true } } } },
    },
  });
  // 교차 토큰 차단 + HOLD/CONFIRMED 외 상태(만료·취소)는 메인의 서버 판정으로
  if (!booking || booking.proposalItem?.proposal.token !== token) notFound();
  if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
    notFound();
  }

  const bankRows = await prisma.appSetting.findMany({
    where: { key: { in: [...BANK_KEYS] } },
  });
  const bank = (k: (typeof BANK_KEYS)[number]) => bankRows.find((r) => r.key === k)?.value ?? null;
  const hasBankInfo = bank("BANK_NAME") && bank("BANK_ACCOUNT_NUMBER");

  const total = formatPublicAmount(booking.saleCurrency, booking.totalSaleKrw, booking.totalSaleVnd);

  return (
    <div className="text-slate-900 antialiased">
      <div className="max-w-md mx-auto min-h-screen bg-neutral-50 flex flex-col shadow-2xl relative" style={MESH_BG}>
        <header className="w-full top-0 sticky z-50 bg-white border-b border-gray-100 shadow-sm flex items-center px-4 h-14">
          <Link
            href={`/p/${token}`}
            aria-label="뒤로 가기"
            className="active:scale-95 transition-transform hover:bg-gray-50 p-2 rounded-full"
          >
            <span className="material-symbols-outlined text-teal-600">arrow_back</span>
          </Link>
          <h1 className="font-semibold text-lg text-teal-600 ml-2">Villa PMS</h1>
        </header>

        <main className="flex-grow p-6 space-y-8 py-10">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-teal-50 rounded-full mb-2">
              <span className="material-symbols-outlined icon-fill text-teal-600 text-5xl">
                check_circle
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              가예약이 접수되었습니다
            </h2>
            <div className="inline-block px-4 py-1.5 bg-gray-100 text-slate-600 text-sm font-bold rounded-full">
              예약번호 {bookingShortCode(booking.id)}
            </div>
          </div>

          {hasBankInfo && (
            <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/50 border border-gray-100 p-6 space-y-6">
              <div className="space-y-1">
                <p className="text-xs font-bold text-teal-600 tracking-wider">입금 정보</p>
                <h4 className="text-lg font-bold">무통장 입금 안내</h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-3">
                  <span className="text-slate-500">은행명</span>
                  <span className="font-semibold">{bank("BANK_NAME")}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-3">
                  <span className="text-slate-500">계좌번호</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{bank("BANK_ACCOUNT_NUMBER")}</span>
                    <CopyButton text={bank("BANK_ACCOUNT_NUMBER")!} />
                  </div>
                </div>
                {bank("BANK_ACCOUNT_HOLDER") && (
                  <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-3">
                    <span className="text-slate-500">예금주</span>
                    <span className="font-semibold">{bank("BANK_ACCOUNT_HOLDER")}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-slate-500 font-medium">입금 금액</span>
                  <span className="text-2xl font-extrabold text-slate-900">{total}</span>
                </div>
              </div>
            </div>
          )}
          {!hasBankInfo && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-slate-500">
              입금 계좌는 담당자가 별도로 안내해 드립니다.
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{total}</div>
            </div>
          )}

          {booking.status === BookingStatus.HOLD && booking.holdExpiresAt && (
            <HoldCountdown expiresAtIso={booking.holdExpiresAt.toISOString()} />
          )}

          <div className="flex gap-3">
            <Link
              href={`/p/${token}`}
              className="flex-1 h-14 bg-slate-900 text-white font-bold rounded-lg active:scale-95 transition-all flex items-center justify-center"
            >
              제안으로 돌아가기
            </Link>
          </div>

          <p className="text-xs text-slate-400 text-center leading-relaxed">
            입금 확인 후 예약이 확정되며, 미입금 시 가예약은 자동으로 취소될 수 있습니다.
          </p>
        </main>

        <footer className="bg-gray-50 border-t border-gray-200 w-full py-8 flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-xs text-gray-500 leading-relaxed">© 2026 Villa PMS Phu Quoc</p>
          <div className="flex gap-4">
            <a className="text-xs text-gray-500 underline transition-colors hover:text-teal-700" href="#">
              이용약관
            </a>
            <a className="text-xs text-gray-500 underline transition-colors hover:text-teal-700" href="#">
              개인정보처리방침
            </a>
            <a className="text-xs text-gray-500 underline transition-colors hover:text-teal-700" href="#">
              보증금 정책
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
