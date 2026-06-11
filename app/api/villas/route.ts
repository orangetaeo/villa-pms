// POST /api/villas — SUPPLIER 빌라 등록 (T1.1, SPEC F1)
// 사업 원칙: 마진·판매가(KRW)는 어떤 형태로도 공급자에게 반환하지 않는다
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { villaCreateSchema, SEASONS } from "@/lib/villa-schema";

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
