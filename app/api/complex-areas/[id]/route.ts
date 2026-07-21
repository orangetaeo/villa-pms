// PATCH /api/complex-areas/[id] — 지역(단지) 마스터 수정 (운영자 전용, ADR-0046)
//   name/nameKo/active/sortOrder 부분 수정. ★삭제 없음 — active=false 토글로 은퇴.
//   ★rename(name 변경) = 캐시 정합의 유일 쓰기 경로: 트랜잭션으로 Villa.complex(연결 빌라 전체)
//     + ServiceVendorRegion.region(구 name 정확일치)을 새 name으로 일괄 rewrite.
//     ServiceVendorRegion @@unique([vendorId,serviceType,region]) 충돌 대비 사전 dedupe → 충돌 시 400.
//   전 변경 AuditLog 필수(글로벌 절대 규칙).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { Prisma } from "@prisma/client";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(), // 정본 표기 변경 = rename 전파
    nameKo: z.string().trim().min(1).max(100).nullable().optional(), // null = 병기 클리어
    active: z.boolean().optional(), // false = 은퇴(신규 선택 불가, 기존 연결 유지)
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "NO_FIELDS" });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 운영자 전용 — 마스터 데이터 관리(재무 아님 → isOperator, D5)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await prisma.complexArea.findUnique({
    where: { id },
    select: { id: true, name: true, nameKo: true, active: true, sortOrder: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const renaming = data.name != null && data.name !== existing.name;
  const oldName = existing.name;
  const newName = data.name;

  // rename 시 name 중복(타 마스터) 사전 차단 — unique 위반을 400으로 표면화
  if (renaming) {
    const dup = await prisma.complexArea.findFirst({
      where: { name: newName!, id: { not: id } },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ error: "DUPLICATE_COMPLEX" }, { status: 400 });
  }

  // 변경 필드만 담은 update 데이터
  const updateData: Prisma.ComplexAreaUpdateInput = {};
  if (data.name != null) updateData.name = data.name;
  if (data.nameKo !== undefined) updateData.nameKo = data.nameKo; // null = 클리어
  if (data.active != null) updateData.active = data.active;
  if (data.sortOrder != null) updateData.sortOrder = data.sortOrder;

  const result = await prisma.$transaction(async (tx) => {
    let villaRewrites = 0;
    let regionRewrites = 0;

    if (renaming) {
      // ServiceVendorRegion dedupe 확인 — 구 name 행을 새 name으로 바꾸면
      //   같은 (vendorId,serviceType)에 새 name 행이 이미 있을 때 @@unique 충돌.
      const oldRegionRows = await tx.serviceVendorRegion.findMany({
        where: { region: oldName },
        select: { vendorId: true, serviceType: true },
      });
      if (oldRegionRows.length > 0) {
        const newRegionRows = await tx.serviceVendorRegion.findMany({
          where: { region: newName! },
          select: { vendorId: true, serviceType: true },
        });
        const newKeys = new Set(newRegionRows.map((r) => `${r.vendorId}::${r.serviceType}`));
        const collision = oldRegionRows.some((r) => newKeys.has(`${r.vendorId}::${r.serviceType}`));
        if (collision) return { kind: "REGION_CONFLICT" as const };
      }

      // 캐시 일괄 rewrite — Villa.complex(연결 빌라 전체) + ServiceVendorRegion.region(구 name)
      const v = await tx.villa.updateMany({
        where: { complexAreaId: id },
        data: { complex: newName! },
      });
      villaRewrites = v.count;
      const r = await tx.serviceVendorRegion.updateMany({
        where: { region: oldName },
        data: { region: newName! },
      });
      regionRewrites = r.count;
    }

    const updated = await tx.complexArea.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, nameKo: true, code: true, active: true, sortOrder: true },
    });
    return { kind: "OK" as const, updated, villaRewrites, regionRewrites };
  });

  if (result.kind === "REGION_CONFLICT") {
    return NextResponse.json(
      { error: "REGION_RENAME_CONFLICT", oldName, newName },
      { status: 400 },
    );
  }

  // 변경된 필드만 before/after 기록 + rename 전파 규모
  const changes: Record<string, { old?: unknown; new?: unknown }> = {};
  if (renaming) {
    changes.name = { old: oldName, new: result.updated.name };
    changes.villasRewritten = { new: result.villaRewrites };
    changes.regionsRewritten = { new: result.regionRewrites };
  }
  if (data.nameKo !== undefined) changes.nameKo = { old: existing.nameKo, new: result.updated.nameKo };
  if (data.active != null && data.active !== existing.active) {
    changes.active = { old: existing.active, new: result.updated.active };
  }
  if (data.sortOrder != null && data.sortOrder !== existing.sortOrder) {
    changes.sortOrder = { old: existing.sortOrder, new: result.updated.sortOrder };
  }
  await writeAuditLog({
    userId: g.session.user.id,
    action: "UPDATE",
    entity: "ComplexArea",
    entityId: id,
    changes,
  });

  return NextResponse.json(result.updated);
}
