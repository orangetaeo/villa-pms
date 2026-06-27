// /api/services/catalog/[id] — 카탈로그 항목 수정·삭제 (ADR-0019 v2). canSetPrice(OWNER/MANAGER).
//   한국어만 입력 → 저장 시 Gemini 자동번역(nameI18n/descI18n/옵션 labelI18n). 가격은 priceVnd 단일통화(필수).
//   costVnd는 canViewFinance만 갱신. 삭제는 하드 삭제(주문은 가격 스냅샷을 자체 보유하므로 무영향).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import {
  validateCatalogItem,
  SERVICE_TYPE_VALUES,
  parseAudiences,
  stripOptionCosts,
  parseCatalogOptions,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { buildCatalogI18n } from "@/lib/service-i18n";
import { Prisma } from "@prisma/client";

// 입력은 한국어만 — nameVi/nameEn·옵션 labelVi·priceKrw 입력 제거(저장 시 자동번역).
//   descKo=옵션별 설명(자동번역), costVnd=옵션별 원가(canViewFinance만).
const optionDefSchema = z.object({
  key: z.string().min(1).max(40),
  labelKo: z.string().min(1).max(80),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  descKo: z.string().max(1000).optional().nullable(),
  costVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
});
const patchSchema = z.object({
  type: z.enum(SERVICE_TYPE_VALUES as unknown as [string, ...string[]]),
  nameKo: z.string().min(1).max(120),
  descKo: z.string().max(1000).optional().nullable(),
  unitLabelKo: z.string().max(40).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/),
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
  // ADR-0023 — 원천 공급자 + 요청 주체 자격
  vendorId: z.string().min(1).max(40).optional().nullable(),
  audiences: z.array(z.enum(["ADMIN", "PARTNER", "GUEST"])).max(3).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  // 이행 방식(마사지·이발 픽업/방문) — null=미정, true=픽업, false=직접방문
  pickupAvailable: z.boolean().optional().nullable(),
  pickupNote: z.string().max(500).optional().nullable(),
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
  // ★옵션 원가는 canViewFinance만 — 비권한자가 보낸 옵션 costVnd는 제거 후 검증(POST와 동일 동작, 이중 방어)
  let gatedOptions = canFinance ? d.options : stripOptionCosts(d.options);
  const errs = validateCatalogItem({
    type: d.type,
    nameKo: d.nameKo,
    priceVnd: d.priceVnd ?? null,
    costVnd: d.costVnd ?? null,
    options: gatedOptions ?? null,
  });
  if (errs.length > 0) return NextResponse.json({ error: "VALIDATION_FAILED", codes: errs }, { status: 400 });

  // 기존 항목(옵션 포함) — 404 체크 + 비-재무 편집 시 옵션 원가 병합 보존용
  const existing = await prisma.serviceCatalogItem.findUnique({
    where: { id },
    select: { id: true, options: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 원천 공급자 — 지정되면 존재·active 검증(없으면 직접 제공). ADR-0023 §4.1.
  if (d.vendorId) {
    const vendor = await prisma.serviceVendor.findUnique({
      where: { id: d.vendorId },
      select: { id: true, active: true, approvalStatus: true },
    });
    if (!vendor || !vendor.active) {
      return NextResponse.json({ error: "VENDOR_NOT_FOUND" }, { status: 400 });
    }
    // 승인 게이트 — 미승인 공급자(자가가입 대기·거절)는 카탈로그 배정 불가 (ADR-0023 S5)
    if (vendor.approvalStatus !== "APPROVED") {
      return NextResponse.json({ error: "VENDOR_NOT_APPROVED" }, { status: 400 });
    }
  }
  // 요청 주체 자격 정규화(항상 ADMIN 포함).
  const audiences = parseAudiences(d.audiences);

  // 비권한자(STAFF) 편집 시, 기존에 저장돼 있던 옵션별 원가는 key 기준으로 다시 이식해 보존
  //   (STAFF 편집이 시간대 원가를 지우지 않게).
  if (!canFinance && d.options != null) {
    const prev = parseCatalogOptions(existing.options);
    const costByKey = new Map<string, string>();
    for (const g of [prev.variants, prev.addons, prev.modifiers]) {
      for (const o of g ?? []) if (o.costVnd) costByKey.set(o.key, o.costVnd);
    }
    const graft = (arr?: { key: string }[] | null) =>
      (arr ?? []).map((o) =>
        costByKey.has(o.key) ? { ...o, costVnd: costByKey.get(o.key) } : o
      );
    const g = gatedOptions as CatalogOptions;
    gatedOptions = {
      variants: graft(g.variants),
      addons: graft(g.addons),
      modifiers: graft(g.modifiers),
    } as typeof d.options;
  }

  // costVnd(항목 레벨): canViewFinance만 갱신 — 미권한자는 기존값 보존(undefined로 미변경).
  const costUpdate =
    canFinance
      ? { costVnd: d.costVnd != null && d.costVnd !== "" ? BigInt(d.costVnd) : null }
      : {};

  // 자동번역(best-effort) — 실패 시 i18n 없이 ko 폴백 저장(저장 자체는 실패 안 함).
  const i18n = await buildCatalogI18n({ nameKo: d.nameKo, descKo: d.descKo, options: gatedOptions });

  await prisma.serviceCatalogItem.update({
    where: { id },
    data: {
      type: d.type as Prisma.ServiceCatalogItemUpdateInput["type"],
      nameKo: d.nameKo,
      nameI18n: i18n.nameI18n != null ? (i18n.nameI18n as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      descKo: d.descKo ?? null,
      descI18n: i18n.descI18n != null ? (i18n.descI18n as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      unitLabelKo: d.unitLabelKo ?? null,
      priceKrw: null, // 미사용 — KRW는 표시 시점 환율로 파생
      priceVnd: BigInt(d.priceVnd),
      photoUrl: d.photoUrl ?? null,
      options: i18n.options != null ? (i18n.options as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      vendorId: d.vendorId ?? null,
      audiences: audiences as unknown as Prisma.InputJsonValue,
      pickupAvailable: d.pickupAvailable ?? null,
      pickupNote: d.pickupNote?.trim() || null,
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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
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
