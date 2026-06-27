// /api/vendors/[id] — 원천 공급자 수정·삭제 (ADR-0023 §4.1). canSetPrice(OWNER/MANAGER).
//   PATCH: 거래처 정보 수정. ★bankInfo는 canViewFinance만 갱신(미권한자는 미변경).
//   DELETE: 연결된 카탈로그/주문이 있으면 하드삭제 금지(409) → active=false 권장. 참조 0이면 하드삭제.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  nameKo: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  zaloUserId: z.string().max(64).optional().nullable(),
  bankInfo: z.unknown().optional(), // 임의 JSON — canViewFinance만 갱신
  note: z.string().max(1000).optional().nullable(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role as Role | undefined;
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

  const existing = await prisma.serviceVendor.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // bankInfo: canViewFinance만 갱신 — 미권한자는 미변경(undefined로 보존).
  const bankUpdate =
    canFinance && d.bankInfo !== undefined
      ? { bankInfo: d.bankInfo === null ? Prisma.JsonNull : (d.bankInfo as Prisma.InputJsonValue) }
      : {};

  await prisma.serviceVendor.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.nameKo !== undefined ? { nameKo: d.nameKo } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.zaloUserId !== undefined ? { zaloUserId: d.zaloUserId } : {}),
      ...(d.note !== undefined ? { note: d.note } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...bankUpdate,
    },
  });

  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "UPDATE",
    entity: "ServiceVendor",
    entityId: id,
    changes: { name: { new: d.name } },
  });
  return NextResponse.json({ id });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const { id } = await params;

  const existing = await prisma.serviceVendor.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 참조 무결성: 연결된 카탈로그·주문이 있으면 하드삭제 금지(증빙·정산 보존). active=false로 비활성 권장.
  const [catalogCount, orderCount] = await Promise.all([
    prisma.serviceCatalogItem.count({ where: { vendorId: id } }),
    prisma.serviceOrder.count({ where: { vendorId: id } }),
  ]);
  if (catalogCount > 0 || orderCount > 0) {
    return NextResponse.json(
      { error: "VENDOR_IN_USE", catalogCount, orderCount, hint: "active=false로 비활성화하세요" },
      { status: 409 }
    );
  }

  await prisma.serviceVendor.delete({ where: { id } });
  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "DELETE",
    entity: "ServiceVendor",
    entityId: id,
  });
  return NextResponse.json({ id });
}
