// /api/services/catalog — 부가서비스 판매 카탈로그 (ADR-0019 v2)
//   GET: 운영자 목록(원가 costVnd는 canViewFinance만 — STAFF 페이로드에서 제거). nameKo+nameI18n 등 노출.
//   POST: 카탈로그 항목 생성(canSetPrice = OWNER/MANAGER). 한국어만 입력 → 저장 시 Gemini 자동번역.
//     가격은 priceVnd 단일통화(필수). costVnd는 canViewFinance만 저장. KRW는 표시 시점 환율로 파생.
// ★ 마진 비공개: 게스트·공급자·공개 라우트는 이 엔드포인트에 도달 불가(운영자 전용).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { validateCatalogItem, SERVICE_TYPE_VALUES, parseAudiences, stripOptionCosts } from "@/lib/service-catalog";
import { buildCatalogI18n } from "@/lib/service-i18n";
import type { Prisma } from "@prisma/client";

// 입력은 한국어만 — nameVi/nameEn·옵션 labelVi·priceKrw 입력 제거(저장 시 자동번역).
//   descKo는 옵션별 설명(자동번역), costVnd는 옵션별 원가(canViewFinance만 — 비권한자는 서버에서 제거).
const optionDefSchema = z.object({
  key: z.string().min(1).max(40),
  labelKo: z.string().min(1).max(80),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  descKo: z.string().max(1000).optional().nullable(),
  costVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
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
  descKo: z.string().max(1000).optional().nullable(),
  unitLabelKo: z.string().max(40).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/),
  costVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  options: optionsSchema,
  // ADR-0023 — 원천 공급자 + 요청 주체 자격
  vendorId: z.string().min(1).max(40).optional().nullable(),
  audiences: z.array(z.enum(["ADMIN", "PARTNER", "GUEST"])).max(3).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  // 이행 방식(마사지·이발 픽업/방문) — null=미정, true=픽업, false=직접방문
  pickupAvailable: z.boolean().optional().nullable(),
  pickupNote: z.string().max(500).optional().nullable(),
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
  //   가격은 priceVnd 단일통화(KRW는 표시 시점 환율로 파생 — 저장·노출 안 함).
  const data = items.map((it) => ({
    id: it.id,
    type: it.type,
    nameKo: it.nameKo,
    nameI18n: it.nameI18n,
    descKo: it.descKo,
    descI18n: it.descI18n,
    unitLabelKo: it.unitLabelKo,
    priceVnd: it.priceVnd?.toString() ?? null,
    photoUrl: it.photoUrl,
    // ★옵션 원가(costVnd)는 canViewFinance만 — 비권한자에겐 옵션 JSON에서 제거(원칙2)
    options: showCost ? it.options : stripOptionCosts(it.options),
    // ADR-0023 — 운영자 전용 라우트라 공급자 신원·채널 자격 노출 가능
    vendorId: it.vendorId,
    audiences: it.audiences,
    pickupAvailable: it.pickupAvailable,
    pickupNote: it.pickupNote,
    active: it.active,
    sortOrder: it.sortOrder,
    ...(showCost ? { costVnd: it.costVnd?.toString() ?? null } : {}),
  }));
  return NextResponse.json({ items: data });
}

export async function POST(req: Request) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role as Role | undefined;
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
  // ★옵션 원가는 canViewFinance만 — 비권한자가 보낸 옵션 costVnd는 서버에서 제거(이중 방어, 원칙2)
  const gatedOptions = canFinance ? d.options : stripOptionCosts(d.options);
  // 순수 교차검증(타입·이름·priceVnd 필수·옵션 키)
  const errs = validateCatalogItem({
    type: d.type,
    nameKo: d.nameKo,
    priceVnd: d.priceVnd ?? null,
    costVnd: d.costVnd ?? null,
    options: gatedOptions ?? null,
  });
  if (errs.length > 0) {
    return NextResponse.json({ error: "VALIDATION_FAILED", codes: errs }, { status: 400 });
  }

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

  // 자동번역(best-effort): nameKo+descKo+옵션 labelKo·descKo → i18n. 원가는 패스스루(번역 안 함).
  //   GEMINI 미설정/실패 시 i18n 없이(ko 폴백) 저장 — 저장 자체를 실패시키지 않는다.
  const i18n = await buildCatalogI18n({ nameKo: d.nameKo, descKo: d.descKo, options: gatedOptions });

  const created = await prisma.serviceCatalogItem.create({
    data: {
      type: d.type as Prisma.ServiceCatalogItemCreateInput["type"],
      nameKo: d.nameKo,
      nameI18n: (i18n.nameI18n ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      descKo: d.descKo ?? null,
      descI18n: (i18n.descI18n ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      unitLabelKo: d.unitLabelKo ?? null,
      priceKrw: null, // 미사용 — 게스트 KRW는 priceVnd×환율 올림으로 표시-시점 산출
      priceVnd: BigInt(d.priceVnd),
      // 원가는 canViewFinance만 — STAFF가 보내도 무시
      costVnd: canFinance && d.costVnd != null && d.costVnd !== "" ? BigInt(d.costVnd) : null,
      photoUrl: d.photoUrl ?? null,
      options: (i18n.options ?? undefined) as Prisma.InputJsonValue | undefined,
      vendorId: d.vendorId ?? null,
      audiences: audiences as unknown as Prisma.InputJsonValue,
      pickupAvailable: d.pickupAvailable ?? null,
      pickupNote: d.pickupNote?.trim() || null,
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
