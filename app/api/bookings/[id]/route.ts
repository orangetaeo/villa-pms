import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";

/**
 * PATCH /api/bookings/[id] — 내부 메모(note)·투숙객 명단(guestRoster) 수정
 * (T2.5 내부 메모 + T-guest-roster 실명 명단)
 * 상태·금액 등 다른 필드는 절대 수정 불가 — 전이 무결성은 confirm/cancel/expire
 * 전용 경로(lib/hold.ts)만 담당한다. zod가 허용 필드 외를 무시(strip)한다.
 * note·guestRoster 중 제공된 필드만 갱신(둘 다 없으면 400).
 */

const patchSchema = z
  .object({
    note: z.string().max(2000, "메모는 2000자 이하여야 합니다").optional(),
    guestRoster: z.string().max(2000, "투숙객 명단은 2000자 이하여야 합니다").optional(),
  })
  .refine((d) => d.note !== undefined || d.guestRoster !== undefined, {
    message: "수정할 필드(note·guestRoster)가 없습니다",
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
    select: { id: true, note: true, guestRoster: true },
  });
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

  // 제공된 필드만 갱신. 빈 문자열은 삭제 — null 저장 (계약 QA 권고)
  const data: { note?: string | null; guestRoster?: string | null } = {};
  const changes: Record<string, { old: string | null; new: string | null }> = {};
  if (parsed.data.note !== undefined) {
    const note = parsed.data.note.trim() === "" ? null : parsed.data.note;
    data.note = note;
    changes.note = { old: existing.note, new: note };
  }
  if (parsed.data.guestRoster !== undefined) {
    const roster = parsed.data.guestRoster.trim() === "" ? null : parsed.data.guestRoster;
    data.guestRoster = roster;
    changes.guestRoster = { old: existing.guestRoster, new: roster };
  }

  const updated = await prisma.booking.update({
    where: { id },
    data,
    select: { id: true, note: true, guestRoster: true },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "Booking",
    entityId: id,
    changes,
  });

  return Response.json({ booking: updated });
}
