import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TamTruRejectedError, sendTamTruPassport } from "@/lib/tamtru";
import { isOperator } from "@/lib/permissions";

/**
 * POST /api/bookings/[id]/tamtru — 여권 Zalo 전달 (임시거주신고, T3.6, ADMIN 전용)
 * SPEC F4 체크인 2. CheckInRecord.passportPhotoUrls → 공급자 Zalo. 재전달 허용.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await sendTamTruPassport(prisma, {
      bookingId: id,
      actorUserId: session.user.id,
    });
    return Response.json({
      tamTruSentAt: result.tamTruSentAt.toISOString(),
      supplierLinked: result.supplierLinked,
    });
  } catch (e) {
    if (e instanceof TamTruRejectedError) {
      // NO_CHECKIN / NO_PASSPORT는 전제 미충족(400), NOT_FOUND는 404
      const status = e.reason === "NOT_FOUND" ? 404 : 400;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    console.error("[bookings/tamtru] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "여권 전달에 실패했습니다" }, { status: 500 });
  }
}
