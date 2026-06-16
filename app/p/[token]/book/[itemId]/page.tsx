import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectiveProposalStatus } from "@/lib/proposal";
import { resolveHoldHours, HOLD_HOURS_DEFAULT_KEY } from "@/lib/hold";
import { BookingForm } from "../../../_components/booking-form";
import { PublicFooter } from "../../../_components/public-footer";
import { formatKoDateShort, formatPublicAmount } from "../../../_components/public-format";

/** /p/[token]/book/[itemId] — 가예약 입력 (Stitch c3 상태1 변환, 비로그인 ko) */

export const metadata: Metadata = { title: "가예약 신청 | Villa PMS" };

/** c3 export bg-mesh 재현 — globals.css 동결(계약)이라 컴포넌트 인라인 */
const MESH_BG = {
  backgroundImage:
    "radial-gradient(at 0% 0%, rgba(13,148,136,0.05) 0, transparent 50%), radial-gradient(at 100% 0%, rgba(245,158,11,0.05) 0, transparent 50%)",
} as const;

export default async function BookingRequestPage({
  params,
}: {
  params: Promise<{ token: string; itemId: string }>;
}) {
  const { token, itemId } = await params;

  const item = await prisma.proposalItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      totalKrw: true,
      totalVnd: true,
      bookingId: true,
      proposal: { select: { token: true, status: true, expiresAt: true, saleCurrency: true } },
      villa: {
        select: {
          name: true,
          photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        },
      },
    },
  });
  // 교차 토큰 차단 — itemId가 이 token의 제안 소속이 아니면 404
  if (!item || item.proposal.token !== token) notFound();

  const now = new Date();
  const status = effectiveProposalStatus(item.proposal.status, item.proposal.expiresAt, now);
  if (status !== ProposalStatus.ACTIVE || item.bookingId) {
    redirect(`/p/${token}`); // 메인이 서버 판정값으로 만료/마감 렌더
  }

  const holdSetting = await prisma.appSetting.findUnique({
    where: { key: HOLD_HOURS_DEFAULT_KEY },
  });
  const holdHours = resolveHoldHours(holdSetting?.value);
  const nights = Math.round(
    (item.checkOut.getTime() - item.checkIn.getTime()) / 86_400_000
  );
  const photoUrl = item.villa.photos[0]?.url ?? null;

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

        <main className="flex-grow p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800">가예약 신청</h2>
            <span className="text-xs font-medium text-slate-400">단계 1/2</span>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {photoUrl ? (
              <div className="relative w-full h-48">
                <Image
                  src={photoUrl}
                  alt={item.villa.name}
                  fill
                  sizes="(max-width: 448px) 100vw, 448px"
                  className="object-cover"
                  priority
                />
              </div>
            ) : (
              <div className="w-full h-48 bg-neutral-100 flex items-center justify-center">
                <span className="material-symbols-outlined text-neutral-300 text-5xl">villa</span>
              </div>
            )}
            <div className="p-4 space-y-2">
              <h3 className="font-bold text-lg">{item.villa.name}</h3>
              <div className="flex items-center text-slate-500 text-sm">
                <span className="material-symbols-outlined text-sm mr-1">calendar_today</span>
                {formatKoDateShort(item.checkIn)} ~ {formatKoDateShort(item.checkOut)} · {nights}박
              </div>
              <div className="pt-2 border-t border-dashed border-gray-200 flex justify-between items-center">
                <span className="text-sm text-slate-500">총 결제 금액</span>
                <span className="text-xl font-extrabold text-teal-600">
                  {formatPublicAmount(item.proposal.saleCurrency, item.totalKrw, item.totalVnd)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 p-4 rounded-lg flex gap-3">
            <span className="material-symbols-outlined text-amber-500">schedule</span>
            <p className="text-sm text-amber-800 leading-relaxed">
              제출 후 {holdHours}시간 동안 해당 빌라가 홀드됩니다. 입금 확인 후 예약이 확정됩니다.
            </p>
          </div>

          <BookingForm token={token} itemId={item.id} />
        </main>

        <PublicFooter />
      </div>
    </div>
  );
}
