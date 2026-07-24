// GET /api/zalo/conversations/[id]/candidates — 공유 후보 지연 조회 (perf, 2026-06-24)
// 기존엔 /messages page.tsx가 대화 클릭마다(RSC) 공유 후보(빌라/제안/정산)를 미리 조회했다.
// 후보는 "공유" 모달을 열 때만 필요하므로, 매 클릭 비용에서 분리해 모달 첫 오픈 시 1회 조회한다.
//
// 누수 불변식(사업 원칙 2 — page.tsx 원본 화이트리스트를 그대로 이식):
//  - SUPPLIER 대화: 그 공급자 소유 빌라만(원가 supplierCostVnd만) + 본인 정산만. 제안 후보 없음.
//  - 판매가측(CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY): ACTIVE+isSellable 빌라(판매가만) + ACTIVE 제안(판매가 총액만).
//    원가·마진은 어떤 후보 쿼리에도 영구 미조회.
//  - UNKNOWN/그 외: 모두 빈 배열(분류 전 대화는 공유 잠금).
// 본인(ownerAdminId) 대화만(ADR-0007) — 타 관리자 대화 id 추측은 404.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { Currency, ZaloCounterpartyType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { isSellSideType, tierForCounterparty } from "@/lib/zalo-counterparty";
import { pickLowestSalePrice, pickLowestSupplierCost } from "@/lib/pricing";
import { formatVillaName } from "@/lib/villa-name";
import type {
  VillaCandidate,
  ProposalCandidate,
  SettlementCandidate,
} from "@/app/(admin)/messages/chat-pane";

// yearMonth("2026-06") → 현지화 라벨(page.tsx settlementLabel과 동일 규칙).
function settlementLabel(
  yearMonth: string,
  label: (year: number, month: number) => string
): string {
  const [y, m] = yearMonth.split("-");
  return label(Number(y), Number(m));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — 운영자 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const ownerAdminId = session.user.id;

  // 본인 대화만 — 미존재/타 관리자 대화는 404(누수 0). 분기에 필요한 최소 필드만.
  const conv = await prisma.zaloConversation.findFirst({
    where: { id, ownerAdminId },
    select: { counterpartyType: true, userId: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const tm = await getTranslations("adminMessages");
  const now = new Date();
  const counterpartyType = conv.counterpartyType;

  let villaCandidates: VillaCandidate[] = [];
  let proposalCandidates: ProposalCandidate[] = [];
  let settlementCandidates: SettlementCandidate[] = [];

  // ── 공유 후보 목록 — 상대 타입별 누수 분기로 최소 필드만 (D2/D4) ──
  // 마진·반대편 통화는 어떤 후보 쿼리에도 미조회. 모달은 이름·식별자 위주.
  if (counterpartyType === ZaloCounterpartyType.SUPPLIER && conv.userId) {
    // 공급자 대화 — 그 공급자 소유 빌라만, 원가만. 제안 후보 없음(고객 전용).
    const villas = await prisma.villa.findMany({
      where: { supplierId: conv.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        complex: true,
        bedrooms: true,
        bathrooms: true,
        photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        // 대표 원가 = 시즌 우선-else-base 원가 >0 최저값(계약 A) — base=원가동일/0 오염 회피. 원가 전용 select(salePrice*/margin 미조회).
        ratePeriods: {
          select: { isBase: true, supplierCostVnd: true },
        },
      },
    });
    villaCandidates = serializeBigInt(
      villas.map((v) => {
        const low = pickLowestSupplierCost(v.ratePeriods);
        return {
          id: v.id,
          name: v.name,
          complex: v.complex,
          bedrooms: v.bedrooms,
          bathrooms: v.bathrooms,
          photoUrl: v.photos[0]?.url ?? null,
          priceLabelKind: "supplierCostVnd" as const,
          priceVnd: low,
          priceKrw: null,
          priceIsFrom: low !== null, // 최저값 기준 → "부터" 표기
        };
      })
    ) as VillaCandidate[];

    // 본인(supplierId=userId) 정산만 — totalVnd·건수·상태. 판매가·마진 없음.
    const settlements = await prisma.settlement.findMany({
      where: { supplierId: conv.userId },
      orderBy: { yearMonth: "desc" },
      select: {
        id: true,
        yearMonth: true,
        totalVnd: true,
        status: true,
        _count: { select: { items: true } },
      },
    });
    settlementCandidates = serializeBigInt(
      settlements.map((s) => ({
        id: s.id,
        yearMonth: s.yearMonth,
        label: settlementLabel(s.yearMonth, (year, month) =>
          tm("inbox.settlementMonth", { year, month })
        ),
        totalVnd: s.totalVnd,
        itemCount: s._count.items,
        status: s.status,
      }))
    ) as SettlementCandidate[];
  } else if (isSellSideType(counterpartyType)) {
    // 판매가측 그룹(CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY) — ACTIVE+isSellable 빌라만, 판매가만.
    // ★빌라 공유 대표가는 분류 무관 항상 VND(2026-07-24) — CUSTOMER도 KRW→VND로 통일.
    //   (제안 후보 통화는 아래에서 proposal.saleCurrency로 별도 유지 — 빌라만 VND 고정.)
    // 원가(supplierCostVnd)·마진(marginType/marginValue)은 화이트리스트에서 영구 제외 — 누수 불변식.
    const villas = await prisma.villa.findMany({
      where: { status: "ACTIVE", isSellable: true },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        complex: true,
        bedrooms: true,
        bathrooms: true,
        photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        // 대표 판매가 = 전체 요율 중 유효가 >0 최저값(계약 A/D1) — base=0 초기화 오염 회피.
        // 판매가 계열 전용 select(누수 불변식) — 원가·마진 미조회. consumerSalePrice*는 소비자 계층용(ADR-0031).
        ratePeriods: {
          select: {
            season: true,
            isBase: true,
            salePriceKrw: true,
            salePriceVnd: true,
            consumerSalePriceVnd: true,
            consumerSalePriceKrw: true,
          },
        },
      },
    });
    // ★계층(ADR-0031) — CUSTOMER=소비자가(CONSUMER), 여행사·랜드사=도매가(NET). 통화는 항상 VND.
    const tier = tierForCounterparty(counterpartyType);
    villaCandidates = serializeBigInt(
      villas.map((v) => {
        // ★항상 VND(useKrw=false) — 빌라 공유가는 분류 무관 VND로 통일. 계층만 상대 타입으로 갈린다.
        const low = pickLowestSalePrice(v.ratePeriods, false, tier);
        return {
          id: v.id,
          name: v.name,
          complex: v.complex,
          bedrooms: v.bedrooms,
          bathrooms: v.bathrooms,
          photoUrl: v.photos[0]?.url ?? null,
          priceLabelKind: "salePriceVnd" as const,
          priceVnd: low?.vnd ?? null,
          priceKrw: null,
          priceIsFrom: low !== null, // 최저 시즌가(없으면 base) 기준 → "부터" 표기
        };
      })
    ) as VillaCandidate[];

    // 제안 후보 — ACTIVE + 미만료만. 판매가 총액(채널 통화)만. 원가·마진 없음.
    // 대화 귀속 필터(계약 I): 기본은 미귀속(conversationId=null) + 이 대화 귀속만 노출(오발송 차단).
    //   ?allProposals=1이면 필터 해제(전체 보기 토글, 계약 J).
    const allProposals = new URL(_req.url).searchParams.get("allProposals") === "1";
    const proposals = await prisma.proposal.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { gt: now },
        ...(allProposals ? {} : { OR: [{ conversationId: null }, { conversationId: id }] }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        clientName: true,
        saleCurrency: true,
        expiresAt: true,
        conversationId: true,
        items: {
          select: {
            totalKrw: true,
            totalVnd: true,
            villa: { select: { name: true, nameVi: true } },
          },
        },
      },
    });
    proposalCandidates = serializeBigInt(
      proposals.map((p) => {
        const useKrw = p.saleCurrency === Currency.KRW;
        const totalKrw = p.items.reduce((sum, it) => sum + (it.totalKrw ?? 0), 0);
        const totalVnd = p.items.reduce(
          (sum, it) => sum + (it.totalVnd ?? BigInt(0)),
          BigInt(0)
        );
        const expiresInHours = Math.max(
          0,
          Math.round((p.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000))
        );
        return {
          id: p.id,
          clientName: p.clientName,
          villaNames: p.items.map((it) =>
            formatVillaName({ name: it.villa.name, nameVi: it.villa.nameVi })
          ),
          currency: p.saleCurrency,
          totalKrw: useKrw ? totalKrw : null,
          totalVnd: useKrw ? null : totalVnd,
          expiresInHours,
          boundHere: p.conversationId === id, // 이 대화에 귀속된 제안(UI 구분용)
        };
      })
    ) as ProposalCandidate[];
  }
  // UNKNOWN/IGNORED 등 미분류 대화는 모두 빈 배열(공유 잠금 유지).

  return NextResponse.json({
    villaCandidates,
    proposalCandidates,
    settlementCandidates,
  });
}
