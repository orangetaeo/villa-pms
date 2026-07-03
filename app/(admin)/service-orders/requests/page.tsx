// /service-orders/requests — 고객(게스트/파트너) 부가서비스 요청 대기 큐 (A3, admin-ops-gaps)
//   그동안 REQUESTED 주문은 각 예약 상세에서만 보여 예약을 순찰해야 발견됐다.
//   전 예약 횡단으로 모아 처리 진입점(예약 상세 링크)을 제공한다.
//   재무 경계: 원가(costVnd)·지급 정보 미노출 — 판매가(VND)만 (운영자 공통 노출 범위).
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isOperator } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { BookingStatus } from "@prisma/client";
import { parsePageParams } from "@/lib/pagination";
import PaginationBar from "@/components/pagination-bar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminServiceRequests");
  return { title: `${t("title")} — Villa Go` };
}

const ACTIVE_BOOKING: BookingStatus[] = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

export default async function ServiceOrderRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const session = await auth();
  if (!session || !isOperator(session.user?.role)) redirect("/login");

  const t = await getTranslations("adminServiceRequests");
  const params = await searchParams;
  const { page, pageSize, skip, take } = parsePageParams(params);

  const where = {
    status: "REQUESTED" as const,
    booking: { status: { in: ACTIVE_BOOKING } },
  };
  const [total, rows] = await Promise.all([
    prisma.serviceOrder.count({ where }),
    prisma.serviceOrder.findMany({
      where,
      orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }],
      skip,
      take,
      select: {
        id: true,
        type: true,
        quantity: true,
        serviceDate: true,
        serviceTime: true,
        requestedVia: true,
        guestNote: true,
        catalogItemId: true,
        createdAt: true,
        booking: {
          select: {
            id: true,
            status: true,
            guestName: true,
            checkIn: true,
            checkOut: true,
            villa: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  // 메뉴명 — 카탈로그 스냅샷 id로 해석(관계 없음), 없으면 type 코드
  const catalogIds = [...new Set(rows.map((r) => r.catalogItemId).filter((v): v is string => !!v))];
  const catalog = catalogIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: catalogIds } },
        select: { id: true, nameKo: true },
      })
    : [];
  const nameById = new Map(catalog.map((c) => [c.id, c.nameKo]));

  const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
          <p className="text-sm text-slate-400 mt-1">{t("subtitle")}</p>
        </div>
        <Link
          href="/service-orders"
          className="text-xs font-bold text-slate-300 hover:text-white border border-slate-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          {t("toHub")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 bg-admin-card border border-slate-800/50 rounded-xl p-6">
          {t("empty")}
        </p>
      ) : (
        <div className="bg-admin-card border border-slate-800/50 rounded-xl divide-y divide-slate-800/60">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/bookings/${r.booking.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-slate-800/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white truncate">
                  {nameById.get(r.catalogItemId ?? "") ?? r.type}
                  <span className="text-slate-400 font-medium"> × {r.quantity}</span>
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {r.booking.villa.name} · {r.booking.guestName} · {d10(r.booking.checkIn)} →{" "}
                  {d10(r.booking.checkOut)}
                </p>
                {r.guestNote && (
                  <p className="text-xs text-slate-500 truncate">“{r.guestNote}”</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-amber-400 font-bold tabular-nums">
                  {d10(r.serviceDate)} {r.serviceTime ?? ""}
                </p>
                <p className="text-[10px] text-slate-500 uppercase">
                  {r.requestedVia === "GUEST" ? t("viaGuest") : t("viaPartner")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <PaginationBar total={total} page={page} pageSize={pageSize} />
    </div>
  );
}
