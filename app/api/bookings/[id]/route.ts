import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";

/**
 * PATCH /api/bookings/[id] — 내부 메모(note) 전용 수정 (T2.5, b11 내부 메모 카드)
 * 상태·금액 등 다른 필드는 절대 수정 불가 — 전이 무결성은 confirm/cancel/expire
 * 전용 경로(lib/hold.ts)만 담당한다. zod가 note 외 필드를 무시(strip)한다.
 */

const patchSchema = z.object({
  note: z.string().max(2000, "메모는 2000자 이하여야 합니다"),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id } = await params;
  const existing = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, note: true },
  });
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

  // 빈 문자열은 메모 삭제 — null 저장 (계약 QA 권고)
  const note = parsed.data.note.trim() === "" ? null : parsed.data.note;

  const updated = await prisma.booking.update({
    where: { id },
    data: { note },
    select: { id: true, note: true },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "Booking",
    entityId: id,
    changes: { note: { old: existing.note, new: note } },
  });

  return Response.json({ booking: updated });
}
