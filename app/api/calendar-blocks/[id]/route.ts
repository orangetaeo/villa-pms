// DELETE /api/calendar-blocks/[id] — SUPPLIER 수동(MANUAL) 차단 해제 (T1.4, SPEC F2)
// ICAL 블록은 동기화(T1.6) 소유 — 여기서 해제 불가(403)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { toDateOnlyString, todayVnDateString } from "@/lib/date-vn";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — SUPPLIER 전용 (route handler 첫 줄 role 검사 규칙, 비로그인 401/타롤 403 분리)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;

  const { id } = await params;

  const block = await prisma.calendarBlock.findUnique({
    where: { id },
    select: {
      id: true,
      villaId: true,
      startDate: true,
      source: true,
      villa: { select: { supplierId: true } },
    },
  });

  // 소유권 검증 — 타인 빌라 블록은 존재 여부도 노출하지 않음 (404)
  if (!block || block.villa.supplierId !== supplierId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (block.source !== "MANUAL") {
    return NextResponse.json({ error: "ICAL_BLOCK_READONLY" }, { status: 403 });
  }
  // 과거 블록은 기록 보존(증빙) — 삭제 거부 (QA D3, Asia/Ho_Chi_Minh 오늘 기준)
  if (toDateOnlyString(block.startDate) < todayVnDateString()) {
    return NextResponse.json({ error: "PAST_DATE" }, { status: 400 });
  }

  await prisma.calendarBlock.delete({ where: { id: block.id } });

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: supplierId,
    action: "DELETE",
    entity: "CalendarBlock",
    entityId: block.id,
    changes: {
      villaId: { old: block.villaId },
      startDate: { old: toDateOnlyString(block.startDate) },
      source: { old: block.source },
    },
  });

  return NextResponse.json({ ok: true });
}
