import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BookingStatus, ServiceOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatKrw, formatVnd } from "@/lib/format";
import { minibarItemName } from "@/lib/minibar";
import { effectivePar } from "@/lib/minibar-inventory";
import { getDailyRates } from "@/lib/fx-rates";
import CheckoutForm, { type ConfirmedServiceOrder } from "./checkout-form";

/**
 * /bookings/[id]/checkout — 체크아웃 검수 (Stitch b4 변환, T3.3)
 * 미니바 회사표준 소모 입력(#2b, MinibarItem) + 게스트 청구·다통화 수납 + 파손 리포트 + 보증금 처리.
 * 사진 비교 섹션은 정책 변경(2026-07-10)으로 제거 — 파손 시에만 증빙 사진 입력.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("checkout")} — Villa Go` };
}

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
        depositStatus: true,
        villaId: true,
        villa: { select: { name: true } },
      },
    }),
    prisma.minibarItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, nameKo: true, nameVi: true, unitPriceVnd: true, stockQty: true },
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

  // 미니바 par(비치목표)·현재고(onHand) 빌라별 로드 — "남은 수량" 입력 기본값·표시용.
  //   par = VillaMinibarStock.qty(빌라 오버라이드) ?? MinibarItem.stockQty(회사표준).
  //   onHand = MinibarStockMovement ΣqtyDelta(원장 단일소스). 빌라 없으면 빈 맵(par=stockQty 폴백).
  const minibarItemIds = minibarItems.map((m) => m.id);
  const [parOverrides, onHandSums] = await Promise.all([
    minibarItemIds.length > 0
      ? prisma.villaMinibarStock.findMany({
          where: { villaId: booking.villaId, minibarItemId: { in: minibarItemIds } },
          select: { minibarItemId: true, qty: true },
        })
      : Promise.resolve([] as { minibarItemId: string; qty: number }[]),
    minibarItemIds.length > 0
      ? prisma.minibarStockMovement.groupBy({
          by: ["minibarItemId"],
          where: { villaId: booking.villaId, minibarItemId: { in: minibarItemIds } },
          _sum: { qtyDelta: true },
        })
      : Promise.resolve([] as { minibarItemId: string; _sum: { qtyDelta: number | null } }[]),
  ]);
  const overrideMap = new Map(parOverrides.map((o) => [o.minibarItemId, o.qty]));
  const onHandMap = new Map(onHandSums.map((s) => [s.minibarItemId, s._sum.qtyDelta ?? 0]));

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

  // 회사표준 미니바 — 표시명은 로케일별(vi/ko), 단가는 우리 판매가(BigInt → 문자열).
  //   par(비치목표)·onHand(현재고)를 함께 내려 "남은 수량" 입력 UX의 기본값·표시에 사용.
  const minibar = minibarItems.map((m) => ({
    id: m.id,
    label: minibarItemName(m, locale),
    unitPriceVnd: m.unitPriceVnd.toString(),
    par: effectivePar(overrideMap.get(m.id) ?? null, m.stockQty),
    onHand: onHandMap.get(m.id) ?? 0,
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

  // 오늘 환율(HCM 기준) — 미니바·청구서·수납 환산 "≈" 표시용. 장애 시 null(환산줄 생략).
  const rates = await getDailyRates(prisma);
  const fx = rates
    ? { date: rates.date, vndPerKrw: rates.vndPerUnit.KRW, vndPerUsd: rates.vndPerUnit.USD }
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
          minibar={minibar}
          depositLabel={depositLabel}
          depositVnd={depositVnd}
          depositStatus={booking.depositStatus}
          confirmedOrders={confirmedOrders}
          fx={fx}
        />
      )}
    </div>
  );
}
