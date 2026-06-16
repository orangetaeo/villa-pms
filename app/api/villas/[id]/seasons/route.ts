// GET/POST/PATCH/DELETE /api/villas/[id]/seasons — SUPPLIER 빌라별 시즌 기간 CRUD (ADR-0008)
//
// VillaSeasonPeriod: 한 빌라가 1건이라도 보유하면 그 빌라는 전적으로 이 달력으로 판정(전역 무시).
// 날짜 규약: [startDate, endDate) half-open, @db.Date = UTC 자정 (lib/pricing resolveSeason과 동일).
// 겹침 정책(ADR-0008): 같은 빌라 내 시즌 구간 겹침은 거부(409) — 빌라 자기 달력은 명확해야 분쟁 증빙·디버깅 용이.
//   (전역 SeasonPeriod는 PEAK>HIGH>LOW 우선으로 겹침 허용이지만, 공급자 입력 단계에서는 겹침을 막아 단순화.)
// 스코프: 자기 빌라(supplierId)만. 타인·미존재는 404 동일. 누수 0: VillaRate(판매가·마진) 일절 미접근.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import { SEASONS } from "@/lib/villa-schema";
import type { Prisma } from "@prisma/client";

const createSchema = z.object({
  season: z.enum(SEASONS),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  label: z.string().trim().min(1).max(100).optional(),
});

const patchSchema = createSchema.extend({
  id: z.string().min(1),
});

const deleteSchema = z.object({ id: z.string().min(1) });

/** 입력 문자열 → UTC 자정 Date + start < end 검증. 실패 시 NextResponse(400) 반환 */
function parseRange(data: {
  startDate: string;
  endDate: string;
}): { startDate: Date; endDate: Date } | NextResponse {
  const startDate = parseUtcDateOnly(data.startDate);
  const endDate = parseUtcDateOnly(data.endDate);
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (startDate.getTime() >= endDate.getTime()) {
    return NextResponse.json(
      { error: "INVALID_RANGE", message: "시작일은 종료일보다 앞서야 합니다" },
      { status: 400 }
    );
  }
  return { startDate, endDate };
}

function serialize(p: {
  id: string;
  season: string;
  startDate: Date;
  endDate: Date;
  label: string | null;
}) {
  return {
    id: p.id,
    season: p.season,
    startDate: toDateOnlyString(p.startDate),
    endDate: toDateOnlyString(p.endDate),
    label: p.label,
  };
}

/** 같은 빌라 내 [start,end) 와 겹치는 기존 시즌 존재 여부 (excludeId는 자기 자신 제외 — 수정 시) */
async function hasOverlap(
  tx: Prisma.TransactionClient,
  villaId: string,
  range: { startDate: Date; endDate: Date },
  excludeId?: string
): Promise<boolean> {
  const count = await tx.villaSeasonPeriod.count({
    where: {
      villaId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startDate: { lt: range.endDate },
      endDate: { gt: range.startDate },
    },
  });
  return count > 0;
}

/** 자기 빌라 가드 — 미존재·타인은 null (호출부에서 404 매핑) */
async function loadOwnedVilla(
  tx: Prisma.TransactionClient,
  villaId: string,
  supplierId: string
) {
  const villa = await tx.villa.findUnique({
    where: { id: villaId },
    select: { id: true, supplierId: true },
  });
  if (!villa || villa.supplierId !== supplierId) return null;
  return villa;
}

// ===================== GET — 빌라 시즌 목록 =====================
export async function GET(
  _req: Request,
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
  const { id: villaId } = await params;

  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: { supplierId: true },
  });
  if (!villa || villa.supplierId !== supplierId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const periods = await prisma.villaSeasonPeriod.findMany({
    where: { villaId },
    orderBy: { startDate: "asc" },
    select: { id: true, season: true, startDate: true, endDate: true, label: true },
  });
  return NextResponse.json({ periods: periods.map(serialize) });
}

// ===================== POST — 시즌 생성 =====================
export async function POST(
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
  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const range = parseRange(parsed.data);
  if (range instanceof NextResponse) return range;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await loadOwnedVilla(tx, villaId, supplierId);
    if (!villa) return { kind: "NOT_FOUND" as const };

    if (await hasOverlap(tx, villaId, range)) {
      return { kind: "OVERLAP" as const };
    }

    const created = await tx.villaSeasonPeriod.create({
      data: {
        villaId,
        season: parsed.data.season,
        startDate: range.startDate,
        endDate: range.endDate,
        label: parsed.data.label ?? null,
      },
      select: { id: true, season: true, startDate: true, endDate: true, label: true },
    });

    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "CREATE",
      entity: "VillaSeasonPeriod",
      entityId: created.id,
      changes: {
        villaId: { new: villaId },
        season: { new: created.season },
        startDate: { new: toDateOnlyString(created.startDate) },
        endDate: { new: toDateOnlyString(created.endDate) },
        label: { new: created.label },
      },
    });

    return { kind: "OK" as const, period: created };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "OVERLAP") {
    return NextResponse.json(
      { error: "SEASON_OVERLAP", message: "같은 빌라의 기존 시즌 기간과 겹칩니다" },
      { status: 409 }
    );
  }
  return NextResponse.json({ period: serialize(result.period) }, { status: 201 });
}

// ===================== PATCH — 시즌 수정 =====================
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
  const range = parseRange(parsed.data);
  if (range instanceof NextResponse) return range;
  const periodId = parsed.data.id;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await loadOwnedVilla(tx, villaId, supplierId);
    if (!villa) return { kind: "NOT_FOUND" as const };

    // 대상 시즌 행이 이 빌라 소유인지 확인 (다른 빌라 행 villaId만 바꿔 침범 차단)
    const existing = await tx.villaSeasonPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, villaId: true, season: true, startDate: true, endDate: true, label: true },
    });
    if (!existing || existing.villaId !== villaId) return { kind: "PERIOD_NOT_FOUND" as const };

    if (await hasOverlap(tx, villaId, range, periodId)) {
      return { kind: "OVERLAP" as const };
    }

    const updated = await tx.villaSeasonPeriod.update({
      where: { id: periodId },
      data: {
        season: parsed.data.season,
        startDate: range.startDate,
        endDate: range.endDate,
        label: parsed.data.label ?? null,
      },
      select: { id: true, season: true, startDate: true, endDate: true, label: true },
    });

    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "UPDATE",
      entity: "VillaSeasonPeriod",
      entityId: updated.id,
      changes: {
        season: { old: existing.season, new: updated.season },
        startDate: {
          old: toDateOnlyString(existing.startDate),
          new: toDateOnlyString(updated.startDate),
        },
        endDate: {
          old: toDateOnlyString(existing.endDate),
          new: toDateOnlyString(updated.endDate),
        },
        label: { old: existing.label, new: updated.label },
      },
    });

    return { kind: "OK" as const, period: updated };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "PERIOD_NOT_FOUND") {
    return NextResponse.json({ error: "PERIOD_NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "OVERLAP") {
    return NextResponse.json(
      { error: "SEASON_OVERLAP", message: "같은 빌라의 기존 시즌 기간과 겹칩니다" },
      { status: 409 }
    );
  }
  return NextResponse.json({ period: serialize(result.period) });
}

// ===================== DELETE — 시즌 삭제 =====================
// 0건이 되면 그 빌라는 자동으로 전역 SeasonPeriod 폴백으로 돌아간다(ADR-0008 D2 — 견적 계속 동작).
export async function DELETE(
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
  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const periodId = parsed.data.id;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await loadOwnedVilla(tx, villaId, supplierId);
    if (!villa) return { kind: "NOT_FOUND" as const };

    const existing = await tx.villaSeasonPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, villaId: true, season: true, startDate: true, endDate: true, label: true },
    });
    if (!existing || existing.villaId !== villaId) return { kind: "PERIOD_NOT_FOUND" as const };

    await tx.villaSeasonPeriod.delete({ where: { id: periodId } });

    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "DELETE",
      entity: "VillaSeasonPeriod",
      entityId: existing.id,
      changes: {
        season: { old: existing.season, new: null },
        startDate: { old: toDateOnlyString(existing.startDate), new: null },
        endDate: { old: toDateOnlyString(existing.endDate), new: null },
      },
    });

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "PERIOD_NOT_FOUND") {
    return NextResponse.json({ error: "PERIOD_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ id: periodId, deleted: true });
}
