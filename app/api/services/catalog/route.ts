// /api/services/catalog — 부가서비스 판매 카탈로그 (ADR-0019 S2)
//   GET: 운영자 목록(원가 costVnd는 canViewFinance만 — STAFF 페이로드에서 제거).
//   POST: 카탈로그 항목 생성(canSetPrice = OWNER/MANAGER). costVnd는 canViewFinance만 저장.
// ★ 마진 비공개: 게스트·공급자·공개 라우트는 이 엔드포인트에 도달 불가(운영자 전용).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import { validateCatalogItem, SERVICE_TYPE_VALUES } from "@/lib/service-catalog";
import type { Prisma } from "@prisma/client";

const optionDefSchema = z.object({
  key: z.string().min(1).max(40),
  labelKo: z.string().min(1).max(80),
  labelVi: z.string().max(80).optional().nullable(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
});
const optionsSchema = z
  .object({
    variants: z.array(optionDefSchema).max(40).optional(),
    addons: z.array(optionDefSchema).max(60).optional(),
    modifiers: z.array(optionDefSchema).max(40).optional(),
  })
  .optional()
  .nullable();

const createSchema = z.object({
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
  options: optionsSchema,
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isOperator(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const showCost = canViewFinance(role);

  const items = await prisma.serviceCatalogItem.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  // 원가는 canViewFinance만 — 서버에서 제거(클라 조건부 렌더 의존 금지). BigInt는 문자열로 직렬화.
  const data = items.map((it) => ({
    id: it.id,
    type: it.type,
    nameKo: it.nameKo,
    nameVi: it.nameVi,
    nameEn: it.nameEn,
    descKo: it.descKo,
    descVi: it.descVi,
    unitLabelKo: it.unitLabelKo,
    priceKrw: it.priceKrw,
    priceVnd: it.priceVnd?.toString() ?? null,
    photoUrl: it.photoUrl,
    options: it.options,
    active: it.active,
    sortOrder: it.sortOrder,
    ...(showCost ? { costVnd: it.costVnd?.toString() ?? null } : {}),
  }));
  return NextResponse.json({ items: data });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!canSetPrice(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = session.user.id;
  const canFinance = canViewFinance(role);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  // 순수 교차검증(타입·이름·최소1가격·옵션 키)
  const errs = validateCatalogItem({
    type: d.type,
    nameKo: d.nameKo,
    priceKrw: d.priceKrw ?? null,
    priceVnd: d.priceVnd ?? null,
    costVnd: d.costVnd ?? null,
    options: d.options ?? null,
  });
  if (errs.length > 0) {
    return NextResponse.json({ error: "VALIDATION_FAILED", codes: errs }, { status: 400 });
  }

  const created = await prisma.serviceCatalogItem.create({
    data: {
      type: d.type as Prisma.ServiceCatalogItemCreateInput["type"],
      nameKo: d.nameKo,
      nameVi: d.nameVi ?? null,
      nameEn: d.nameEn ?? null,
      descKo: d.descKo ?? null,
      descVi: d.descVi ?? null,
      unitLabelKo: d.unitLabelKo ?? null,
      priceKrw: d.priceKrw ?? null,
      priceVnd: d.priceVnd != null && d.priceVnd !== "" ? BigInt(d.priceVnd) : null,
      // 원가는 canViewFinance만 — STAFF가 보내도 무시
      costVnd: canFinance && d.costVnd != null && d.costVnd !== "" ? BigInt(d.costVnd) : null,
      photoUrl: d.photoUrl ?? null,
      options: (d.options ?? undefined) as Prisma.InputJsonValue | undefined,
      active: d.active ?? true,
      sortOrder: d.sortOrder ?? 0,
    },
    select: { id: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "CREATE",
    entity: "ServiceCatalogItem",
    entityId: created.id,
    changes: { nameKo: { new: d.nameKo }, type: { new: d.type } },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
