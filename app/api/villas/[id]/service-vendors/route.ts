// PUT /api/villas/[id]/service-vendors — 빌라별 지역 지정 업체(마사지·이발) 설정/해제 (ADR-0037)
//   REGIONAL_VENDOR_TYPES(MASSAGE·BARBER)만 허용. vendorId=업체 지정(APPROVED·active 검증), null=해제(delete).
//   권한: isOperator. 누수: 응답은 serviceType·vendorId만(bankInfo·판매가·마진 없음). AuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { REGIONAL_VENDOR_TYPES } from "@/lib/regional-vendor";

const bodySchema = z.object({
  // 지역 분포 타입만 지정 대상 — 그 외 타입은 400(REGIONAL_VENDOR_TYPES가 유일 허용)
  serviceType: z.enum(REGIONAL_VENDOR_TYPES),
  // null = 해제(카탈로그 기본으로 폴백)
  vendorId: z.string().min(1).nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const { serviceType, vendorId } = parsed.data;

  const villa = await prisma.villa.findUnique({ where: { id }, select: { id: true } });
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // ── 해제(null) — 기존 매핑이 있으면 삭제 + 감사로그. 없으면 멱등(변화 없음).
  if (vendorId === null) {
    const existing = await prisma.villaServiceVendor.findUnique({
      where: { villaId_serviceType: { villaId: id, serviceType } },
      select: { id: true, vendorId: true },
    });
    if (existing) {
      await prisma.villaServiceVendor.delete({ where: { id: existing.id } });
      await writeAuditLog({
        db: prisma,
        userId: g.session.user.id,
        action: "DELETE",
        entity: "VillaServiceVendor",
        entityId: existing.id,
        changes: {
          villaId: { old: id },
          serviceType: { old: serviceType },
          vendorId: { old: existing.vendorId },
        },
      });
    }
    return NextResponse.json({ serviceType, vendorId: null });
  }

  // ── 지정 — 승인(APPROVED)·활성(active) 벤더만 허용(엉뚱·미승인·비활성 배정 차단).
  const vendor = await prisma.serviceVendor.findFirst({
    where: { id: vendorId, approvalStatus: "APPROVED", active: true },
    select: { id: true },
  });
  if (!vendor) {
    return NextResponse.json({ error: "INVALID_VENDOR" }, { status: 400 });
  }

  const saved = await prisma.villaServiceVendor.upsert({
    where: { villaId_serviceType: { villaId: id, serviceType } },
    create: { villaId: id, serviceType, vendorId },
    update: { vendorId },
    select: { id: true, vendorId: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: g.session.user.id,
    action: "UPDATE",
    entity: "VillaServiceVendor",
    entityId: saved.id,
    changes: {
      villaId: { new: id },
      serviceType: { new: serviceType },
      vendorId: { new: vendorId },
    },
  });

  // ★누수 0 — serviceType·vendorId만 반환(bankInfo·판매가·마진 없음).
  return NextResponse.json({ serviceType, vendorId: saved.vendorId });
}
