// /api/vendors — 부가서비스 원천 공급자(거래처) 관리 (ADR-0023 §4.1)
//   GET: 운영자 목록(isOperator). 거래처 신원·연락처·연결 카탈로그 수. ★bankInfo는 canViewFinance만(원칙2).
//   POST: 거래처 생성(canSetPrice = OWNER/MANAGER). bankInfo는 canViewFinance만 저장(STAFF가 보내도 무시).
// ★ 마진 비공개: bankInfo(정산 계좌)는 정산 권한자만. 빌라 SUPPLIER와 무관한 별도 엔티티.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, canSetPrice, type Role } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  nameKo: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  zaloUserId: z.string().max(64).optional().nullable(),
  bankInfo: z.unknown().optional(), // 임의 JSON — canViewFinance만 저장
  note: z.string().max(1000).optional().nullable(),
  active: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isOperator(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const showFinance = canViewFinance(role);

  const vendors = await prisma.serviceVendor.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { catalogItems: true } } },
  });
  // ★ bankInfo(정산 계좌)는 canViewFinance만 — 서버에서 제거(클라 조건부 렌더 의존 금지).
  const data = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    nameKo: v.nameKo,
    phone: v.phone,
    zaloUserId: v.zaloUserId,
    note: v.note,
    active: v.active,
    // ADR-0023 S5 — 운영자가 승인대기 목록·반려 사유를 보고 승인/거절 (운영자 전용 라우트)
    approvalStatus: v.approvalStatus,
    rejectionReason: v.rejectionReason,
    approvedAt: v.approvedAt,
    hasAccount: !!v.userId,
    catalogCount: v._count.catalogItems,
    ...(showFinance ? { bankInfo: v.bankInfo } : {}),
  }));
  return NextResponse.json({ vendors: data });
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

  const created = await prisma.serviceVendor.create({
    data: {
      name: d.name,
      nameKo: d.nameKo ?? null,
      phone: d.phone ?? null,
      zaloUserId: d.zaloUserId ?? null,
      // bankInfo(정산 계좌)는 canViewFinance만 — STAFF가 보내도 무시
      bankInfo:
        canFinance && d.bankInfo != null ? (d.bankInfo as Prisma.InputJsonValue) : undefined,
      note: d.note ?? null,
      active: d.active ?? true,
    },
    select: { id: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "CREATE",
    entity: "ServiceVendor",
    entityId: created.id,
    changes: { name: { new: d.name } },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
