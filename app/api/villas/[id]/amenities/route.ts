// PATCH /api/villas/[id]/amenities — 비품 전체 교체 (T6.4 / Batch A 관리자 CRUD 확장)
// SUPPLIER는 자기 빌라(supplierId 스코프)만. 운영자(isOperator)는 모든 빌라 편집 가능(테오팀 직접수집).
// 비품은 승인 게이트 무관(Phase 1 표기·조회용) → villa.status 불변.
// 누수 0: VillaRate(판매가·마진)를 일절 조회·수정하지 않는다. itemKey는 lib/amenities 사전 값만.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isValidAmenity } from "@/lib/amenities";
import { isOperator } from "@/lib/permissions";

// VND 동 단위 양수 문자열 (미니바 고객 청구 단가 — BigInt는 JSON 직렬화 불가하므로 문자열 수신)
const vndPositiveDigits = z.string().regex(/^[1-9]\d{0,14}$/);

// villaCreateSchema의 비품 배열 + 확장 필드 (unitPrice·customLabel·note)
// 라우트 인라인 (lib/villa-schema 미수정 — 타 세션 충돌 회피)
const amenitiesPatchSchema = z.object({
  amenities: z
    .array(
      z.object({
        category: z.enum(["KITCHEN", "BATHROOM", "APPLIANCE", "MINIBAR"]),
        itemKey: z.string().min(1).max(50),
        quantity: z.number().int().min(1).max(99),
        // 미니바 고객 청구 단가 (VND, 양수 문자열). MINIBAR 외에는 무시 (저장 시 null)
        unitPrice: vndPositiveDigits.optional(),
        // itemKey="custom"일 때 공급자 입력 라벨 (vi). custom이면 필수
        customLabel: z.string().trim().min(1).max(60).optional(),
        // 자유 메모 (수건 "매일 제공" 등)
        note: z.string().trim().max(200).optional(),
      })
    )
    .max(80)
    .superRefine((items, ctx) => {
      items.forEach((item, index) => {
        // 사전 검증 — 임의 itemKey 주입 차단 (custom은 MINIBAR만 통과, lib/amenities)
        if (!isValidAmenity(item.category, item.itemKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "itemKey"],
            message: `Unknown amenity item: ${item.category}/${item.itemKey}`,
          });
        }
        // custom이면 customLabel 필수 (텍스트 식별 불가 항목 차단)
        if (item.itemKey === "custom" && !item.customLabel) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "customLabel"],
            message: "customLabel is required when itemKey is 'custom'",
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
  // SUPPLIER(자기 빌라만) 또는 운영자(모든 빌라) — 그 외 차단
  const isSupplier = session.user.role === "SUPPLIER";
  if (!isSupplier && !isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;
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

  // #2a 미니바 직접운영 — 공급자는 미니바 미관여(unitPrice=고객 청구가=우리 판매가, 공급자 비노출 원칙).
  //   공급자 요청에선 MINIBAR 항목을 silent drop한다(403 금지 — 마법사·에디터가 전 카테고리를 한
  //   배열로 보내므로 거부 시 타월 등 비-MINIBAR 저장까지 실패). 운영자(ADMIN)는 그대로 미니바 운영.
  const incomingAmenities = isSupplier
    ? data.amenities.filter((a) => a.category !== "MINIBAR")
    : data.amenities;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true, supplierId: true, _count: { select: { amenities: true } } },
    });
    // 미존재 404. SUPPLIER는 타인 빌라도 404(존재 자체 미누설). 운영자는 모든 빌라 허용.
    if (!villa) return { kind: "NOT_FOUND" as const };
    if (isSupplier && villa.supplierId !== actorId) return { kind: "NOT_FOUND" as const };

    const oldCount = villa._count.amenities;
    // 공급자: 비-MINIBAR만 교체하고 기존 MINIBAR(회사 운영분)는 보존 — deleteMany를 비-MINIBAR로 스코프.
    //   (전체 deleteMany면 공급자의 amenity 저장이 회사가 운영하는 미니바 데이터를 통째로 wipe함)
    // 운영자: 전체 교체(미니바 포함 운영).
    await tx.villaAmenity.deleteMany({
      where: isSupplier ? { villaId: id, category: { not: "MINIBAR" } } : { villaId: id },
    });
    if (incomingAmenities.length > 0) {
      await tx.villaAmenity.createMany({
        data: incomingAmenities.map((amenity) => ({
          villaId: id,
          category: amenity.category,
          itemKey: amenity.itemKey,
          quantity: amenity.quantity,
          // 고객 청구 단가는 MINIBAR만 — 그 외 카테고리의 unitPrice는 무시 (null)
          unitPrice:
            amenity.category === "MINIBAR" && amenity.unitPrice
              ? BigInt(amenity.unitPrice)
              : null,
          // custom일 때만 라벨 저장 (사전 항목은 i18n 키로 표기)
          customLabel: amenity.itemKey === "custom" ? amenity.customLabel ?? null : null,
          note: amenity.note ?? null,
        })),
      });
    }

    // 글로벌 규칙 — 변경 추적. 비품 개수 + 미니바 단가 스냅샷.
    // ⚠ unitPrice는 미니바 고객 청구 단가(= 우리 회사 판매가)이며 공급자 원가가 아니다.
    //   공급자 입력은 위에서 drop되므로 이 스냅샷은 운영자(ADMIN) 입력분만. BigInt는 Json에 못 넣어 문자열화.
    const minibarPricing = incomingAmenities
      .filter((a) => a.category === "MINIBAR" && a.unitPrice)
      .map((a) => `${a.itemKey === "custom" ? a.customLabel : a.itemKey}=${a.unitPrice}`)
      .join(",");
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "Villa",
      entityId: id,
      changes: {
        amenities: { old: oldCount, new: incomingAmenities.length },
        ...(minibarPricing ? { minibarUnitPriceVnd: { new: minibarPricing } } : {}),
      },
    });

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 응답에는 id·개수만 (판매가/마진 미포함). 공급자는 미니바 drop 후 비-MINIBAR 개수.
  return NextResponse.json({ id, amenityCount: incomingAmenities.length });
}
