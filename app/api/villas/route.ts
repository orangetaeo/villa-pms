// POST /api/villas — SUPPLIER 빌라 등록 (T1.1, SPEC F1)
// GET  /api/villas — 빌라 목록: ADMIN 전체(요율 포함) / SUPPLIER 자기 빌라만(원가만) (T1.2)
// 사업 원칙: 마진·판매가(KRW)는 어떤 형태로도 공급자에게 반환하지 않는다
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { villaCreateSchema } from "@/lib/villa-schema";
import { serializeBigInt } from "@/lib/serialize";
import type { Prisma, VillaStatus } from "@prisma/client";
import { isOperator, canViewFinance } from "@/lib/permissions";
import { buildRatePeriodRowsFromSeasonCosts, representativeRatesBySeason } from "@/lib/pricing";

export async function POST(req: Request) {
  // 권한 검사 — SUPPLIER(자기 빌라) + ADMIN(테오 직접등록) 허용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (
    !session?.user?.id ||
    (session.user.role !== "SUPPLIER" && !isOperator(session.user.role))
  ) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id; // 실제 등록 수행자(업로더·감사로그 주체)
  const role = session.user.role;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = villaCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 귀속 공급자 결정 — SUPPLIER는 세션 강제(바디 supplierId 무시), ADMIN은 바디 supplierId(존재·역할 검증)
  let supplierId: string;
  if (role === "SUPPLIER") {
    supplierId = actorId;
  } else {
    if (!data.supplierId) {
      return NextResponse.json({ error: "SUPPLIER_REQUIRED" }, { status: 400 });
    }
    const supplier = await prisma.user.findUnique({
      where: { id: data.supplierId },
      select: { id: true, role: true },
    });
    if (!supplier || supplier.role !== "SUPPLIER") {
      return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
    }
    supplierId = supplier.id;
  }

  const villa = await prisma.$transaction(async (tx) => {
    const created = await tx.villa.create({
      data: {
        supplierId,
        name: data.name,
        complex: data.complex || null,
        address: data.address || null,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        maxGuests: data.maxGuests,
        hasPool: data.hasPool,
        breakfastAvailable: data.breakfastAvailable,
        monthlyRentVnd: data.monthlyRentVnd ? BigInt(data.monthlyRentVnd) : null,
        status: "PENDING_REVIEW", // 검수 게이트 — 운영자 승인(T1.2) 전 판매 불가
      },
    });

    if (data.photos.length > 0) {
      await tx.villaPhoto.createMany({
        data: data.photos.map((photo) => ({
          villaId: created.id,
          space: photo.space,
          spaceLabel: photo.spaceLabel ?? null,
          url: photo.url,
          sortOrder: photo.sortOrder,
          uploadedBy: actorId, // 증빙: 실제 업로더 기록(ADMIN 직접등록 시 ADMIN)
        })),
      });
    }

    if (data.amenities.length > 0) {
      await tx.villaAmenity.createMany({
        data: data.amenities.map((amenity) => ({
          villaId: created.id,
          category: amenity.category,
          itemKey: amenity.itemKey,
          quantity: amenity.quantity,
        })),
      });
    }

    // 요율(ADR-0014 VillaRatePeriod) — 기본요금(base, LOW 배경) 1행 + 전역 비-LOW 시즌 스냅샷 N행.
    // 마진·판매가는 운영자가 T1.2 승인 화면에서 설정 — 생성 시 placeholder(margin 0·sale=cost·krw 0).
    const globalSeasons = await tx.seasonPeriod.findMany({
      select: { season: true, startDate: true, endDate: true, label: true },
    });
    const { base, periods } = buildRatePeriodRowsFromSeasonCosts(
      {
        LOW: BigInt(data.rates.LOW),
        HIGH: BigInt(data.rates.HIGH),
        PEAK: BigInt(data.rates.PEAK),
      },
      globalSeasons
    );
    await tx.villaRatePeriod.create({ data: { ...base, villaId: created.id } });
    if (periods.length > 0) {
      await tx.villaRatePeriod.createMany({
        data: periods.map((p) => ({ ...p, villaId: created.id })),
      });
    }

    return created;
  });

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: actorId,
    action: "CREATE",
    entity: "Villa",
    entityId: villa.id,
    changes: {
      status: { new: "PENDING_REVIEW" },
      // ADMIN 직접등록 시 actor(ADMIN)와 귀속 공급자가 다름 — 귀속 대상 기록
      supplierId: { new: supplierId },
      name: { new: data.name },
      bedrooms: { new: data.bedrooms },
      bathrooms: { new: data.bathrooms },
      photos: { new: data.photos.length },
      amenities: { new: data.amenities.length },
      supplierCostVnd: {
        new: `LOW=${data.rates.LOW},HIGH=${data.rates.HIGH},PEAK=${data.rates.PEAK}`,
      },
    },
  });

  // 응답에는 id·status만 — 마진/판매가/KRW 미포함
  return NextResponse.json({ id: villa.id, status: villa.status }, { status: 201 });
}

const VILLA_STATUSES: VillaStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "REJECTED", // T1.2b
  "ACTIVE",
  "INACTIVE",
];

export async function GET(req: Request) {
  // 권한 검사 — ADMIN·SUPPLIER만 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { role, id: userId } = session.user;
  if (!isOperator(role) && role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // status 쿼리 파라미터 필터 (선택)
  const statusParam = new URL(req.url).searchParams.get("status");
  if (statusParam && !VILLA_STATUSES.includes(statusParam as VillaStatus)) {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
  }

  const where: Prisma.VillaWhereInput = {
    ...(statusParam ? { status: statusParam as VillaStatus } : {}),
    // SUPPLIER는 자기 빌라만 — supplierId 스코프 강제
    ...(role === "SUPPLIER" ? { supplierId: userId } : {}),
  };

  if (isOperator(role)) {
    // S-RBAC-3: 판매가·마진은 canViewFinance(OWNER/MANAGER/ADMIN)만. STAFF는 원가만(SUPPLIER 동일 가시성).
    const showFinance = canViewFinance(role);
    // ADR-0014: 요율은 VillaRatePeriod. 응답은 기존 소비처 호환을 위해 시즌별 대표행 rates:[{season,...}] 배열로 재구성.
    //   showFinance면 판매가·마진 포함, STAFF는 supplierCostVnd만 select(누수 불변식 유지).
    const villas = await prisma.villa.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        ratePeriods: {
          select: {
            season: true,
            isBase: true,
            supplierCostVnd: true,
            // STAFF면 marginType·marginValue·salePriceVnd·salePriceKrw select 자체에서 제외
            ...(showFinance
              ? {
                  marginType: true,
                  marginValue: true,
                  salePriceVnd: true,
                  salePriceKrw: true,
                }
              : {}),
          },
        },
        photos: { orderBy: { sortOrder: "asc" }, take: 1 },
        _count: { select: { photos: true, bookings: true, amenities: true } },
      },
    });
    // ratePeriods → 시즌별 대표행 rates 배열(LOW=base, HIGH/PEAK=그 시즌 첫 기간 없으면 base)로 변환.
    const shaped = villas.map(({ ratePeriods, ...v }) => {
      const rep = representativeRatesBySeason(ratePeriods);
      const rates = (["LOW", "HIGH", "PEAK"] as const)
        .map((season) => {
          const r = rep[season];
          return r ? { ...r, season } : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return { ...v, rates };
    });
    return NextResponse.json(serializeBigInt(shaped));
  }

  // SUPPLIER — 마진·판매가(marginType·marginValue·salePriceVnd·salePriceKrw) 절대 미포함
  const villas = await prisma.villa.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      complex: true,
      address: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      hasPool: true,
      breakfastAvailable: true,
      status: true,
      isSellable: true,
      createdAt: true,
      ratePeriods: {
        // 자기 원가만 — sale/margin 필드는 select에 부재(누수 불변식 구조적 보장)
        select: { season: true, isBase: true, supplierCostVnd: true },
      },
      photos: { orderBy: { sortOrder: "asc" }, take: 1 },
      _count: { select: { photos: true, amenities: true } },
    },
  });
  // ratePeriods → 시즌별 대표 원가행 rates 배열(원가만)로 변환 — 기존 소비처 호환.
  const shaped = villas.map(({ ratePeriods, ...v }) => {
    const rep = representativeRatesBySeason(ratePeriods);
    const rates = (["LOW", "HIGH", "PEAK"] as const)
      .map((season) => {
        const r = rep[season];
        return r ? { season, supplierCostVnd: r.supplierCostVnd } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return { ...v, rates };
  });
  return NextResponse.json(serializeBigInt(shaped));
}
