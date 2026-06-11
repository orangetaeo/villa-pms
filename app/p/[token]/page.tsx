import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Currency, ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectiveProposalStatus } from "@/lib/proposal";
import { resolveHoldHours, HOLD_HOURS_DEFAULT_KEY } from "@/lib/hold";
import { ExpiredView } from "../_components/expired-view";
import { PublicFooter } from "../_components/public-footer";
import { PhotoCarousel } from "../_components/photo-carousel";
import { ShareButton } from "../_components/share-button";
import {
  formatExpiryBadge,
  formatKoDateLong,
  formatPublicAmount,
} from "../_components/public-format";

/**
 * /p/[token] — 공개 제안 페이지 (비로그인, ko) — Stitch c1/c1-vnd 변환 (SPEC F3 흐름 2)
 *
 * 재고·마진 비공개: 이 제안에 포함된 빌라·날짜·판매가만 노출. 원가·마진·타통화
 * 환산·다른 재고는 절대 노출 금지. 상태는 서버 판정값으로 단일 렌더(c2, T5.5).
 */

export const metadata: Metadata = { title: "빌라 제안 | Villa PMS" };

async function getContactSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["CONTACT_KAKAO_URL", "CONTACT_PHONE"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { kakaoUrl: get("CONTACT_KAKAO_URL"), phone: get("CONTACT_PHONE") };
}

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { token } = await params;
  const { notice } = await searchParams;

  const proposal = await prisma.proposal.findUnique({
    where: { token },
    // select 화이트리스트 — fxVndPerKrw·note 등 비노출 필드는 메모리에도 미적재 (QA L1)
    select: {
      clientName: true,
      saleCurrency: true,
      status: true,
      expiresAt: true,
      items: {
        orderBy: { id: "asc" }, // 카드 순서 결정성 (QA L3)
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          priceKrwPerNight: true,
          priceVndPerNight: true,
          totalKrw: true,
          totalVnd: true,
          bookingId: true,
          villa: {
            select: {
              name: true,
              bedrooms: true,
              hasPool: true,
              breakfastAvailable: true,
              photos: {
                orderBy: { sortOrder: "asc" },
                take: 5,
                select: { url: true },
              },
            },
          },
        },
      },
    },
  });
  if (!proposal) notFound();

  const now = new Date();
  const status = effectiveProposalStatus(proposal.status, proposal.expiresAt, now);

  // 가예약 재검증 실패 직후 리다이렉트(notice) 또는 DB 상태 기준 — 단일 상태만 렌더
  if (notice === "closed" || notice === "expired" || status !== ProposalStatus.ACTIVE) {
    const contact = await getContactSettings();
    const variant =
      notice === "closed" || status === ProposalStatus.USED ? "closed" : "expired";
    return <ExpiredView variant={variant} kakaoUrl={contact.kakaoUrl} phone={contact.phone} />;
  }

  const holdSetting = await prisma.appSetting.findUnique({
    where: { key: HOLD_HOURS_DEFAULT_KEY },
  });
  const holdHours = resolveHoldHours(holdSetting?.value);

  const currency = proposal.saleCurrency;
  const nightsOf = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

  // 전 항목 날짜가 같으면 요약 행, 다르면 카드별 날짜 표기 (계약 편차)
  const first = proposal.items[0];
  const uniformDates =
    proposal.items.length > 0 &&
    proposal.items.every(
      (i) =>
        i.checkIn.getTime() === first.checkIn.getTime() &&
        i.checkOut.getTime() === first.checkOut.getTime()
    );

  return (
    <div className="bg-neutral-50 text-neutral-900 min-h-screen">
      <header className="bg-white border-b border-neutral-100 flex justify-between items-center w-full px-4 h-14 sticky top-0 z-50">
        <span className="w-10" />
        <h1 className="text-teal-600 font-bold text-xl">Villa PMS</h1>
        <ShareButton title={`${proposal.clientName}님을 위한 제안 | Villa PMS`} />
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">
              {proposal.clientName}님을 위한 제안
            </h2>
            <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider animate-pulse shrink-0">
              {formatExpiryBadge(proposal.expiresAt, now)}
            </span>
          </div>
          <p className="text-neutral-500 text-sm">Phu Quoc 프리미엄 빌라 단독 제안서입니다.</p>
        </section>

        {uniformDates && (
          <div className="bg-white border border-neutral-100 rounded-xl p-4 flex items-center gap-4 shadow-sm">
            <div className="bg-teal-50 text-teal-600 p-3 rounded-lg">
              <span className="material-symbols-outlined">calendar_month</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-neutral-800">
                {formatKoDateLong(first.checkIn)} → {formatKoDateLong(first.checkOut)}
              </p>
              <p className="text-xs text-neutral-500">{nightsOf(first.checkIn, first.checkOut)}박</p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {proposal.items.map((item) => {
            const nightly =
              currency === Currency.KRW ? item.priceKrwPerNight : item.priceVndPerNight;
            return (
              <article
                key={item.id}
                className="bg-white rounded-xl overflow-hidden shadow-sm border border-neutral-100 group"
              >
                <PhotoCarousel urls={item.villa.photos.map((p) => p.url)} alt={item.villa.name} />
                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="text-xl font-bold mb-2">{item.villa.name}</h3>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[11px] font-medium bg-neutral-100 px-2.5 py-1 rounded-md text-neutral-600 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">bed</span> 침실{" "}
                        {item.villa.bedrooms}
                      </span>
                      {item.villa.hasPool && (
                        <span className="text-[11px] font-medium bg-neutral-100 px-2.5 py-1 rounded-md text-neutral-600 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">pool</span> 수영장
                        </span>
                      )}
                      {item.villa.breakfastAvailable ? (
                        <span className="text-[11px] font-medium bg-teal-50 px-2.5 py-1 rounded-md text-teal-600 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">restaurant</span>{" "}
                          조식 포함
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium bg-neutral-100 px-2.5 py-1 rounded-md text-neutral-400 flex items-center gap-1 line-through">
                          <span className="material-symbols-outlined text-[14px]">restaurant</span>{" "}
                          조식 불포함
                        </span>
                      )}
                    </div>
                    {!uniformDates && (
                      <p className="text-xs text-neutral-500 mt-2">
                        {formatKoDateLong(item.checkIn)} → {formatKoDateLong(item.checkOut)} ·{" "}
                        {nightsOf(item.checkIn, item.checkOut)}박
                      </p>
                    )}
                  </div>
                  <div className="flex justify-between items-end border-t border-neutral-50 pt-4">
                    <div>
                      {nightly != null && (
                        <p className="text-[11px] text-neutral-400">
                          1박 {formatPublicAmount(currency, item.priceKrwPerNight, item.priceVndPerNight)}
                        </p>
                      )}
                      <p className="text-lg font-bold text-neutral-900">
                        총 {formatPublicAmount(currency, item.totalKrw, item.totalVnd)}
                      </p>
                    </div>
                    <Link
                      href={`/p/${token}/book/${item.id}`}
                      className="bg-teal-600 text-white px-4 py-3 rounded-lg font-bold text-sm shrink-0 active:scale-95 transition-transform"
                    >
                      이 빌라로 가예약
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <section className="bg-neutral-100/50 rounded-2xl p-6 flex flex-col items-center text-center gap-3 border border-dashed border-neutral-200">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-teal-600">
            <span className="material-symbols-outlined icon-fill">shield</span>
          </div>
          <div>
            <p className="text-neutral-800 font-bold text-base leading-snug">
              가예약 후 {holdHours}시간 내 입금 시
              <br />
              예약이 확정됩니다
            </p>
            <p className="text-neutral-500 text-xs mt-2">
              미입금 시 가예약은 자동으로 취소될 수 있습니다.
            </p>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
