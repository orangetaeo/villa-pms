// POST /api/villas — SUPPLIER 빌라 등록 (T1.1, SPEC F1)
// GET  /api/villas — 빌라 목록: ADMIN 전체(요율 포함) / SUPPLIER 자기 빌라만(원가만) (T1.2)
// 사업 원칙: 마진·판매가(KRW)는 어떤 형태로도 공급자에게 반환하지 않는다
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { villaCreateSchema, SEASONS } from "@/lib/villa-schema";
import { serializeBigInt } from "@/lib/serialize";
import type { Prisma, VillaStatus } from "@prisma/client";

export async function POST(req: Request) {
  // 권한 검사 — SUPPLIER 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // supplierId는 세션에서 강제 — 바디의 supplierId는 무시한다
  const supplierId = session.user.id;

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
          uploadedBy: supplierId, // 증빙: 업로더 기록
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

    // 마진·판매가는 운영자가 T1.2 승인 화면에서 설정 — 생성 시 초기값
    await tx.villaRate.createMany({
      data: SEASONS.map((season) => {
        const cost = BigInt(data.rates[season]);
        return {
          villaId: created.id,
          season,
          supplierCostVnd: cost,
          marginType: "PERCENT" as const,
          marginValue: BigInt(0),
          salePriceVnd: cost,
          salePriceKrw: 0,
        };
      }),
    });

    return created;
  });

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: supplierId,
    action: "CREATE",
    entity: "Villa",
    entityId: villa.id,
    changes: {
      status: { new: "PENDING_REVIEW" },
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

const VILLA_STATUSES: VillaStatus[] = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "INACTIVE"];

export async function GET(req: Request) {
  // 권한 검사 — ADMIN·SUPPLIER만 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { role, id: userId } = session.user;
  if (role !== "ADMIN" && role !== "SUPPLIER") {
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

  if (role === "ADMIN") {
    const villas = await prisma.villa.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        rates: {
          orderBy: { season: "asc" },
          select: {
            id: true,
            season: true,
            supplierCostVnd: true,
            marginType: true,
            marginValue: true,
            salePriceVnd: true,
            salePriceKrw: true,
          },
        },
        photos: { orderBy: { sortOrder: "asc" }, take: 1 },
        _count: { select: { photos: true, bookings: true, amenities: true } },
      },
    });
    return NextResponse.json(serializeBigInt(villas));
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
      rates: {
        orderBy: { season: "asc" },
        select: { season: true, supplierCostVnd: true }, // 자기 원가만
      },
      photos: { orderBy: { sortOrder: "asc" }, take: 1 },
      _count: { select: { photos: true, amenities: true } },
    },
  });
  return NextResponse.json(serializeBigInt(villas));
}
