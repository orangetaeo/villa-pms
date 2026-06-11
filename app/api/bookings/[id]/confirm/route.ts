import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { confirmHold, HoldRejectedError } from "@/lib/hold";
import { serializeBigInt } from "@/lib/serialize";

/** POST /api/bookings/[id]/confirm — 입금 확정 HOLD → CONFIRMED (ADMIN 전용, SPEC F3 흐름 4) */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const booking = await confirmHold(prisma, {
      bookingId: id,
      actorUserId: session.user.id,
      now: new Date(),
    });
    return Response.json({ booking: serializeBigInt(booking) });
  } catch (e) {
    if (e instanceof HoldRejectedError) {
      return Response.json({ error: e.reason, message: e.message }, { status: 409 });
    }
    console.error("[bookings/confirm] 실패", e);
    return Response.json({ error: "확정 처리에 실패했습니다" }, { status: 500 });
  }
}
