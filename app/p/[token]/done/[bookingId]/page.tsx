import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HoldCountdown } from "../../../_components/hold-countdown";
import { CopyButton } from "../../../_components/copy-button";
import { PublicFooter } from "../../../_components/public-footer";
import { bookingShortCode, formatPublicAmount } from "../../../_components/public-format";

/**
 * /p/[token]/done/[bookingId] — 가예약 완료 (Stitch c3 상태2 변환, 비로그인 ko)
 * 마진 비공개: select로 판매가·날짜만 — supplierCostVnd·fx 절대 미조회
 */

export const metadata: Metadata = { title: "가예약 완료 | Villa PMS" };

// 한국(KRW)·베트남(VND) 계좌 키 — 예약 통화에 따라 자동 선택 (운영자 설정)
const BANK_KEY_SETS = {
  KRW: {
    name: "BANK_NAME",
    number: "BANK_ACCOUNT_NUMBER",
    holder: "BANK_ACCOUNT_HOLDER",
  },
  VND: {
    name: "BANK_VN_NAME",
    number: "BANK_VN_ACCOUNT_NUMBER",
    holder: "BANK_VN_ACCOUNT_HOLDER",
  },
} as const;
const ALL_BANK_KEYS = Object.values(BANK_KEY_SETS).flatMap((s) => [s.name, s.number, s.holder]);

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
    where: { key: { in: ALL_BANK_KEYS } },
  });
  // 예약 통화에 맞는 계좌 세트 선택 (VND→베트남, KRW·그 외→한국)
  const keySet = booking.saleCurrency === "VND" ? BANK_KEY_SETS.VND : BANK_KEY_SETS.KRW;
  const byKey = new Map(bankRows.map((r) => [r.key, r.value]));
  const bank = (k: string) => byKey.get(k) ?? null;
  const hasBankInfo = bank(keySet.name) && bank(keySet.number);

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
                  <span className="font-semibold">{bank(keySet.name)}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-3">
                  <span className="text-slate-500">계좌번호</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{bank(keySet.number)}</span>
                    <CopyButton text={bank(keySet.number)!} />
                  </div>
                </div>
                {bank(keySet.holder) && (
                  <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-3">
                    <span className="text-slate-500">예금주</span>
                    <span className="font-semibold">{bank(keySet.holder)}</span>
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

          {/* 투숙객 명단 셀프 입력 (안 B) — 실제 투숙객 성함을 미리 입력 */}
          <Link
            href={`/p/${token}/roster/${booking.id}`}
            className="w-full h-14 bg-teal-600 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-xl">group_add</span>
            투숙객 명단 입력하기
          </Link>

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

        <PublicFooter />
      </div>
    </div>
  );
}
