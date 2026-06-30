// PATCH /api/villas/[id]/cleaning-info — 청소직원용 빌라 운영정보 저장 (T-cleaner-features C·D)
//   address(주소)·accessInfo(출입정보)·cleaningNotes(청소 특이사항)만 수정. isOperator 전용.
//   ★ 누수: 마진·재고·가격 아님(관리 데이터). accessInfo는 배정 청소직원·운영자만 보는 정보로
//      /g·/p 공개경계에는 절대 노출하지 않는다(빌라 select 화이트리스트로 차단).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const bodySchema = z.object({
  address: z.string().max(300).optional().nullable(),
  // 출입 방식 — 번호키/열쇠/기타. 빌라마다 다름(번호키 없는 곳도 있음).
  accessType: z.enum(["KEYPAD", "KEY", "OTHER"]).optional().nullable(),
  accessInfo: z.string().max(1000).optional().nullable(),
  cleaningNotes: z.string().max(2000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, address: true, accessType: true, accessInfo: true, cleaningNotes: true },
  });
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const norm = (v: string | null | undefined, current: string | null) =>
    v !== undefined ? (v?.trim() || null) : current;
  const nextAddress = norm(parsed.data.address, villa.address);
  const nextAccessType =
    parsed.data.accessType !== undefined ? parsed.data.accessType : villa.accessType;
  const nextAccess = norm(parsed.data.accessInfo, villa.accessInfo);
  const nextNotes = norm(parsed.data.cleaningNotes, villa.cleaningNotes);

  await prisma.$transaction(async (tx) => {
    await tx.villa.update({
      where: { id: villa.id },
      data: {
        address: nextAddress,
        accessType: nextAccessType,
        accessInfo: nextAccess,
        cleaningNotes: nextNotes,
      },
    });
    await writeAuditLog({
      db: tx,
      userId: g.session.user.id,
      action: "UPDATE",
      entity: "Villa",
      entityId: villa.id,
      changes: {
        ...(nextAddress !== villa.address
          ? { address: { old: villa.address, new: nextAddress } }
          : {}),
        ...(nextAccessType !== villa.accessType
          ? { accessType: { old: villa.accessType, new: nextAccessType } }
          : {}),
        ...(nextAccess !== villa.accessInfo
          ? { accessInfo: { old: villa.accessInfo, new: nextAccess } }
          : {}),
        ...(nextNotes !== villa.cleaningNotes
          ? { cleaningNotes: { old: villa.cleaningNotes, new: nextNotes } }
          : {}),
      },
    });
  });

  return NextResponse.json({
    address: nextAddress,
    accessType: nextAccessType,
    accessInfo: nextAccess,
    cleaningNotes: nextNotes,
  });
}
