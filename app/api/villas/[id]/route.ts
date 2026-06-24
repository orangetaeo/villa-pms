// PATCH /api/villas/[id] — ADMIN 빌라 상태 변경 (T1.2, SPEC F1 승인 게이트)
// 전이 규칙: APPROVE PENDING_REVIEW→ACTIVE / REJECT PENDING_REVIEW→REJECTED(T1.2b)
//          / DEACTIVATE ACTIVE→INACTIVE / REACTIVATE INACTIVE→ACTIVE
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { createInitialInspectionTask } from "@/lib/cleaning";
import { villaCreateSchema } from "@/lib/villa-schema";
import { NotificationType, type VillaStatus } from "@prisma/client";
import { isOperator } from "@/lib/permissions";
import { buildRatePeriodRowsFromSeasonCosts } from "@/lib/pricing";

const patchSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "DEACTIVATE", "REACTIVATE"]),
  // REJECT 전용 — trim 후 1~1000 (다른 액션에서는 무시)
  reason: z.string().trim().min(1).max(1000).optional(),
});

// 허용 전이표 — 그 외 전이는 409
const TRANSITIONS: Record<
  z.infer<typeof patchSchema>["action"],
  { from: VillaStatus; to: VillaStatus }
> = {
  APPROVE: { from: "PENDING_REVIEW", to: "ACTIVE" },
  REJECT: { from: "PENDING_REVIEW", to: "REJECTED" },
  DEACTIVATE: { from: "ACTIVE", to: "INACTIVE" },
  REACTIVATE: { from: "INACTIVE", to: "ACTIVE" },
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { action } = parsed.data;

  // REJECT는 사유 필수 (trim 후 비어 있으면 위 zod min(1)에서 걸리나, 미전달 방어)
  if (action === "REJECT" && !parsed.data.reason) {
    return NextResponse.json({ error: "REASON_REQUIRED" }, { status: 400 });
  }
  const transition = TRANSITIONS[action];
  const rejectionReason = action === "REJECT" ? parsed.data.reason! : null;

  // 트랜잭션 안에서 현재 상태 확인 + 전이 — 동시 요청 간 전이 규칙 위반 방지
  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true, status: true, supplierId: true, name: true },
    });
    if (!villa) return { kind: "NOT_FOUND" as const };

    // 가드 updateMany — from 상태일 때만 전이(동시 REJECT/APPROVE 경합에서 한쪽만, QA 조건 2)
    const guarded = await tx.villa.updateMany({
      where: { id, status: transition.from },
      data: {
        status: transition.to,
        // REJECT만 사유 저장 / 그 외 전이는 사유 클리어(REACTIVATE 등에서 잔존 방지)
        ...(action === "REJECT" ? { rejectionReason } : { rejectionReason: null }),
      },
    });
    if (guarded.count !== 1) {
      return { kind: "CONFLICT" as const, current: villa.status };
    }

    // T3.4b (ADR-0006): 최초 승인 시 초기 검수 태스크 — 검수 이력 있으면 null (멱등).
    // 게이트 개방은 여전히 검수 승인 경로 단일 — 여기서 isSellable을 만지지 않는다
    const initialTask =
      action === "APPROVE"
        ? await createInitialInspectionTask(tx, {
            villaId: id,
            actorUserId: session.user.id,
            now: new Date(),
          })
        : null;

    // REJECT — 공급자에게 반려 사유 알림 큐 적재 (실발송은 T3.5 Zalo cron)
    if (action === "REJECT") {
      await tx.notification.create({
        data: {
          userId: villa.supplierId,
          type: NotificationType.VILLA_REJECTED,
          payload: { villaId: villa.id, villaName: villa.name, reason: rejectionReason },
        },
      });
    }

    return {
      kind: "OK" as const,
      oldStatus: villa.status,
      newStatus: transition.to,
      villaId: villa.id,
      initialInspectionCreated: initialTask !== null,
    };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "CONFLICT") {
    return NextResponse.json(
      { error: "INVALID_TRANSITION", current: result.current, action },
      { status: 409 }
    );
  }

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "Villa",
    entityId: result.villaId,
    changes: {
      status: { old: result.oldStatus, new: result.newStatus },
      ...(action === "REJECT" ? { rejectionReason: { old: null, new: rejectionReason } } : {}),
    },
  });

  return NextResponse.json({
    id: result.villaId,
    status: result.newStatus,
    initialInspectionCreated: result.initialInspectionCreated,
  });
}

// PUT /api/villas/[id] — SUPPLIER 반려 빌라 수정·재제출 (T1.2b, REJECTED→PENDING_REVIEW)
// 자기 빌라(supplierId 스코프) + REJECTED 상태만. 마법사 전체 입력 재수신(villaCreateSchema 재사용).
export async function PUT(
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
  const parsed = villaCreateSchema.safeParse(body);
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
      select: { id: true, supplierId: true, status: true },
    });
    // 타인 빌라·미존재는 동일하게 404 (존재 자체를 누설하지 않음)
    if (!villa || villa.supplierId !== supplierId) return { kind: "NOT_FOUND" as const };

    // 가드 — REJECTED 상태일 때만 재제출. ACTIVE·PENDING_REVIEW 빌라의 rate 덮어쓰기 차단(QA 조건 3)
    const guarded = await tx.villa.updateMany({
      where: { id, supplierId, status: "REJECTED" },
      data: {
        name: data.name,
        complex: data.complex || null,
        address: data.address || null,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        maxGuests: data.maxGuests,
        hasPool: data.hasPool,
        breakfastAvailable: data.breakfastAvailable,
        monthlyRentVnd: data.monthlyRentVnd ? BigInt(data.monthlyRentVnd) : null,
        status: "PENDING_REVIEW",
        rejectionReason: null, // 재제출 — 사유 클리어 (이력은 AuditLog)
      },
    });
    if (guarded.count !== 1) return { kind: "CONFLICT" as const, current: villa.status };

    // 사진·비품·요율 전체 교체 (마법사 재입력 — REJECTED는 ADMIN 미승인 상태라 마진 리셋 안전)
    await tx.villaPhoto.deleteMany({ where: { villaId: id } });
    if (data.photos.length > 0) {
      await tx.villaPhoto.createMany({
        data: data.photos.map((photo) => ({
          villaId: id,
          space: photo.space,
          spaceLabel: photo.spaceLabel ?? null,
          url: photo.url,
          sortOrder: photo.sortOrder,
          uploadedBy: supplierId,
        })),
      });
    }

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

    // 요율(ADR-0014 VillaRatePeriod) 전체 교체 — REJECTED는 ADMIN 미승인 상태라 마진 리셋 안전.
    //   base(LOW 배경) 1행 + 전역 비-LOW 시즌 스냅샷 N행. 마진·판매가는 placeholder.
    await tx.villaRatePeriod.deleteMany({ where: { villaId: id } });
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
    await tx.villaRatePeriod.create({ data: { ...base, villaId: id } });
    if (periods.length > 0) {
      await tx.villaRatePeriod.createMany({
        data: periods.map((p) => ({ ...p, villaId: id })),
      });
    }

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "CONFLICT") {
    return NextResponse.json(
      { error: "INVALID_STATUS", current: result.current },
      { status: 409 }
    );
  }

  await writeAuditLog({
    userId: supplierId,
    action: "UPDATE",
    entity: "Villa",
    entityId: id,
    changes: {
      status: { old: "REJECTED", new: "PENDING_REVIEW" },
      rejectionReason: { old: "(반려됨)", new: null },
      photos: { new: data.photos.length },
      amenities: { new: data.amenities.length },
      supplierCostVnd: {
        new: `LOW=${data.rates.LOW},HIGH=${data.rates.HIGH},PEAK=${data.rates.PEAK}`,
      },
    },
  });

  // 응답에는 id·status만 — 마진/판매가/KRW 미포함 (POST와 동일)
  return NextResponse.json({ id, status: "PENDING_REVIEW" });
}
