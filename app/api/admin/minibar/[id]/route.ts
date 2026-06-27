// PATCH/DELETE /api/admin/minibar/[id] — 미니바 표준 품목 수정·삭제 (#2b, ADR-0016)
//
// 권한(첫 줄): canSetPrice(가격이 걸린 작업, STAFF 차단). AuditLog 필수.
// 부분 수정(PATCH) — 전달된 필드만 갱신. unitPriceVnd는 VND 동 단위 비음수 문자열.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { MINIBAR_VND_DIGITS, autoTranslateNameVi } from "@/lib/minibar";

const patchSchema = z
  .object({
    nameKo: z.string().trim().min(1).max(60).optional(),
    unitPriceVnd: z.string().regex(MINIBAR_VND_DIGITS).optional(),
    // 매입 단가(입고가) — 빈문자열/null이면 원가 제거, 값이면 갱신
    costVnd: z.string().regex(MINIBAR_VND_DIGITS).nullable().optional(),
    stockQty: z.number().int().min(0).max(999).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "EMPTY_PATCH" });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const userId = session.user.id;
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
  const data = parsed.data;

  const existing = await prisma.minibarItem.findUnique({
    where: { id },
    select: { id: true, nameKo: true, unitPriceVnd: true, costVnd: true, stockQty: true, active: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 한국어명 변경 시 베트남어 자동 재번역(소비자 vi 화면용). 실패 시 기존 nameVi 유지.
  const nameViUpdate =
    data.nameKo !== undefined && data.nameKo !== existing.nameKo
      ? { nameVi: await autoTranslateNameVi(data.nameKo) }
      : {};
  // 입고가: 키가 오면 갱신(빈문자열/null → 원가 제거), 없으면 미변경
  const costUpdate =
    data.costVnd !== undefined
      ? { costVnd: data.costVnd && data.costVnd !== "" ? BigInt(data.costVnd) : null }
      : {};

  const updated = await prisma.minibarItem.update({
    where: { id },
    data: {
      ...(data.nameKo !== undefined ? { nameKo: data.nameKo } : {}),
      ...nameViUpdate,
      ...(data.unitPriceVnd !== undefined ? { unitPriceVnd: BigInt(data.unitPriceVnd) } : {}),
      ...costUpdate,
      ...(data.stockQty !== undefined ? { stockQty: data.stockQty } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
    select: {
      id: true,
      itemKey: true,
      nameKo: true,
      nameVi: true,
      unitPriceVnd: true,
      costVnd: true,
      stockQty: true,
      sortOrder: true,
      active: true,
    },
  });

  // 감사 로그 — 변경된 필드 diff(가격·입고가·active·명칭). BigInt → 문자열.
  const changes: Record<string, { old?: unknown; new?: unknown }> = {};
  if (data.nameKo !== undefined && data.nameKo !== existing.nameKo) {
    changes.nameKo = { old: existing.nameKo, new: updated.nameKo };
  }
  if (data.unitPriceVnd !== undefined && BigInt(data.unitPriceVnd) !== existing.unitPriceVnd) {
    changes.unitPriceVnd = { old: existing.unitPriceVnd.toString(), new: updated.unitPriceVnd.toString() };
  }
  if (data.costVnd !== undefined && (updated.costVnd ?? null) !== (existing.costVnd ?? null)) {
    changes.costVnd = {
      old: existing.costVnd?.toString() ?? null,
      new: updated.costVnd?.toString() ?? null,
    };
  }
  if (data.stockQty !== undefined && data.stockQty !== existing.stockQty) {
    changes.stockQty = { old: existing.stockQty, new: updated.stockQty };
  }
  if (data.active !== undefined && data.active !== existing.active) {
    changes.active = { old: existing.active, new: updated.active };
  }
  if (Object.keys(changes).length > 0) {
    await writeAuditLog({ userId, action: "UPDATE", entity: "MinibarItem", entityId: id, changes });
  }

  return NextResponse.json({
    item: {
      ...updated,
      unitPriceVnd: updated.unitPriceVnd.toString(),
      costVnd: updated.costVnd?.toString() ?? null,
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canSetPrice, "canSetPrice", _req);
  if (!g.ok) return g.response;
  const session = g.session;
  const userId = session.user.id;
  const { id } = await params;

  const existing = await prisma.minibarItem.findUnique({
    where: { id },
    select: { id: true, nameKo: true, unitPriceVnd: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.minibarItem.delete({ where: { id } });

  await writeAuditLog({
    userId,
    action: "DELETE",
    entity: "MinibarItem",
    entityId: id,
    changes: {
      nameKo: { old: existing.nameKo },
      unitPriceVnd: { old: existing.unitPriceVnd.toString() },
    },
  });

  return NextResponse.json({ id });
}
