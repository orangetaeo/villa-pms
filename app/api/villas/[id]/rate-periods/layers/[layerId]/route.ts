// PATCH·DELETE /api/villas/[id]/rate-periods/layers/[layerId] — 레이어 1개 수정/삭제 (rate-calendar-ux)
//  - 날짜·라벨·시즌·가격 부분 수정. isBase(기본요금) 행은 날짜 수정 금지·삭제 금지.
//  - villaId 스코프 강제(타 빌라 레이어 조작 차단 → 404). 겹침 허용(half-open만 검증).
//  - 권한: ADMIN 전용(canSetPrice). writeAuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { SEASONS, digits, isoDate, toUtc } from "@/lib/rate-period-input";

// 부분 수정 — 전 필드 optional. nullable VND/KRW는 명시 null=평일 폴백 해제, 미포함=변경 없음.
const layerPatchSchema = z
  .object({
    season: z.enum(SEASONS).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    label: z.string().trim().max(60).nullable().optional(),
    supplierCostVnd: digits.optional(),
    marginType: z.enum(["PERCENT", "FIXED_VND"]).optional(),
    marginValue: digits.optional(),
    salePriceVnd: digits.optional(),
    salePriceKrw: z.number().int().min(0).optional(),
    consumerMarginType: z.enum(["PERCENT", "FIXED_VND"]).optional(),
    consumerMarginValue: digits.optional(),
    consumerSalePriceVnd: digits.nullable().optional(),
    consumerSalePriceKrw: z.number().int().min(0).nullable().optional(),
    premiumSupplierCostVnd: digits.nullable().optional(),
    premiumSalePriceVnd: digits.nullable().optional(),
    premiumSalePriceKrw: z.number().int().min(0).nullable().optional(),
    premiumConsumerSalePriceVnd: digits.nullable().optional(),
    premiumConsumerSalePriceKrw: z.number().int().min(0).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasStart = "startDate" in data && data.startDate != null;
    const hasEnd = "endDate" in data && data.endDate != null;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? "endDate" : "startDate"],
        message: "startDate와 endDate는 함께 수정해야 합니다",
      });
    } else if (hasStart && hasEnd) {
      if (toUtc(data.startDate!).getTime() >= toUtc(data.endDate!).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endDate"],
          message: "endDate must be after startDate",
        });
      }
    }
  });

type LayerPatch = z.infer<typeof layerPatchSchema>;

/** 부분 수정 → prisma update data(포함된 키만). nullable 컬럼은 명시 null 전달 반영. */
function buildPartialData(p: LayerPatch): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  const setVndReq = (k: "supplierCostVnd" | "marginValue" | "salePriceVnd") => {
    if (k in p && p[k] != null) d[k] = BigInt(p[k] as string);
  };
  const setVndNullable = (
    k:
      | "consumerSalePriceVnd"
      | "premiumSupplierCostVnd"
      | "premiumSalePriceVnd"
      | "premiumConsumerSalePriceVnd"
  ) => {
    if (k in p) d[k] = p[k] == null ? null : BigInt(p[k] as string);
  };
  const setKrwNullable = (k: "premiumSalePriceKrw" | "premiumConsumerSalePriceKrw") => {
    if (k in p) d[k] = p[k] ?? null;
  };
  if ("season" in p && p.season != null) d.season = p.season;
  if ("label" in p) d.label = p.label ?? null;
  if ("startDate" in p && p.startDate != null) d.startDate = toUtc(p.startDate);
  if ("endDate" in p && p.endDate != null) d.endDate = toUtc(p.endDate);
  setVndReq("supplierCostVnd");
  if ("marginType" in p && p.marginType != null) d.marginType = p.marginType;
  setVndReq("marginValue");
  setVndReq("salePriceVnd");
  if ("salePriceKrw" in p && p.salePriceKrw != null) d.salePriceKrw = p.salePriceKrw;
  if ("consumerMarginType" in p && p.consumerMarginType != null)
    d.consumerMarginType = p.consumerMarginType;
  if ("consumerMarginValue" in p && p.consumerMarginValue != null)
    d.consumerMarginValue = BigInt(p.consumerMarginValue);
  setVndNullable("consumerSalePriceVnd");
  if ("consumerSalePriceKrw" in p) d.consumerSalePriceKrw = p.consumerSalePriceKrw ?? null;
  setVndNullable("premiumSupplierCostVnd");
  setVndNullable("premiumSalePriceVnd");
  setKrwNullable("premiumSalePriceKrw");
  setVndNullable("premiumConsumerSalePriceVnd");
  setKrwNullable("premiumConsumerSalePriceKrw");
  return d;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; layerId: string }> }
) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const actorUserId = g.session.user.id;
  const { id, layerId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = layerPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const p = parsed.data;
  const editsDate = ("startDate" in p && p.startDate != null) || ("endDate" in p && p.endDate != null);

  const result = await prisma.$transaction(async (tx) => {
    // villaId 스코프 — 타 빌라 레이어는 404(존재 비노출)
    const row = await tx.villaRatePeriod.findFirst({
      where: { id: layerId, villaId: id },
      select: { id: true, isBase: true },
    });
    if (!row) return { kind: "NOT_FOUND" as const };
    if (row.isBase && editsDate) return { kind: "BASE_DATE_LOCKED" as const };

    const data = buildPartialData(p);
    await tx.villaRatePeriod.update({ where: { id: layerId }, data });

    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "UPDATE",
      entity: "VillaRatePeriod",
      entityId: layerId,
      changes: { fields: { new: Object.keys(data) } },
    });
    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "BASE_DATE_LOCKED") {
    return NextResponse.json({ error: "BASE_DATE_IMMUTABLE" }, { status: 400 });
  }
  return NextResponse.json({ id: layerId });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; layerId: string }> }
) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const actorUserId = g.session.user.id;
  const { id, layerId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.villaRatePeriod.findFirst({
      where: { id: layerId, villaId: id },
      select: { id: true, isBase: true },
    });
    if (!row) return { kind: "NOT_FOUND" as const };
    if (row.isBase) return { kind: "BASE_DELETE_LOCKED" as const };

    await tx.villaRatePeriod.delete({ where: { id: layerId } });
    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "DELETE",
      entity: "VillaRatePeriod",
      entityId: layerId,
      changes: { villaId: { old: id } },
    });
    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "BASE_DELETE_LOCKED") {
    return NextResponse.json({ error: "BASE_ROW_IMMUTABLE" }, { status: 400 });
  }
  return NextResponse.json({ id: layerId, deleted: true });
}
