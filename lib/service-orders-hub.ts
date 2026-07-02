// lib/service-orders-hub.ts — 부가서비스 정산·중계 허브 데이터 로더 (서버 전용).
//   ★성능: 발주가 수천 건이라 전량 로드 금지. 서버에서 필터·페이지네이션·집계를 처리하고
//     한 페이지(기본 10건)만 반환한다. 합계 카드는 집계 쿼리, 셀렉터 옵션은 참조 테이블에서 산출.
//   /api/service-orders(뷰 전환·필터·페이지)와 /service-orders 페이지(SSR 초기 1페이지)가 공유.
//   ★ 누수 경계: costVnd(공급자 지급액)만. 판매가·마진 미포함(원칙2). 호출부가 canViewFinance 게이트.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pickI18n, selectedOptionLabels } from "@/lib/service-display";
import { formatVillaName } from "@/lib/villa-name";
import { resolveQuickRange, parseUtcDateOnly } from "@/lib/date-vn";

export type HubOrder = {
  id: string;
  bookingId: string;
  villaName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  itemName: string | null;
  optionLabel: string | null;
  type: string | null;
  quantity: number;
  guestCount: number | null;
  guestName: string | null;
  partnerName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  vendorBankInfo: unknown;
  vendorStatus: "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;
  status: string;
  costVnd: string;
  vendorSettledAt: string | null;
  vendorSettleMethod: "CASH" | "BANK_TRANSFER" | "OTHER" | null;
  vendorSettleNote: string | null;
  poSentAt: string | null;
  vendorRespondedAt: string | null;
  createdAt: string;
};

export type HubOption = { value: string; label: string };
export type HubOptions = {
  items: HubOption[];
  vendors: HubOption[];
  partners: HubOption[];
  villas: HubOption[];
};
export type HubSummary = {
  pendingVnd: string;
  unsettledCount: number;
  paidVnd: string;
  settledCount: number;
};
export type HubView = "pending" | "paid" | "status";
export type HubStatusChip = "all" | "pending" | "accepted" | "rejected" | "cancelled";

export type HubQuery = {
  view: HubView;
  status?: HubStatusChip; // status 뷰에서만
  range?: string;
  itemId?: string;
  vendorId?: string;
  partnerId?: string;
  villaId?: string;
  guest?: string;
  page: number;
  pageSize: number;
};

export type HubResult = { rows: HubOrder[]; total: number; summary: HubSummary };

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** 날짜 프리셋 → [from,to) (YYYY-MM-DD). "tomorrow"만 로컬 계산, 나머지는 공용 resolveQuickRange. */
function rangeBounds(key: string | undefined): { from: string; to: string } | null {
  if (!key || key === "all") return null;
  if (key === "tomorrow") {
    const today = resolveQuickRange("today");
    if (!today) return null;
    const start = today.to; // 오늘의 to = 내일 00:00
    const next = new Date(new Date(`${start}T00:00:00.000Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { from: start, to: next };
  }
  return resolveQuickRange(key);
}

/** 공통 where — 브로커 발주 + 날짜/항목/업체/파트너/빌라/고객명 필터(모두 선택). */
function commonWhere(q: HubQuery): Prisma.ServiceOrderWhereInput {
  const and: Prisma.ServiceOrderWhereInput[] = [{ vendorId: { not: null } }];

  const b = rangeBounds(q.range);
  if (b) {
    const gte = parseUtcDateOnly(b.from)!;
    const lt = parseUtcDateOnly(b.to)!;
    // 기준일 = serviceDate 우선, 없으면 checkIn(둘 다 @db.Date). OR로 폴백 표현.
    and.push({
      OR: [
        { serviceDate: { gte, lt } },
        { serviceDate: null, booking: { is: { checkIn: { gte, lt } } } },
      ],
    });
  }
  if (q.itemId) and.push({ catalogItemId: q.itemId });
  if (q.vendorId) and.push({ vendorId: q.vendorId });
  if (q.partnerId) and.push({ booking: { is: { partnerId: q.partnerId } } });
  if (q.villaId) and.push({ booking: { is: { villaId: q.villaId } } });
  if (q.guest?.trim()) {
    and.push({ booking: { is: { guestName: { contains: q.guest.trim(), mode: "insensitive" } } } });
  }
  return { AND: and };
}

/** 뷰별 where 절 — 공통 필터에 상태 조건을 결합. */
function viewWhere(q: HubQuery): Prisma.ServiceOrderWhereInput {
  const base = commonWhere(q);
  const extra: Prisma.ServiceOrderWhereInput[] = [];
  if (q.view === "pending") {
    extra.push({ vendorStatus: "VENDOR_ACCEPTED", status: { not: "CANCELLED" }, vendorSettledAt: null });
  } else if (q.view === "paid") {
    extra.push({ vendorStatus: "VENDOR_ACCEPTED", status: { not: "CANCELLED" }, vendorSettledAt: { not: null } });
  } else {
    // status 뷰 — 상태 칩
    switch (q.status ?? "all") {
      case "pending":
        extra.push({ vendorStatus: "PENDING_VENDOR", status: { not: "CANCELLED" } });
        break;
      case "accepted":
        extra.push({ vendorStatus: "VENDOR_ACCEPTED", status: { not: "CANCELLED" } });
        break;
      case "rejected":
        extra.push({ vendorStatus: "VENDOR_REJECTED" });
        break;
      case "cancelled":
        extra.push({ status: "CANCELLED" });
        break;
      // all: 추가 조건 없음
    }
  }
  return { AND: [base, ...extra] };
}

function orderByFor(view: HubView): Prisma.ServiceOrderOrderByWithRelationInput[] {
  if (view === "pending") return [{ vendor: { name: "asc" } }, { createdAt: "desc" }];
  if (view === "paid") return [{ vendorSettledAt: "desc" }];
  return [{ createdAt: "desc" }];
}

const ROW_SELECT = {
  id: true,
  bookingId: true,
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
  createdAt: true,
  catalogItemId: true,
  vendorName: true,
  selectedOptions: true,
  vendorId: true,
  vendor: { select: { id: true, name: true, nameKo: true, phone: true, bankInfo: true } },
  booking: {
    select: {
      checkIn: true,
      checkOut: true,
      guestCount: true,
      guestName: true,
      agencyName: true,
      partner: { select: { name: true } },
      villa: { select: { name: true, nameVi: true } },
    },
  },
} satisfies Prisma.ServiceOrderSelect;

type RawRow = Prisma.ServiceOrderGetPayload<{ select: typeof ROW_SELECT }>;

function mapRow(o: RawRow, itemName: string | null, locale: string): HubOrder {
  return {
    id: o.id,
    bookingId: o.bookingId,
    villaName: o.booking?.villa
      ? formatVillaName({ name: o.booking.villa.name, nameVi: o.booking.villa.nameVi })
      : null,
    checkIn: iso(o.booking?.checkIn),
    checkOut: iso(o.booking?.checkOut),
    serviceDate: iso(o.serviceDate),
    serviceTime: o.serviceTime,
    itemName: itemName ?? o.vendorName ?? null,
    optionLabel: selectedOptionLabels(o.selectedOptions, locale).join(" · ") || null,
    type: o.type,
    quantity: o.quantity,
    guestCount: o.booking?.guestCount ?? null,
    guestName: o.booking?.guestName ?? null,
    partnerName: o.booking?.partner?.name ?? o.booking?.agencyName ?? null,
    vendorId: o.vendorId,
    vendorName: o.vendor?.nameKo || o.vendor?.name || o.vendorName || null,
    vendorPhone: o.vendor?.phone ?? null,
    vendorBankInfo: o.vendor?.bankInfo ?? null,
    vendorStatus: o.vendorStatus,
    status: o.status,
    costVnd: o.costVnd.toString(),
    vendorSettledAt: iso(o.vendorSettledAt),
    vendorSettleMethod: o.vendorSettleMethod,
    vendorSettleNote: o.vendorSettleNote,
    poSentAt: iso(o.poSentAt),
    vendorRespondedAt: iso(o.vendorRespondedAt),
    createdAt: iso(o.createdAt) as string,
  };
}

/** 한 뷰의 페이지 + 필터 결과(rows/total) + 전역 합계(summary). */
export async function queryHub(q: HubQuery, locale: string): Promise<HubResult> {
  const where = viewWhere(q);
  const skip = (Math.max(1, q.page) - 1) * q.pageSize;

  // 전역 합계(필터 무관) — 대기/완료 sum·count. 카드 표기용.
  const settleable: Prisma.ServiceOrderWhereInput = {
    vendorId: { not: null },
    vendorStatus: "VENDOR_ACCEPTED",
    status: { not: "CANCELLED" },
  };

  const [total, rows, pend, paid] = await Promise.all([
    prisma.serviceOrder.count({ where }),
    prisma.serviceOrder.findMany({
      where,
      orderBy: orderByFor(q.view),
      skip,
      take: q.pageSize,
      select: ROW_SELECT,
    }),
    prisma.serviceOrder.aggregate({
      where: { ...settleable, vendorSettledAt: null },
      _sum: { costVnd: true },
      _count: true,
    }),
    prisma.serviceOrder.aggregate({
      where: { ...settleable, vendorSettledAt: { not: null } },
      _sum: { costVnd: true },
      _count: true,
    }),
  ]);

  // 카탈로그 항목명 — 이 페이지 rows의 catalogItemId만 조회(소량).
  const itemIds = Array.from(
    new Set(rows.map((o) => o.catalogItemId).filter((v): v is string => !!v))
  );
  const items = itemIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, nameI18n: true },
      })
    : [];
  const nameById = new Map(items.map((i) => [i.id, pickI18n(i.nameKo, i.nameI18n, locale)]));

  return {
    rows: rows.map((o) => mapRow(o, o.catalogItemId ? nameById.get(o.catalogItemId) ?? null : null, locale)),
    total,
    summary: {
      pendingVnd: (pend._sum.costVnd ?? 0n).toString(),
      unsettledCount: pend._count,
      paidVnd: (paid._sum.costVnd ?? 0n).toString(),
      settledCount: paid._count,
    },
  };
}

const byLabel = (a: HubOption, b: HubOption) => a.label.localeCompare(b.label);

/** 셀렉터 옵션 — 참조 테이블에서 산출(소형, 필터 무관). 발주 전량 스캔 회피. */
export async function loadHubOptions(locale: string): Promise<HubOptions> {
  const [items, vendors, partners, villas] = await Promise.all([
    prisma.serviceCatalogItem.findMany({ select: { id: true, nameKo: true, nameI18n: true } }),
    prisma.serviceVendor.findMany({ where: { active: true }, select: { id: true, name: true, nameKo: true } }),
    prisma.partner.findMany({ select: { id: true, name: true } }),
    prisma.villa.findMany({ select: { id: true, name: true, nameVi: true } }),
  ]);
  return {
    items: items.map((i) => ({ value: i.id, label: pickI18n(i.nameKo, i.nameI18n, locale) })).sort(byLabel),
    vendors: vendors.map((v) => ({ value: v.id, label: v.nameKo || v.name })).sort(byLabel),
    partners: partners.map((p) => ({ value: p.id, label: p.name })).sort(byLabel),
    villas: villas.map((v) => ({ value: v.id, label: formatVillaName({ name: v.name, nameVi: v.nameVi }) })).sort(byLabel),
  };
}
