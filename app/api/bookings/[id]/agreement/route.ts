import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { signAgreement, AgreementRejectedError } from "@/lib/checkin";

/**
 * POST /api/bookings/[id]/agreement — 사후 서명 (T3.2 계약 결정 2, ADMIN 전용)
 * 무서명 CHECKED_IN 레코드의 소급 해소 경로. 이미 서명·비체크인 상태는 409.
 */

const agreementSchema = z.object({
  // 비공개 증빙 경로만 — 공개 /uploads·외부 URL 차단 (T3.1 조건 A 정합)
  signatureUrl: z.string().regex(/^\/api\/passports\/[a-zA-Z0-9._-]+$/),
});

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
  const parsed = agreementSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const record = await signAgreement(prisma, {
      bookingId: id,
      signatureUrl: parsed.data.signatureUrl,
      actorUserId: session.user.id,
      now: new Date(),
    });
    return Response.json({ checkInRecord: record });
  } catch (e) {
    if (e instanceof AgreementRejectedError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/agreement] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "서명 처리에 실패했습니다" }, { status: 500 });
  }
}
