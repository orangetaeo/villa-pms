// PATCH /api/villas/[id]/amenities — SUPPLIER 비품 전체 교체 (T6.4)
// 자기 빌라(supplierId 스코프)만. 비품은 승인 게이트 무관(Phase 1 표기·조회용) → villa.status 불변.
// 누수 0: VillaRate(판매가·마진)를 일절 조회·수정하지 않는다. itemKey는 lib/amenities 사전 값만.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isValidAmenity } from "@/lib/amenities";

// villaCreateSchema의 비품 배열과 동일 규약 (라우트 인라인 — lib/villa-schema 미수정)
const amenitiesPatchSchema = z.object({
  amenities: z
    .array(
      z.object({
        category: z.enum(["KITCHEN", "BATHROOM", "APPLIANCE", "MINIBAR"]),
        itemKey: z.string().min(1).max(50),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .max(80)
    .superRefine((items, ctx) => {
      items.forEach((item, index) => {
        if (!isValidAmenity(item.category, item.itemKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "itemKey"],
            message: `Unknown amenity item: ${item.category}/${item.itemKey}`,
          });
        }
      });
    }),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = amenitiesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true, supplierId: true, _count: { select: { amenities: true } } },
    });
    // 타인 빌라·미존재는 동일하게 404 (존재 자체를 누설하지 않음)
    if (!villa || villa.supplierId !== supplierId) return { kind: "NOT_FOUND" as const };

    const oldCount = villa._count.amenities;
    await tx.villaAmenity.deleteMany({ where: { villaId: id } });
    if (data.amenities.length > 0) {
      await tx.villaAmenity.createMany({
        data: data.amenities.map((amenity) => ({
          villaId: id,
          category: amenity.category,
          itemKey: amenity.itemKey,
          quantity: amenity.quantity,
        })),
      });
    }

    // 글로벌 규칙 — 변경 추적. 비품 개수 전후만 기록(상태·판매가 무변경)
    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "UPDATE",
      entity: "Villa",
      entityId: id,
      changes: { amenities: { old: oldCount, new: data.amenities.length } },
    });

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 응답에는 id·개수만 (판매가/마진 미포함)
  return NextResponse.json({ id, amenityCount: data.amenities.length });
}
