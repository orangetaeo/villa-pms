// /api/vendor/orders — 원천 공급자 본인 발주 목록 (ADR-0023 S2 §4.3)
//   GET: Role=VENDOR + 본인 vendorId 스코프 강제(서버). 자기 발주만.
//   ★성능: 발주가 수백~수천 건이라 전량 로드 금지. 탭별로 스코프 + 페이지네이션(한 페이지 10건).
//     params: tab(inbox|schedule|settlement)·sub(pending|paid)·search·page·pageSize.
//   ★ 누수: 우리 판매가(priceKrw/priceVnd)·마진 절대 미포함. costVnd(=지급액=그의 매출)만.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { getSupplierLocale } from "@/lib/locale";
import { pickI18n, selectedOptionLabels } from "@/lib/service-display";
import { formatVillaName } from "@/lib/villa-name";
import { parsePageParams } from "@/lib/pagination";

const ROW_SELECT = {
  id: true,
  type: true,
  status: true,
  vendorStatus: true,
  serviceDate: true,
  serviceTime: true,
  quantity: true,
  costVnd: true,
  vendorSettledAt: true,
  vendorSettleMethod: true,
  vendorSettleNote: true,
  poSentAt: true,
  vendorRespondedAt: true,
  vendorCompletedAt: true,
  // 시간 제안(propose) 현황 — 본인 스코프(판매가 무관). 미해결/결과 뱃지·시간제안 탭용(ADR-0035)
  proposedServiceDate: true,
  proposedServiceTime: true,
  vendorProposalNote: true,
  vendorProposalRespondedAt: true,
  vendorProposalOutcome: true,
  createdAt: true,
  catalogItemId: true,
  vendorName: true,
  guestNote: true,
  selectedOptions: true,
  ticketUrls: true, // 티켓형(TICKET) 발행 이미지 URL — 벤더 자기 발주만(판매가 미포함)
  booking: {
    // address: 이행 장소 — 본인에게 발주된 빌라만 이 select를 타므로 재고 비공개 원칙과 무관(계약 A)
    select: { checkIn: true, checkOut: true, guestCount: true, villa: { select: { name: true, nameVi: true, address: true } } },
  },
} satisfies Prisma.ServiceOrderSelect;

type RawRow = Prisma.ServiceOrderGetPayload<{ select: typeof ROW_SELECT }>;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

async function mapRows(rows: RawRow[], locale: string) {
  const itemIds = Array.from(new Set(rows.map((o) => o.catalogItemId).filter((v): v is string => !!v)));
  const items = itemIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, nameI18n: true, pickupAvailable: true },
      })
    : [];
  const nameById = new Map(items.map((i) => [i.id, pickI18n(i.nameKo, i.nameI18n, locale)]));
  const pickupById = new Map(items.map((i) => [i.id, i.pickupAvailable === true]));
  return rows.map((o) => ({
    id: o.id,
    villaName: o.booking?.villa ? formatVillaName({ name: o.booking.villa.name, nameVi: o.booking.villa.nameVi }) : null,
    villaAddress: o.booking?.villa?.address ?? null,
    checkIn: iso(o.booking?.checkIn),
    checkOut: iso(o.booking?.checkOut),
    serviceDate: iso(o.serviceDate),
    serviceTime: o.serviceTime,
    itemName: (o.catalogItemId ? nameById.get(o.catalogItemId) : null) ?? o.vendorName ?? null,
    optionLabel: selectedOptionLabels(o.selectedOptions, locale).join(" · ") || null,
    type: o.type,
    ticketUrls: o.ticketUrls, // TICKET 발행 이미지(발행 현황·삭제용)
    quantity: o.quantity,
    guestCount: o.booking?.guestCount ?? null,
    guestNote: o.guestNote,
    pickupAvailable: o.catalogItemId ? pickupById.get(o.catalogItemId) ?? false : false,
    vendorStatus: o.vendorStatus,
    status: o.status,
    costVnd: o.costVnd.toString(),
    vendorSettledAt: iso(o.vendorSettledAt),
    vendorSettleMethod: o.vendorSettleMethod,
    vendorSettleNote: o.vendorSettleNote,
    poSentAt: iso(o.poSentAt),
    vendorRespondedAt: iso(o.vendorRespondedAt),
    vendorCompletedAt: iso(o.vendorCompletedAt),
    // 시간 제안 현황 — 제안값·메모·해결 시각·결과 스냅샷(ADR-0035). 판매가 미포함.
    proposedServiceDate: iso(o.proposedServiceDate),
    proposedServiceTime: o.proposedServiceTime,
    vendorProposalNote: o.vendorProposalNote,
    vendorProposalRespondedAt: iso(o.vendorProposalRespondedAt),
    vendorProposalOutcome: o.vendorProposalOutcome,
  }));
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const vendorId = await getVendorIdForUser(session.user.id);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  const locale = await getSupplierLocale(session.user.locale);
  const sp = new URL(req.url).searchParams;
  const tab = (["inbox", "proposal", "schedule", "settlement"] as const).includes(sp.get("tab") as never)
    ? (sp.get("tab") as "inbox" | "proposal" | "schedule" | "settlement")
    : "inbox";
  const sub = sp.get("sub") === "paid" ? "paid" : "pending";
  const q = (sp.get("search") ?? "").trim();
  const { page, pageSize, skip, take } = parsePageParams({
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });

  // 검색 — 빌라명 또는 카탈로그 품목명(현지화 라벨은 서버에서 못 거르므로 nameKo/nameVi 기준) 부분일치.
  let searchWhere: Prisma.ServiceOrderWhereInput | undefined;
  if (q) {
    const matchItems = await prisma.serviceCatalogItem.findMany({
      where: { OR: [{ nameKo: { contains: q, mode: "insensitive" } }, { nameVi: { contains: q, mode: "insensitive" } }] },
      select: { id: true },
    });
    const ids = matchItems.map((i) => i.id);
    searchWhere = {
      OR: [
        { booking: { is: { villa: { is: { OR: [{ name: { contains: q, mode: "insensitive" } }, { nameVi: { contains: q, mode: "insensitive" } }] } } } } },
        { vendorName: { contains: q, mode: "insensitive" } },
        ...(ids.length ? [{ catalogItemId: { in: ids } }] : []),
      ],
    };
  }
  const withSearch = (w: Prisma.ServiceOrderWhereInput): Prisma.ServiceOrderWhereInput =>
    searchWhere ? { AND: [w, searchWhere] } : w;

  const base: Prisma.ServiceOrderWhereInput = { vendorId };
  // 탭 뱃지 카운트 — 항상(검색 무관). 발주함=응답 대기, 시간제안=미해결 제안(고객 응답 대기).
  const [inboxCount, proposalPendingCount] = await Promise.all([
    prisma.serviceOrder.count({
      where: { ...base, vendorStatus: "PENDING_VENDOR", status: { not: "CANCELLED" } },
    }),
    prisma.serviceOrder.count({
      where: {
        ...base,
        proposedServiceDate: { not: null },
        vendorProposalRespondedAt: null,
        status: { not: "CANCELLED" },
      },
    }),
  ]);

  let where: Prisma.ServiceOrderWhereInput;
  let orderBy: Prisma.ServiceOrderOrderByWithRelationInput[];
  if (tab === "inbox") {
    where = withSearch({ ...base, vendorStatus: "PENDING_VENDOR", status: { not: "CANCELLED" } });
    orderBy = [{ createdAt: "desc" }];
  } else if (tab === "proposal") {
    // 시간 제안 탭 — 내가 propose한 발주(제안값 존재). 미해결(respondedAt null) 우선 정렬 후 최신순.
    //   취소 건은 제외(추적 의미 없음). 판매가·마진 미포함(ROW_SELECT 화이트리스트).
    where = withSearch({ ...base, proposedServiceDate: { not: null }, status: { not: "CANCELLED" } });
    orderBy = [{ vendorProposalRespondedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }];
  } else if (tab === "schedule") {
    where = withSearch({ ...base, vendorStatus: "VENDOR_ACCEPTED", status: { not: "CANCELLED" } });
    orderBy = [{ serviceDate: "asc" }, { createdAt: "desc" }];
  } else {
    where = withSearch({
      ...base,
      vendorStatus: "VENDOR_ACCEPTED",
      status: { not: "CANCELLED" },
      vendorSettledAt: sub === "paid" ? { not: null } : null,
    });
    orderBy = sub === "paid" ? [{ vendorSettledAt: "desc" }] : [{ serviceDate: "asc" }, { createdAt: "desc" }];
  }

  const [total, rawRows] = await Promise.all([
    prisma.serviceOrder.count({ where }),
    prisma.serviceOrder.findMany({ where, orderBy, skip, take, select: ROW_SELECT }),
  ]);
  const rows = await mapRows(rawRows, locale);

  const res: Record<string, unknown> = { orders: rows, total, inboxCount, proposalPendingCount, page, pageSize };

  // 예약현황 탭 — 취소됐지만 이미 발주됐던 건(이행 중단 안내 배너). 소량이라 상단 50건만.
  if (tab === "schedule") {
    const cancelledRaw = await prisma.serviceOrder.findMany({
      where: withSearch({ ...base, status: "CANCELLED", poSentAt: { not: null } }),
      orderBy: [{ serviceDate: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: ROW_SELECT,
    });
    res.cancelled = await mapRows(cancelledRaw, locale);
  }

  // 정산 탭 — 전역 합계(검색 무관): 대기/완료 sum·count.
  if (tab === "settlement") {
    const settleable: Prisma.ServiceOrderWhereInput = { ...base, vendorStatus: "VENDOR_ACCEPTED", status: { not: "CANCELLED" } };
    const [pend, paid] = await Promise.all([
      prisma.serviceOrder.aggregate({ where: { ...settleable, vendorSettledAt: null }, _sum: { costVnd: true }, _count: true }),
      prisma.serviceOrder.aggregate({ where: { ...settleable, vendorSettledAt: { not: null } }, _sum: { costVnd: true }, _count: true }),
    ]);
    res.settleTotals = {
      pendingVnd: (pend._sum.costVnd ?? 0n).toString(),
      unsettledCount: pend._count,
      paidVnd: (paid._sum.costVnd ?? 0n).toString(),
      settledCount: paid._count,
    };
  }

  return NextResponse.json(res);
}
