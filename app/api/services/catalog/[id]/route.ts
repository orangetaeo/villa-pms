// /api/services/catalog/[id] — 카탈로그 항목 수정·삭제 (ADR-0019 S2). canSetPrice(OWNER/MANAGER).
//   costVnd는 canViewFinance만 갱신. 삭제는 하드 삭제(주문은 가격 스냅샷을 자체 보유하므로 무영향).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import { validateCatalogItem, SERVICE_TYPE_VALUES } from "@/lib/service-catalog";
import type { Prisma } from "@prisma/client";

const optionDefSchema = z.object({
  key: z.string().min(1).max(40),
  labelKo: z.string().min(1).max(80),
  labelVi: z.string().max(80).optional().nullable(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
});
const patchSchema = z.object({
  type: z.enum(SERVICE_TYPE_VALUES as unknown as [string, ...string[]]),
  nameKo: z.string().min(1).max(120),
  nameVi: z.string().max(120).optional().nullable(),
  nameEn: z.string().max(120).optional().nullable(),
  descKo: z.string().max(1000).optional().nullable(),
  descVi: z.string().max(1000).optional().nullable(),
  unitLabelKo: z.string().max(40).optional().nullable(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  costVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  options: z
    .object({
      variants: z.array(optionDefSchema).max(40).optional(),
      addons: z.array(optionDefSchema).max(60).optional(),
      modifiers: z.array(optionDefSchema).max(40).optional(),
    })
    .optional()
    .nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!canSetPrice(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const canFinance = canViewFinance(role);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const errs = validateCatalogItem({
    type: d.type,
    nameKo: d.nameKo,
    priceKrw: d.priceKrw ?? null,
    priceVnd: d.priceVnd ?? null,
    costVnd: d.costVnd ?? null,
    options: d.options ?? null,
  });
  if (errs.length > 0) return NextResponse.json({ error: "VALIDATION_FAILED", codes: errs }, { status: 400 });

  const existing = await prisma.serviceCatalogItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // costVnd: canViewFinance만 갱신 — STAFF/MANAGER 권한별. 미권한자는 기존값 보존(undefined로 미변경).
  const costUpdate =
    canFinance
      ? { costVnd: d.costVnd != null && d.costVnd !== "" ? BigInt(d.costVnd) : null }
      : {};

  await prisma.serviceCatalogItem.update({
    where: { id },
    data: {
      type: d.type as Prisma.ServiceCatalogItemUpdateInput["type"],
      nameKo: d.nameKo,
      nameVi: d.nameVi ?? null,
      nameEn: d.nameEn ?? null,
      descKo: d.descKo ?? null,
      descVi: d.descVi ?? null,
      unitLabelKo: d.unitLabelKo ?? null,
      priceKrw: d.priceKrw ?? null,
      priceVnd: d.priceVnd != null && d.priceVnd !== "" ? BigInt(d.priceVnd) : null,
      photoUrl: d.photoUrl ?? null,
      options: (d.options ?? undefined) as Prisma.InputJsonValue | undefined,
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      ...costUpdate,
    },
  });

  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "UPDATE",
    entity: "ServiceCatalogItem",
    entityId: id,
    changes: { nameKo: { new: d.nameKo } },
  });
  return NextResponse.json({ id });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!canSetPrice(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;

  const existing = await prisma.serviceCatalogItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.serviceCatalogItem.delete({ where: { id } });
  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "DELETE",
    entity: "ServiceCatalogItem",
    entityId: id,
  });
  return NextResponse.json({ id });
}
