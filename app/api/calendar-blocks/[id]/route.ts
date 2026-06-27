// DELETE /api/calendar-blocks/[id] — SUPPLIER 수동(MANUAL) 차단 해제 (T1.4, SPEC F2)
// ICAL 블록은 동기화(T1.6) 소유 — 여기서 해제 불가(403)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { toDateOnlyString, todayVnDateString } from "@/lib/date-vn";
import { isOperator } from "@/lib/permissions";
import { requireAuth } from "@/lib/api-guard";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — SUPPLIER(자기 빌라 블록) + ADMIN(전체 블록) 허용 (비로그인 401/타롤 403 분리)
  const g = await requireAuth(_req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role;
  if (role !== "SUPPLIER" && !isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;

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

  // 블록 존재 확인 — ADMIN 은 소유권 스코프 없이 존재만, SUPPLIER 는 자기 빌라 블록만(아니면 404)
  if (!block) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (role === "SUPPLIER" && block.villa.supplierId !== actorId) {
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
    userId: actorId,
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
