import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectiveProposalStatus } from "@/lib/proposal";
import { resolveHoldHours, HOLD_HOURS_DEFAULT_KEY } from "@/lib/hold";
import {
  CANCELLATION_POLICY_KEY,
  parseCancellationPolicy,
} from "@/lib/cancellation-policy";
import { BookingForm } from "../../../_components/booking-form";
import { PublicFooter } from "../../../_components/public-footer";
import { LangSelector } from "../../../_components/lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { formatPublicAmount } from "../../../_components/public-format";
import {
  PUBLIC_LABELS,
  PUBLIC_META,
  PUBLIC_LOCALE_COOKIE,
  resolvePublicLang,
  formatPublicDateShort,
} from "@/lib/public-i18n";
import { publicVillaCode } from "@/lib/villa-name";

/** /p/[token]/book/[itemId] — 가예약 입력 (Stitch c3 상태1 변환, 비로그인, 5개 언어 #5) */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  return { title: `${PUBLIC_META[resolvePublicLang(langParam, cookieLang)].book} | Villa Go` };
}

/** c3 export bg-mesh 재현 — globals.css 동결(계약)이라 컴포넌트 인라인 */
const MESH_BG = {
  backgroundImage:
    "radial-gradient(at 0% 0%, rgba(13,148,136,0.05) 0, transparent 50%), radial-gradient(at 100% 0%, rgba(245,158,11,0.05) 0, transparent 50%)",
} as const;

export default async function BookingRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; itemId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token, itemId } = await params;
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);
  const t = PUBLIC_LABELS[lang];

  const item = await prisma.proposalItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      totalKrw: true,
      totalVnd: true,
      totalUsd: true, // Phase 2 USD: 구매자가 볼 제안가($)
      bookingId: true,
      proposal: { select: { token: true, status: true, expiresAt: true, saleCurrency: true } },
      villa: {
        select: {
          // 실명 대신 코드명(publicVillaCode) — 제안 플로우(비로그인)는 익명 코드만 노출(원칙1)
          id: true,
          maxGuests: true,
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
    redirect(`/p/${token}?lang=${lang}`); // 메인이 서버 판정값으로 만료/마감 렌더
  }

  const holdSetting = await prisma.appSetting.findUnique({
    where: { key: HOLD_HOURS_DEFAULT_KEY },
  });
  const holdHours = resolveHoldHours(holdSetting?.value);

  // 취소·환불 규정 (T-proposal-policy-consent) — enabled=true면 폼에 동의 체크박스 노출.
  //   미설정·손상 시 기본값 폴백(공개 표시 안전, 메인 /p와 동일 규칙).
  const policyRow = await prisma.appSetting.findUnique({
    where: { key: CANCELLATION_POLICY_KEY },
    select: { value: true },
  });
  const policy = parseCancellationPolicy(policyRow?.value);
  // S3: N단계 — 표시용만(저장 스냅샷은 서버 hold 라우트가 정책에서 재산출)
  const consentPolicy = policy.enabled ? { tiers: policy.tiers } : null;

  const nights = Math.round(
    (item.checkOut.getTime() - item.checkIn.getTime()) / 86_400_000
  );
  const photoUrl = item.villa.photos[0]?.url ?? null;

  return (
    <div className="text-slate-900 antialiased">
      <div className="max-w-md mx-auto min-h-screen bg-neutral-50 flex flex-col shadow-2xl relative" style={MESH_BG}>
        <header className="w-full top-0 sticky z-50 bg-white border-b border-gray-100 shadow-sm flex items-center px-4 h-14">
          <Link
            href={`/p/${token}?lang=${lang}`}
            aria-label={t.back}
            className="shrink-0 active:scale-95 transition-transform hover:bg-gray-50 p-2 rounded-full"
          >
            <span className="material-symbols-outlined text-teal-600">arrow_back</span>
          </Link>
          {/* 남은 공간 기준 가운데 정렬 — 정중앙 absolute 는 좁은 폰에서 우측 컨트롤과 겹친다(2026-07-24) */}
          <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden px-1">
            <VillaGoMark className="h-5 w-auto shrink-0" />
            <VillaGoWordmark className="truncate text-base sm:text-lg" villa="text-slate-900" go="text-teal-600" />
          </span>
          <div className="shrink-0">
            <LangSelector current={lang} />
          </div>
        </header>

        <main className="flex-grow p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800">{t.bookPage.title}</h2>
            <span className="text-xs font-medium text-slate-400">{t.bookPage.step}</span>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {photoUrl ? (
              <div className="relative w-full h-48">
                <Image
                  src={photoUrl}
                  alt={publicVillaCode(item.villa.id)}
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
              <h3 className="font-bold text-lg">
                {publicVillaCode(item.villa.id)}
              </h3>
              <div className="flex items-center text-slate-500 text-sm">
                <span className="material-symbols-outlined text-sm mr-1">calendar_today</span>
                {formatPublicDateShort(item.checkIn, lang)} ~ {formatPublicDateShort(item.checkOut, lang)} · {t.proposal.nights(nights)}
              </div>
              <div className="pt-2 border-t border-dashed border-gray-200 flex justify-between items-center">
                <span className="text-sm text-slate-500">{t.bookPage.totalLabel}</span>
                <span className="text-xl font-extrabold text-teal-600">
                  {formatPublicAmount(item.proposal.saleCurrency, item.totalKrw, item.totalVnd, lang, item.totalUsd)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 p-4 rounded-lg flex gap-3">
            <span className="material-symbols-outlined text-amber-500">schedule</span>
            <p className="text-sm text-amber-800 leading-relaxed">{t.bookPage.holdInfo(holdHours)}</p>
          </div>

          <BookingForm
            token={token}
            itemId={item.id}
            lang={lang}
            maxGuests={item.villa.maxGuests}
            cancellationPolicy={consentPolicy}
          />
        </main>

        <PublicFooter lang={lang} />
      </div>
    </div>
  );
}
