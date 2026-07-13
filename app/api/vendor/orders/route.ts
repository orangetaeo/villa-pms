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
import { parseUtcDateOnly } from "@/lib/date-vn";
import { whitelistTicketGuests } from "@/lib/ticket-guests";
import { EXCLUDE_FREE_TICKET_WHERE } from "@/lib/service-order";

const ROW_SELECT = {
  id: true,
  type: true,
  status: true,
  vendorStatus: true,
  serviceDate: true,
  serviceTime: true,
  quantity: true,
  costVnd: true,
  // ★무료 티켓 판정(freeEntry) 전용 — 판매가 스냅샷. 응답에는 boolean만 파생하고 이 값 자체는 절대 미노출(누수 0).
  priceVnd: true,
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
  customerName: true, // ★이용자 이름 스냅샷 — 없으면 예약 대표자(guestName) 폴백. 이름만(전화 등 다른 PII 금지)
  selectedOptions: true,
  ticketUrls: true, // 티켓형(TICKET) 발행 이미지 URL — 벤더 자기 발주만(판매가 미포함)
  // TICKET 주문별 투숙객 선택 스냅샷(ADR-0036 개정) — 소비자가 신청 시 고른 이용자(이름·생년월일·신장).
  //   ★전체명단 폴백 제거: 수량≠명단 오해("1장 티켓에 소비자 3명") 때문에 스냅샷만 노출. 비면 "이용자 미지정".
  ticketGuests: true,
  booking: {
    // address: 이행 장소 — 본인에게 발주된 빌라만 이 select를 타므로 재고 비공개 원칙과 무관(계약 A)
    // guestName: 이용자 이름 폴백용(customerName 미기록 구주문). ★이름만 — 전화(guestPhone) 절대 미포함.
    select: { checkIn: true, checkOut: true, guestCount: true, guestName: true, villa: { select: { name: true, nameVi: true, address: true } } },
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

  return rows.map((o) => {
    const row = {
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
    // ★무료 티켓(판매가 0) — QR 발행·제시 불필요. 서버 파생 boolean만(판매가 값 자체는 절대 미노출).
    //   화면은 이 플래그로 발행 패널 대신 "무료 입장" 안내를 렌더한다(ADR-0034 §3-1 무료 예외).
    freeEntry: o.type === "TICKET" && o.priceVnd === 0n,
    ticketUrls: o.ticketUrls, // TICKET 발행 이미지(발행 현황·삭제용)
    quantity: o.quantity,
    guestCount: o.booking?.guestCount ?? null,
    // ★이용자 이름 — 주문 스냅샷 우선, 없으면 예약 대표자(guestName) 폴백. 단일 필드(이름만).
    customerName: o.customerName ?? o.booking?.guestName ?? null,
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
    };
    // guests는 TICKET 행에만 부착 — 비TICKET 응답 shape 불변(키 자체 없음).
    //   ★주문 스냅샷(ticketGuests)만 — 소비자가 신청 시 고른 이용자(이름·생년월일·신장). 비면 빈 배열 →
    //     화면은 "이용자 미지정" 안내. 전체명단 폴백 없음(ADR-0036 개정: 수량≠명단 오해 제거).
    if (o.type === "TICKET") {
      return { ...row, guests: whitelistTicketGuests(o.ticketGuests) };
    }
    return row;
  });
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

  // 검색 — 빌라명·카탈로그 품목명(현지화 라벨은 서버에서 못 거르므로 nameKo/nameVi 기준)·이용자 이름 부분일치.
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
        // ★이용자 이름 — 화면 표시값(customerName ?? booking.guestName)과 동일 규칙으로 매칭:
        //   customerName이 있으면 그것만, 없으면(구주문·관리자 발주) 대표자명 폴백으로 검색.
        { customerName: { contains: q, mode: "insensitive" } },
        { AND: [{ customerName: null }, { booking: { is: { guestName: { contains: q, mode: "insensitive" } } } }] },
        ...(ids.length ? [{ catalogItemId: { in: ids } }] : []),
      ],
    };
  }
  // ★ 날짜 필터 — serviceDate(@db.Date, UTC 자정) 기준 from ≤ serviceDate ≤ to(양끝 포함).
  //   parseUtcDateOnly로 검증하고 불량/미지정 값은 무시(관용) — 잘못된 입력에 400 대신 조건 미적용.
  //   serviceDate null인 주문은 gte/lte 어느 쪽이든 자연 제외된다.
  const fromDate = parseUtcDateOnly(sp.get("from") ?? "");
  const toDate = parseUtcDateOnly(sp.get("to") ?? "");
  let dateWhere: Prisma.ServiceOrderWhereInput | undefined;
  if (fromDate || toDate) {
    dateWhere = {
      serviceDate: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    };
  }

  // ★ 품목(티켓 분류) 필터 — catalogItemId 정확일치. 본인 vendorId 스코프가 base라 타 벤더 itemId를
  //   넣어도 빈 결과일 뿐(누수 없음). 불량 값(비문자열·40자 초과)은 무시(관용) — 날짜 필터와 동일 원칙.
  const rawItemId = sp.get("itemId");
  const itemWhere: Prisma.ServiceOrderWhereInput | undefined =
    rawItemId && rawItemId.length <= 40 ? { catalogItemId: rawItemId } : undefined;

  // 목록 where에 검색·날짜·품목 필터를 AND로 합친다. 뱃지 카운트·settleTotals는 이 헬퍼를 쓰지 않으므로
  //   항상 필터 무관(전역) 유지 — "할 일 총량" 뱃지·정산 합계 의미 보존.
  const withFilters = (w: Prisma.ServiceOrderWhereInput): Prisma.ServiceOrderWhereInput => {
    const extra: Prisma.ServiceOrderWhereInput[] = [];
    if (searchWhere) extra.push(searchWhere);
    if (dateWhere) extra.push(dateWhere);
    if (itemWhere) extra.push(itemWhere);
    return extra.length ? { AND: [w, ...extra] } : w;
  };

  // ★무료 항목 제외(테오): 소비자 무료(priceVnd=0)이면서 벤더 지급도 0(costVnd=0)인 TICKET은
  //   벤더가 할 일도 받을 돈도 없는 라인 → 발주함·예약현황·정산·뱃지 전부에서 숨긴다.
  //   base에 넣어 모든 count·findMany·aggregate(...base 사용)로 자동 전파.
  //   ★경계·SQL 3치 논리는 EXCLUDE_FREE_TICKET_WHERE(lib/service-order.ts) 주석에 정본으로 보존.
  //   (허브·벤더 통계와 동일 상수 재사용 — 세 화면 정산 정의 동기화.)
  const base: Prisma.ServiceOrderWhereInput = {
    vendorId,
    ...EXCLUDE_FREE_TICKET_WHERE,
  };
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
    where = withFilters({ ...base, vendorStatus: "PENDING_VENDOR", status: { not: "CANCELLED" } });
    orderBy = [{ createdAt: "desc" }];
  } else if (tab === "proposal") {
    // 시간 제안 탭 — 내가 propose한 발주(제안값 존재). 미해결(respondedAt null) 우선 정렬 후 최신순.
    //   취소 건은 제외(추적 의미 없음). 판매가·마진 미포함(ROW_SELECT 화이트리스트).
    where = withFilters({ ...base, proposedServiceDate: { not: null }, status: { not: "CANCELLED" } });
    orderBy = [{ vendorProposalRespondedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }];
  } else if (tab === "schedule") {
    where = withFilters({ ...base, vendorStatus: "VENDOR_ACCEPTED", status: { not: "CANCELLED" } });
    orderBy = [{ serviceDate: "asc" }, { createdAt: "desc" }];
  } else {
    where = withFilters({
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
      where: withFilters({ ...base, status: "CANCELLED", poSentAt: { not: null } }),
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
