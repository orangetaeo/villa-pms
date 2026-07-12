// GET /api/villas/bookable — 예약 생성 폼용 판매가능 빌라 검색 (T-admin-manual-booking 후속 확장).
//
// /villas 운영자 목록과 **동일한 검색 필터**(lib/villa-search 재사용)로 후보를 좁히되,
// 이 라우트는 예약 생성 대상이라 항상 검수 게이트를 강제한다: status=ACTIVE && isSellable=true.
// ci/co(체크인·아웃) 둘 다 유효하면 findFreeVillaIds 로 그 구간 공실만 교차한다.
//
// ⚠ 재고/마진 비공개: ADMIN 계열(isOperator)만 접근. 응답은 **표시 필드만** —
//   원가(supplierCostVnd)·판매가(KRW/VND)·마진·공급자 연락처는 어떤 형태로도 반환하지 않는다.
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-guard";
import { isOperator } from "@/lib/permissions";
import { findFreeVillaIds } from "@/lib/availability";
import { parseVillaSearchFilters, buildVillaSearchWhere } from "@/lib/villa-search";

/** 응답 상한 — 예약 폼 셀렉터라 100건이면 충분. 초과 시 truncated 플래그로 필터 유도. */
const MAX_RESULTS = 100;

export async function GET(req: Request) {
  // 첫 줄 role 검사 — 예약 생성 폼용이라 ADMIN 계열(운영자)만
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const searchParams = new URL(req.url).searchParams;
  // /villas 와 동일 파라미터 이름·파싱 규칙 재사용. 잘못된 값은 조용히 무시(400 남발 금지).
  const filters = parseVillaSearchFilters(Object.fromEntries(searchParams));
  const searchWhere = buildVillaSearchWhere(filters);

  // 검수 게이트 강제 — sellable 파라미터와 무관하게 항상 ACTIVE + 판매가능만.
  const baseWhere: Prisma.VillaWhereInput = {
    ...searchWhere,
    status: "ACTIVE",
    isSellable: true,
  };

  // ci/co 둘 다 유효 → 그 구간 공실만 교차. requireSellable=true 로 ACTIVE+isSellable 재확인.
  // guestCount 는 findFreeVillaIds 에 넘기지 않는다 — minGuests 는 이미 searchWhere 의 maxGuests>=N
  //   (baseWhere→villaWhere) 로 후보 선정에 반영되어 이중 적용이 불필요(동일 gte 의미).
  let freeIds: string[] | null = null;
  if (filters.dateRangeValid) {
    freeIds = await findFreeVillaIds(
      prisma,
      { checkIn: filters.checkIn!, checkOut: filters.checkOut! },
      { requireSellable: true, villaWhere: baseWhere }
    );
  }

  const where: Prisma.VillaWhereInput =
    freeIds !== null ? { ...baseWhere, id: { in: freeIds } } : baseWhere;

  // MAX_RESULTS+1 로 초과 여부만 감지(truncated). 표시 필드만 select — 금액·연락처 없음.
  const rows = await prisma.villa.findMany({
    where,
    orderBy: [{ complex: "asc" }, { name: "asc" }],
    take: MAX_RESULTS + 1,
    select: {
      id: true,
      name: true,
      nameVi: true,
      complex: true,
      maxGuests: true,
      bedrooms: true,
      bathrooms: true,
      hasPool: true,
      breakfastAvailable: true,
      beachDistanceM: true,
    },
  });

  const truncated = rows.length > MAX_RESULTS;
  const villas = truncated ? rows.slice(0, MAX_RESULTS) : rows;

  return NextResponse.json({ villas, ...(truncated ? { truncated: true } : {}) });
}
