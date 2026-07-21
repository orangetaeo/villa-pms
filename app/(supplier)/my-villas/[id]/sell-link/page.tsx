// 공급자 판매 링크 화면 (ADR-0021 §7 T10.7) — 생성 폼 + 내 링크 목록. vi 모바일·teal.
// 재고 비공개: 자기 빌라만(villa.supplierId === session.user.id, 아니면 notFound).
// 마진 비공개: 링크 목록 금액은 공급자 자기 판매가(VND, ProposalItem.totalVnd)만.
//   ⛔ totalKrw·priceKrwPerNight·운영자 마진은 절대 select 금지(공급자 링크는 VND 전용).
// 자기 링크만: Proposal where seller=SUPPLIER AND supplierId=session.user.id AND 이 빌라.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { BookingSeller } from "@prisma/client";
import { effectiveProposalStatus } from "@/lib/proposal";
import { toDateOnlyString } from "@/lib/date-vn";
import SellLinkClient, { type SupplierSellLinkItem } from "./sell-link-client";

export const metadata: Metadata = {
  title: "Liên kết bán phòng — Villa Go",
};

export default async function SupplierSellLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const { id } = await params;
  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, supplierId: true, name: true },
  });
  // 존재 비노출 — 없거나 타인 소유면 동일하게 404
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "supplierSellLink" });

  // 내 판매 링크만 — seller=SUPPLIER + 내 supplierId + 이 빌라 포함. VND 금액·예약 상태만(누수 0).
  const proposals = await prisma.proposal.findMany({
    where: {
      seller: BookingSeller.SUPPLIER,
      supplierId: session.user.id,
      items: { some: { villaId: villa.id } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      token: true,
      clientName: true,
      status: true,
      expiresAt: true,
      items: {
        where: { villaId: villa.id },
        select: {
          checkIn: true,
          checkOut: true,
          totalVnd: true, // 공급자 판매가(VND)만 — totalKrw 미조회
          booking: { select: { id: true, status: true } },
        },
      },
    },
  });

  const now = new Date();
  const initialLinks: SupplierSellLinkItem[] = proposals
    .map((p) => {
      const item = p.items[0];
      if (!item) return null;
      return {
        token: p.token,
        proposalId: p.id,
        checkIn: toDateOnlyString(item.checkIn),
        checkOut: toDateOnlyString(item.checkOut),
        status: effectiveProposalStatus(p.status, p.expiresAt, now) as
          | "ACTIVE"
          | "USED"
          | "EXPIRED"
          | "REVOKED",
        clientName: p.clientName,
        totalVnd: item.totalVnd != null ? item.totalVnd.toString() : null,
        booking: item.booking
          ? { id: item.booking.id, status: item.booking.status as string }
          : null,
      } satisfies SupplierSellLinkItem;
    })
    .filter((x): x is SupplierSellLinkItem => x !== null);

  return (
    <div className="mx-auto w-full max-w-[420px]">
      {/* 투명 상태바 아래 흰 헤더 → pt-safe + teal 스트립 */}
      <header className="sticky top-0 z-40 w-full bg-white pt-safe shadow-sm">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-safe-top bg-teal-600"
        />
        <div className="flex h-14 w-full items-center px-2">
          <Link
            href={`/my-villas/${villa.id}`}
            aria-label={t("back")}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:bg-neutral-50 active:scale-95"
          >
            <span className="material-symbols-outlined text-teal-600">arrow_back</span>
          </Link>
          <h1 className="flex-1 truncate px-1 text-center text-lg font-semibold text-slate-800">
            {t("title")}
          </h1>
          <div className="h-10 w-10" />
        </div>
      </header>

      <SellLinkClient
        villaId={villa.id}
        villaName={villa.name}
        ratePeriodsHref={`/my-villas/${villa.id}/rate-periods`}
        initialLinks={initialLinks}
      />
    </div>
  );
}
