// POST/DELETE/PATCH /api/villas/[id]/photos — 빌라 사진 추가·삭제·정렬 (Phase 1 빌라 관리자 업그레이드)
// 권한: route handler 첫 줄 role 검사. SUPPLIER는 자기 빌라(supplierId)만, ADMIN 전체.
// 업로드 파이프라인: 클라가 lib/image-resize → POST /api/uploads 로 URL 확보 후 이 라우트에 url 전달
//   (raw 멀티파트 미중복 — villaCreateSchema와 동일 규약).
// 누수 0: VillaRate(판매가·마진)를 일절 조회·수정하지 않는다. 사진 응답에 금액 필드 없음.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { PHOTO_SPACES } from "@/lib/villa-schema";

// 진행 중 예약 — 기준사진(baseline) 증빙 무결성 보호 대상 상태
const ACTIVE_BOOKING_STATUSES = ["HOLD", "CONFIRMED", "CHECKED_IN"] as const;

// 인터림 디스크(/uploads/) 또는 R2(https) URL만 허용 (villaCreateSchema photos.url과 동일)
const photoUrl = z
  .string()
  .max(500)
  .regex(/^(\/uploads\/|https:\/\/)\S+$/);

const postSchema = z.object({
  space: z.enum(PHOTO_SPACES),
  spaceLabel: z.string().trim().max(50).optional(),
  url: photoUrl,
});

const patchSchema = z.object({
  // photoId → sortOrder 일괄 갱신
  orders: z
    .array(
      z.object({
        photoId: z.string().min(1).max(40),
        sortOrder: z.number().int().min(0).max(1000),
      })
    )
    .min(1)
    .max(120),
});

const deleteSchema = z.object({
  photoId: z.string().min(1).max(40),
});

/** villa 소유·존재 확인 — 타인 빌라·미존재는 동일하게 404 (존재 자체를 누설하지 않음) */
async function resolveVilla(
  villaId: string,
  role: string,
  userId: string
): Promise<{ id: string } | null> {
  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: { id: true, supplierId: true },
  });
  if (!villa) return null;
  // SUPPLIER는 자기 빌라만 — ADMIN은 전체 허용
  if (role === "SUPPLIER" && villa.supplierId !== userId) return null;
  return { id: villa.id };
}

// ===================== POST — 사진 추가 =====================
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { role, id: userId } = session.user;
  if (role !== "SUPPLIER" && role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true },
    });
    if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) {
      return { kind: "NOT_FOUND" as const };
    }

    // sortOrder = 해당 space 말미 (기존 최대값 + 1, 없으면 0)
    const last = await tx.villaPhoto.findFirst({
      where: { villaId, space: data.space },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = last ? last.sortOrder + 1 : 0;

    const photo = await tx.villaPhoto.create({
      data: {
        villaId,
        space: data.space,
        spaceLabel: data.spaceLabel ?? null,
        url: data.url,
        isBaseline: true, // 기준 사진 (체크아웃 비교용)
        sortOrder,
        uploadedBy: userId, // 증빙: 업로더 기록 (createdAt은 @default(now()))
      },
      select: { id: true, space: true, spaceLabel: true, url: true, sortOrder: true, isBaseline: true },
    });

    // 글로벌 규칙 — 변경 추적. url·space 기록 (삭제 후 복구 추적 가능하게)
    await writeAuditLog({
      db: tx,
      userId,
      action: "CREATE",
      entity: "VillaPhoto",
      entityId: photo.id,
      changes: {
        villaId: { new: villaId },
        space: { new: data.space },
        url: { new: data.url },
      },
    });

    return { kind: "OK" as const, photo };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(result.photo, { status: 201 });
}

// ===================== DELETE — 사진 삭제 (기준사진 보호) =====================
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { role, id: userId } = session.user;
  if (role !== "SUPPLIER" && role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id: villaId } = await params;

  // photoId는 쿼리 또는 바디 둘 다 허용
  let photoId = new URL(req.url).searchParams.get("photoId") ?? undefined;
  if (!photoId) {
    try {
      const body = await req.json();
      photoId = deleteSchema.parse(body).photoId;
    } catch {
      return NextResponse.json({ error: "PHOTO_ID_REQUIRED" }, { status: 400 });
    }
  } else {
    const check = deleteSchema.safeParse({ photoId });
    if (!check.success) {
      return NextResponse.json({ error: "PHOTO_ID_REQUIRED" }, { status: 400 });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true },
    });
    if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) {
      return { kind: "NOT_FOUND" as const };
    }

    const photo = await tx.villaPhoto.findUnique({
      where: { id: photoId },
      select: { id: true, villaId: true, space: true, url: true, isBaseline: true },
    });
    // 사진이 없거나 다른 빌라 소속이면 404 (스코프 누설 차단)
    if (!photo || photo.villaId !== villaId) {
      return { kind: "NOT_FOUND" as const };
    }

    // 기준사진 보호 — 진행 중 예약(HOLD/CONFIRMED/CHECKED_IN)이 있으면 삭제 거부 (증빙 무결성)
    if (photo.isBaseline) {
      const activeBooking = await tx.booking.count({
        where: { villaId, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
      });
      if (activeBooking > 0) {
        return { kind: "BASELINE_LOCKED" as const };
      }
    }

    await tx.villaPhoto.delete({ where: { id: photo.id } });

    // 글로벌 규칙 — 삭제 추적. url·space 기록 (복구·분쟁 대비)
    await writeAuditLog({
      db: tx,
      userId,
      action: "DELETE",
      entity: "VillaPhoto",
      entityId: photo.id,
      changes: {
        villaId: { old: villaId },
        space: { old: photo.space },
        url: { old: photo.url },
        isBaseline: { old: photo.isBaseline },
      },
    });

    return { kind: "OK" as const, photoId: photo.id };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "BASELINE_LOCKED") {
    // 진행 중 예약이 점유한 기준사진 — 증빙 무결성 보호
    return NextResponse.json({ error: "BASELINE_PHOTO_LOCKED" }, { status: 409 });
  }
  return NextResponse.json({ deleted: result.photoId });
}

// ===================== PATCH — 정렬 일괄 갱신 =====================
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { role, id: userId } = session.user;
  if (role !== "SUPPLIER" && role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id: villaId } = await params;

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
  const { orders } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true },
    });
    if (!villa || (role === "SUPPLIER" && villa.supplierId !== userId)) {
      return { kind: "NOT_FOUND" as const };
    }

    // 대상 사진이 모두 이 빌라 소속인지 검증 (타 빌라 photoId 주입 차단)
    const ids = orders.map((o) => o.photoId);
    const owned = await tx.villaPhoto.findMany({
      where: { id: { in: ids }, villaId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      return { kind: "NOT_FOUND" as const };
    }

    // sortOrder 일괄 갱신 — villaId까지 where에 넣어 스코프 이중 강제
    await Promise.all(
      orders.map((o) =>
        tx.villaPhoto.updateMany({
          where: { id: o.photoId, villaId },
          data: { sortOrder: o.sortOrder },
        })
      )
    );

    // 글로벌 규칙 — 정렬 변경 추적 (개별 url 미기록, 순서만)
    await writeAuditLog({
      db: tx,
      userId,
      action: "UPDATE",
      entity: "VillaPhoto",
      entityId: villaId, // 정렬은 빌라 단위 묶음 변경
      changes: {
        reorder: { new: orders.map((o) => `${o.photoId}:${o.sortOrder}`).join(",") },
      },
    });

    return { kind: "OK" as const, count: orders.length };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ reordered: result.count });
}
