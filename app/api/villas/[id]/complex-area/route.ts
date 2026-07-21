// PATCH /api/villas/[id]/complex-area — ADMIN이 기존 빌라의 지역(단지) 변경 (ADR-0046, T-admin-villa-region)
//
// ComplexArea 마스터 체계의 마지막 구멍: 정상 운영 중인 빌라의 지역을 운영자가 바꾸는 경로.
// body.complexAreaId(null=해제)만 수신 — complex(비정규화 캐시)는 resolveComplexAreaForVilla 경유 서버 파생 쓰기.
// 권한: isOperator 전용 — 지역은 마진·재고 아님(누수 무관), 관리 데이터. name-vi 라우트와 동일 권한 모델.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { resolveComplexAreaForVilla } from "@/lib/complex-area";

export const runtime = "nodejs";

const bodySchema = z.object({
  // null = 지역 해제(complexAreaId=null, complex=null). 값 = 활성 마스터 lookup 후 name 캐시 채움.
  complexAreaId: z.string().min(1).nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, complex: true, complexAreaId: true },
  });
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 지역 파생 — 마스터 lookup(단일 원천). 미존재/비활성 id는 400 UNKNOWN_COMPLEX(마스터 봉인 일관성).
  const resolved = await resolveComplexAreaForVilla(prisma, parsed.data.complexAreaId);
  if (!resolved.ok) {
    return NextResponse.json({ error: "UNKNOWN_COMPLEX" }, { status: 400 });
  }

  const nextComplexAreaId = resolved.complexAreaId;
  const nextComplex = resolved.complex;

  const changed =
    nextComplexAreaId !== villa.complexAreaId || nextComplex !== villa.complex;
  if (!changed) {
    // 변화 없음 — 멱등
    return NextResponse.json({ complexAreaId: nextComplexAreaId, complex: nextComplex });
  }

  await prisma.$transaction(async (tx) => {
    await tx.villa.update({
      where: { id: villa.id },
      data: { complexAreaId: nextComplexAreaId, complex: nextComplex },
    });
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "Villa",
      entityId: villa.id,
      changes: {
        complex: { old: villa.complex, new: nextComplex },
        complexAreaId: { old: villa.complexAreaId, new: nextComplexAreaId },
      },
    });
  });

  return NextResponse.json({ complexAreaId: nextComplexAreaId, complex: nextComplex });
}
