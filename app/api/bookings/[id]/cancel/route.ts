import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cancelBooking, HoldRejectedError } from "@/lib/hold";
import { serializeBigInt } from "@/lib/serialize";

const cancelSchema = z.object({
  cancelReason: z.string().trim().min(1, "취소 사유는 필수입니다"),
});

/** POST /api/bookings/[id]/cancel — HOLD·CONFIRMED → CANCELLED (ADMIN 전용, cancelReason 필수) */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const booking = await cancelBooking(prisma, {
      bookingId: id,
      cancelReason: parsed.data.cancelReason,
      actorUserId: session.user.id,
    });
    return Response.json({ booking: serializeBigInt(booking) });
  } catch (e) {
    if (e instanceof HoldRejectedError) {
      return Response.json({ error: e.reason, message: e.message }, { status: 409 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/cancel] 실패", e);
    return Response.json({ error: "취소 처리에 실패했습니다" }, { status: 500 });
  }
}
