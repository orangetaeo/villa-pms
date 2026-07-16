// /api/admin/business-contracts — 사업 계약서 관리 (운영자 전용, T-business-contract-esign)
//   GET: 목록(counterpart User name·role 조인, status 필터). canViewFinance.
//   POST: 생성(DRAFT). counterpart role→type 자동 결정, role 불일치 400. termsJson zod(.strict).
//         같은 (counterpart,type)에 DRAFT/SENT 존재 시 409, SIGNED 존재 시 409(재계약은 void 후).
// ★ 응답에 원가·마진·판매가 없음. termsJson은 별표(신원·정산주기 등)만.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import {
  contractTypeForRole,
  isLocaleAllowed,
  parseTerms,
  CURRENT_STANDARD_VERSION,
} from "@/lib/business-contract";
import type { Prisma, BusinessContractStatus } from "@prisma/client";

const STATUS_VALUES = ["DRAFT", "SENT", "SIGNED", "VOID"] as const;

const createSchema = z.object({
  counterpartId: z.string().min(1).max(40),
  locale: z.enum(["ko", "vi"]),
  terms: z.record(z.string(), z.unknown()),
  standardVersion: z.string().min(1).max(20).optional(),
});

export async function GET(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const where: Prisma.BusinessContractWhereInput = {};
  if (statusParam && (STATUS_VALUES as readonly string[]).includes(statusParam)) {
    where.status = statusParam as BusinessContractStatus;
  }

  const rows = await prisma.businessContract.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      counterpartId: true,
      status: true,
      standardVersion: true,
      locale: true,
      signedAt: true,
      sentAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // counterpart User name·role 조인(별도 조회 — 관계 미설정 모델).
  const ids = [...new Set(rows.map((r) => r.counterpartId))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, role: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const contracts = rows.map((r) => ({
    ...r,
    counterpartName: userById.get(r.counterpartId)?.name ?? null,
    counterpartRole: userById.get(r.counterpartId)?.role ?? null,
  }));

  return NextResponse.json({ contracts });
}

export async function POST(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;

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
  const { counterpartId, locale } = parsed.data;

  // counterpart User role → 계약 타입 결정. 존재·활성 확인.
  const counterpart = await prisma.user.findFirst({
    where: { id: counterpartId, deletedAt: null, isActive: true },
    select: { id: true, role: true },
  });
  if (!counterpart) {
    return NextResponse.json({ error: "COUNTERPART_NOT_FOUND" }, { status: 404 });
  }
  const type = contractTypeForRole(counterpart.role);
  if (!type) {
    return NextResponse.json({ error: "ROLE_NOT_ELIGIBLE", role: counterpart.role }, { status: 400 });
  }
  if (!isLocaleAllowed(type, locale)) {
    return NextResponse.json({ error: "LOCALE_NOT_ALLOWED", type, locale }, { status: 400 });
  }

  // termsJson 타입별 zod(.strict) — 원가·마진 등 미지정 키 거부.
  const termsParsed = parseTerms(type, parsed.data.terms);
  if (!termsParsed.success) {
    return NextResponse.json(
      { error: "TERMS_VALIDATION_FAILED", issues: termsParsed.error.flatten() },
      { status: 400 },
    );
  }

  // 중복 가드: 같은 (counterpart,type)에 진행 중(DRAFT/SENT) 또는 SIGNED 존재 시 409.
  const existing = await prisma.businessContract.findFirst({
    where: { counterpartId, type, status: { in: ["DRAFT", "SENT", "SIGNED"] } },
    select: { id: true, status: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: existing.status === "SIGNED" ? "SIGNED_CONTRACT_EXISTS" : "ACTIVE_CONTRACT_EXISTS",
        existingId: existing.id,
        existingStatus: existing.status,
      },
      { status: 409 },
    );
  }

  const created = await prisma.businessContract.create({
    data: {
      type,
      counterpartId,
      status: "DRAFT",
      standardVersion: parsed.data.standardVersion ?? CURRENT_STANDARD_VERSION,
      termsJson: termsParsed.data as Prisma.InputJsonValue,
      locale,
      createdById: actorId,
    },
    select: { id: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "CREATE",
    entity: "BusinessContract",
    entityId: created.id,
    changes: { type: { new: type }, counterpartId: { new: counterpartId }, status: { new: "DRAFT" } },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
