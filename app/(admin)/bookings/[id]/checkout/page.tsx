import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BookingStatus, PhotoSpace, ServiceOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatKrw, formatVnd } from "@/lib/format";
import { minibarItemName } from "@/lib/minibar";
import CheckoutForm, { type ConfirmedServiceOrder } from "./checkout-form";

/**
 * /bookings/[id]/checkout — 체크아웃 검수 (Stitch b4 변환, T3.3)
 * 기준 사진 비교 + 미니바 회사표준 소모 입력(#2b, MinibarItem) + 파손 리포트 + 보증금 처리
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("checkout")} — Villa Go` };
}

/** 기준 사진 공간 정렬 순서 (b4: 거실→주방→침실→…) */
const SPACE_ORDER: PhotoSpace[] = [
  PhotoSpace.LIVING,
  PhotoSpace.KITCHEN,
  PhotoSpace.BEDROOM,
  PhotoSpace.BATHROOM,
  PhotoSpace.BALCONY,
  PhotoSpace.POOL,
  PhotoSpace.EXTERIOR,
  PhotoSpace.ETC,
];

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("adminCheckout");
  const tServices = await getTranslations("adminServices");
  const locale = await getLocale();
  const { id } = await params;

  // 미니바는 회사표준 1세트(#2b, MinibarItem) — 전 빌라 공통. 빌라별 amenities(MINIBAR) 비참조.
  // 게스트 청구서(ADR-0019 S4): 확정 부가옵션(CONFIRMED|DELIVERED)만 — 판매가만(원가 costVnd 미select·마진 비공개).
  const [booking, minibarItems, confirmedOrdersRaw] = await Promise.all([
    prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        guestName: true,
        depositAmount: true,
        depositCurrency: true,
        villa: {
          select: {
            name: true,
            photos: {
              where: { isBaseline: true },
              orderBy: { sortOrder: "asc" },
              select: { id: true, space: true, spaceLabel: true, url: true },
            },
          },
        },
      },
    }),
    prisma.minibarItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, nameKo: true, nameVi: true, unitPriceVnd: true },
    }),
    prisma.serviceOrder.findMany({
      where: {
        bookingId: id,
        status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
      },
      orderBy: { createdAt: "asc" },
      // 판매가만 — costVnd는 select에서 제외(마진 비공개).
      select: {
        id: true,
        type: true,
        quantity: true,
        priceKrw: true,
        priceVnd: true,
        catalogItemId: true,
      },
    }),
  ]);
  if (!booking) notFound();

  // 확정 부가옵션 표시명 — 연결된 카탈로그명(없으면 type 라벨). 판매가만 노출.
  const catalogIds = confirmedOrdersRaw
    .map((o) => o.catalogItemId)
    .filter((cid): cid is string => !!cid);
  const catalogNameById = new Map<string, string>();
  if (catalogIds.length > 0) {
    const cats = await prisma.serviceCatalogItem.findMany({
      where: { id: { in: catalogIds } },
      select: { id: true, nameKo: true },
    });
    for (const c of cats) catalogNameById.set(c.id, c.nameKo);
  }
  const confirmedOrders: ConfirmedServiceOrder[] = confirmedOrdersRaw.map((o) => ({
    id: o.id,
    name:
      (o.catalogItemId && catalogNameById.get(o.catalogItemId)) ||
      tServices(`types.${o.type}`),
    quantity: o.quantity,
    priceKrw: o.priceKrw > 0 ? o.priceKrw : null,
    priceVnd: o.priceVnd != null ? o.priceVnd.toString() : null,
  }));

  // 공간 순서대로 비교 섹션 구성 — 라벨은 spaceLabel 우선, 없으면 공간명
  const sections: { id: string; label: string; baselineUrl: string | null }[] = [
    ...booking.villa.photos,
  ]
    .sort((a, b) => SPACE_ORDER.indexOf(a.space) - SPACE_ORDER.indexOf(b.space))
    .map((p) => ({
      id: p.id,
      label: p.spaceLabel || t(`spaces.${p.space}`),
      baselineUrl: p.url as string | null,
    }));
  // 기준 사진 0장 빌라 — 일반 촬영 슬롯 폴백 (사진 1장 이상 요건 충족 경로 보장, QA D5)
  if (sections.length === 0) {
    sections.push({ id: "general", label: t("generalPhotos"), baselineUrl: null });
  }

  // 회사표준 미니바 — 표시명은 로케일별(vi/ko), 단가는 우리 판매가(BigInt → 문자열).
  const minibar = minibarItems.map((m) => ({
    id: m.id,
    label: minibarItemName(m, locale),
    unitPriceVnd: m.unitPriceVnd.toString(),
  }));

  const depositLabel =
    booking.depositAmount != null
      ? booking.depositCurrency === "KRW"
        ? formatKrw(booking.depositAmount) // ADMIN KRW 표기 규칙 (QA D3)
        : formatVnd(BigInt(booking.depositAmount))
      : null;
  const depositVnd =
    booking.depositAmount != null && booking.depositCurrency === "VND"
      ? String(booking.depositAmount)
      : null;

  return (
    <div className="max-w-7xl mx-auto pb-32">
      {/* 헤더 — b4 TopAppBar 콘텐츠 영역 변환 */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href={`/bookings/${booking.id}`}
          aria-label={t("back")}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <h2 className="font-bold text-lg text-white whitespace-nowrap">
          {t("title")} - {t("bookingNo", { code: booking.id.slice(-4).toUpperCase() })}
        </h2>
        <span className="bg-admin-card text-slate-400 text-xs px-2 py-1 rounded border border-slate-700 whitespace-nowrap">
          {booking.villa.name}
        </span>
      </div>

      {booking.status !== BookingStatus.CHECKED_IN ? (
        <div className="bg-admin-card border border-slate-700 rounded-xl p-10 text-center space-y-3">
          <span className="material-symbols-outlined text-slate-500 text-5xl">
            {booking.status === BookingStatus.CHECKED_OUT ? "task_alt" : "block"}
          </span>
          <p className="text-slate-300 font-bold">
            {booking.status === BookingStatus.CHECKED_OUT
              ? t("alreadyCheckedOut")
              : t("notCheckedIn", { status: booking.status })}
          </p>
          <Link href={`/bookings/${booking.id}`} className="inline-block text-admin-primary text-sm font-bold hover:underline">
            {t("backToBooking")}
          </Link>
        </div>
      ) : (
        <CheckoutForm
          bookingId={booking.id}
          sections={sections}
          minibar={minibar}
          depositLabel={depositLabel}
          depositVnd={depositVnd}
          confirmedOrders={confirmedOrders}
        />
      )}
    </div>
  );
}
