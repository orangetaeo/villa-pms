// DELETE /api/admin/holidays/[id] — 공휴일(HolidayDate) 삭제 (ADR-0042, ADMIN 전용)
// 삭제는 additive 판정 축의 제거일 뿐 — 과거 견적/HOLD는 스냅샷이라 무영향(엔진은 미래 견적부터 반영).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { toDateOnlyString } from "@/lib/date-vn";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const { id } = await params;

  const existing = await prisma.holidayDate.findUnique({
    where: { id },
    select: { id: true, date: true, label: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.holidayDate.delete({ where: { id } });

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "DELETE",
    entity: "HolidayDate",
    entityId: id,
    changes: {
      date: { old: toDateOnlyString(existing.date), new: null },
      label: { old: existing.label, new: null },
    },
  });

  return NextResponse.json({ id, deleted: true });
}
