import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Currency, ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectiveProposalStatus } from "@/lib/proposal";
import { resolveHoldHours, HOLD_HOURS_DEFAULT_KEY } from "@/lib/hold";
import { ExpiredView } from "../_components/expired-view";
import { PublicFooter } from "../_components/public-footer";
import { PhotoCarousel } from "../_components/photo-carousel";
import { ShareButton } from "../_components/share-button";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { CopyButton } from "../_components/copy-button";
import { LangSelector } from "../_components/lang-selector";
import { getPublicBankInfo } from "../_components/public-bank";
import {
  CANCELLATION_POLICY_KEY,
  parseCancellationPolicy,
  type CancellationPolicy,
} from "@/lib/cancellation-policy";
import { formatPublicAmount } from "../_components/public-format";
import { VillaSalesSection } from "../_components/villa-sales-section";
import {
  PUBLIC_LABELS,
  PUBLIC_META,
  PUBLIC_LOCALE_COOKIE,
  resolvePublicLang,
  formatPublicDateLong,
} from "@/lib/public-i18n";
import type { BedTypeKey } from "@/lib/bedding";
import type { FeatureCategoryKey } from "@/lib/features";

/**
 * /p/[token] — 공개 제안 페이지 (비로그인, 5개 언어 #5) — Stitch c1/c1-vnd 변환 (SPEC F3 흐름 2)
 *
 * 재고·마진 비공개: 이 제안에 포함된 빌라·날짜·판매가만 노출. 원가·마진·타통화
 * 환산·다른 재고는 절대 노출 금지. 상태는 서버 판정값으로 단일 렌더(c2, T5.5).
 * 언어: ?lang= 파라미터 > p-locale 쿠키 > ko (lib/public-i18n).
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);
  return { title: `${PUBLIC_META[lang].proposal} | Villa Go` };
}

async function getContactSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["CONTACT_KAKAO_URL", "CONTACT_PHONE"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { kakaoUrl: get("CONTACT_KAKAO_URL"), phone: get("CONTACT_PHONE") };
}

// 취소·환불 정책 (#6b) — 전 빌라 공용. 미설정·손상 시 기본값 폴백(공개 표시 안전).
async function getCancellationPolicy(): Promise<CancellationPolicy> {
  const row = await prisma.appSetting.findUnique({
    where: { key: CANCELLATION_POLICY_KEY },
    select: { value: true },
  });
  return parseCancellationPolicy(row?.value);
}

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ notice?: string; lang?: string }>;
}) {
  const { token } = await params;
  const { notice, lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);
  const t = PUBLIC_LABELS[lang];

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
            // ⚠ select 화이트리스트 — wifiSsid·wifiPassword 절대 미포함 (ADR-0011 §4.3).
            // findUnique({where})로 전체 컬럼 로드 후 직렬화 금지 — 신규 공개 필드만 명시 추가.
            select: {
              name: true,
              bedrooms: true,
              maxGuests: true,
              hasPool: true,
              breakfastAvailable: true,
              // 판매정보 공개 필드 (마진·판매가 아님 — 누수 무관). wifi 2종은 제외
              googleMapUrl: true,
              beachDistanceM: true,
              areaSqm: true,
              floors: true,
              checkInTime: true,
              checkOutTime: true,
              smokingAllowed: true,
              petsAllowed: true,
              partyAllowed: true,
              parkingSlots: true,
              baseDepositVnd: true, // 기준 보증금은 고객 안내용 — 공개 OK
              extraBedAvailable: true,
              bedroomDetails: {
                orderBy: { roomIndex: "asc" },
                select: {
                  roomIndex: true,
                  roomLabel: true,
                  bedType: true,
                  bedCount: true,
                  capacity: true,
                },
              },
              features: { select: { category: true, featureKey: true } },
              // ⛔ wifiSsid·wifiPassword 미포함 (체크인 화면 전용)
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
    return <ExpiredView variant={variant} kakaoUrl={contact.kakaoUrl} phone={contact.phone} lang={lang} />;
  }

  const holdSetting = await prisma.appSetting.findUnique({
    where: { key: HOLD_HOURS_DEFAULT_KEY },
  });
  const holdHours = resolveHoldHours(holdSetting?.value);

  const currency = proposal.saleCurrency;
  // #6a — 입금 계좌 안내(메인 페이지). 통화별 계좌 자동 선택. 미설정 시 null(섹션 미렌더).
  const bank = await getPublicBankInfo(currency);
  // #6b — 취소·환불 정책(전 빌라 공용). 각 빌라 카드에 동일 전달.
  const cancellationPolicy = await getCancellationPolicy();
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
        <span className="flex items-center gap-1.5">
          <VillaGoMark className="h-6 w-auto" />
          <VillaGoWordmark className="text-xl" villa="text-slate-900" go="text-teal-600" />
        </span>
        <div className="flex items-center gap-1">
          <LangSelector current={lang} />
          <ShareButton title={`${t.proposal.forClient(proposal.clientName)} | Villa Go`} lang={lang} />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">
              {t.proposal.forClient(proposal.clientName)}
            </h2>
            <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider animate-pulse shrink-0">
              {t.expiryBadge(Math.floor((proposal.expiresAt.getTime() - now.getTime()) / 3_600_000))}
            </span>
          </div>
          <p className="text-neutral-500 text-sm">{t.proposal.subtitle}</p>
        </section>

        {uniformDates && (
          <div className="bg-white border border-neutral-100 rounded-xl p-4 flex items-center gap-4 shadow-sm">
            <div className="bg-teal-50 text-teal-600 p-3 rounded-lg">
              <span className="material-symbols-outlined">calendar_month</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-neutral-800">
                {formatPublicDateLong(first.checkIn, lang)} → {formatPublicDateLong(first.checkOut, lang)}
              </p>
              <p className="text-xs text-neutral-500">{t.proposal.nights(nightsOf(first.checkIn, first.checkOut))}</p>
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
                <PhotoCarousel urls={item.villa.photos.map((p) => p.url)} alt={item.villa.name} lang={lang} />
                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="text-xl font-bold mb-2">{item.villa.name}</h3>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[11px] font-medium bg-neutral-100 px-2.5 py-1 rounded-md text-neutral-600 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">bed</span>{" "}
                        {t.proposal.bedrooms(item.villa.bedrooms)}
                      </span>
                      {item.villa.hasPool && (
                        <span className="text-[11px] font-medium bg-neutral-100 px-2.5 py-1 rounded-md text-neutral-600 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">pool</span> {t.proposal.pool}
                        </span>
                      )}
                      {item.villa.breakfastAvailable ? (
                        <span className="text-[11px] font-medium bg-teal-50 px-2.5 py-1 rounded-md text-teal-600 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">restaurant</span>{" "}
                          {t.proposal.breakfastOn}
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium bg-neutral-100 px-2.5 py-1 rounded-md text-neutral-400 flex items-center gap-1 line-through">
                          <span className="material-symbols-outlined text-[14px]">restaurant</span>{" "}
                          {t.proposal.breakfastOff}
                        </span>
                      )}
                    </div>
                    {!uniformDates && (
                      <p className="text-xs text-neutral-500 mt-2">
                        {formatPublicDateLong(item.checkIn, lang)} → {formatPublicDateLong(item.checkOut, lang)} ·{" "}
                        {t.proposal.nights(nightsOf(item.checkIn, item.checkOut))}
                      </p>
                    )}
                  </div>

                  {/* 판매정보 표시 섹션 (ADR-0011, c1-villa-details) — wifi 미렌더(BE select 제외) */}
                  <VillaSalesSection
                    villa={{
                      maxGuests: item.villa.maxGuests,
                      googleMapUrl: item.villa.googleMapUrl,
                      beachDistanceM: item.villa.beachDistanceM,
                      areaSqm: item.villa.areaSqm,
                      floors: item.villa.floors,
                      checkInTime: item.villa.checkInTime,
                      checkOutTime: item.villa.checkOutTime,
                      smokingAllowed: item.villa.smokingAllowed,
                      petsAllowed: item.villa.petsAllowed,
                      partyAllowed: item.villa.partyAllowed,
                      parkingSlots: item.villa.parkingSlots,
                      baseDepositVnd: item.villa.baseDepositVnd,
                      extraBedAvailable: item.villa.extraBedAvailable,
                      bedrooms: item.villa.bedroomDetails.map((b) => ({
                        roomIndex: b.roomIndex,
                        bedType: b.bedType as BedTypeKey,
                        bedCount: b.bedCount,
                      })),
                      features: item.villa.features.map((f) => ({
                        category: f.category as FeatureCategoryKey,
                        featureKey: f.featureKey,
                      })),
                    }}
                    cancellationPolicy={cancellationPolicy}
                    lang={lang}
                  />

                  <div className="flex justify-between items-end border-t border-neutral-50 pt-4">
                    <div>
                      {nightly != null && (
                        <p className="text-[11px] text-neutral-400">
                          {t.proposal.perNight} {formatPublicAmount(currency, item.priceKrwPerNight, item.priceVndPerNight, lang)}
                        </p>
                      )}
                      <p className="text-lg font-bold text-neutral-900">
                        {t.proposal.total} {formatPublicAmount(currency, item.totalKrw, item.totalVnd, lang)}
                      </p>
                    </div>
                    <Link
                      href={`/p/${token}/book/${item.id}?lang=${lang}`}
                      className="bg-teal-600 text-white px-4 py-3 rounded-lg font-bold text-sm shrink-0 active:scale-95 transition-transform"
                    >
                      {t.proposal.bookCta}
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
            <p className="text-neutral-800 font-bold text-base leading-snug whitespace-pre-line">
              {t.proposal.holdNotice(holdHours)}
            </p>
            <p className="text-neutral-500 text-xs mt-2">{t.proposal.holdNoticeSub}</p>
          </div>
        </section>

        {/* #6a 입금 계좌 안내 — 통화별 회사 계좌(금액은 가예약 후 안내). 미설정 시 미렌더 */}
        {bank && (
          <section className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-bold text-teal-600 tracking-wider">{t.proposal.bankLabel}</p>
              <h4 className="text-base font-bold">{t.proposal.bankTitle}</h4>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm border-b border-neutral-50 pb-3">
                <span className="text-neutral-500">{t.proposal.bankName}</span>
                <span className="font-semibold">{bank.name}</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-neutral-50 pb-3">
                <span className="text-neutral-500">{t.proposal.bankNumber}</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{bank.number}</span>
                  <CopyButton text={bank.number} lang={lang} />
                </div>
              </div>
              {bank.holder && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-neutral-500">{t.proposal.bankHolder}</span>
                  <span className="font-semibold">{bank.holder}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">{t.proposal.bankNote}</p>
          </section>
        )}
      </main>

      <PublicFooter lang={lang} />
    </div>
  );
}
