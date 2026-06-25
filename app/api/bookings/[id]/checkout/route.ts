import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { completeCheckout, CheckoutRejectedError } from "@/lib/checkout";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator } from "@/lib/permissions";

/** POST /api/bookings/[id]/checkout — 체크아웃 완료 (ADMIN 전용, SPEC F4) */

const checkoutSchema = z.object({
  photoUrls: z.array(z.string().min(1)).min(1, "상태 사진은 1장 이상 필요합니다").max(50),
  damageFound: z.boolean(),
  damageNote: z.string().trim().max(2000).optional(),
  damagePhotoUrls: z.array(z.string().min(1)).max(20).optional(),
  // VND BigInt — JSON 정밀도 손실 방지를 위해 숫자 문자열로 수신 (money-pattern)
  deductionVnd: z
    .string()
    .regex(/^\d+$/, "차감액은 동 단위 숫자여야 합니다")
    .optional(),
  // 미니바 판매 라인 — 가격은 받지 않는다(서버가 MinibarItem 스냅샷 재계산, 마진 비공개).
  //   qty는 정수≥0, consumed>0만 캡처. 알 수 없는 itemId는 lib/checkout이 트랜잭션에서 거부.
  minibarLines: z
    .array(
      z.object({
        minibarItemId: z.string().min(1),
        consumedQty: z.number().int().min(0).max(99),
        stockedQty: z.number().int().min(0).max(999),
      })
    )
    .max(100)
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const result = await completeCheckout(prisma, {
      bookingId: id,
      photoUrls: parsed.data.photoUrls,
      damageFound: parsed.data.damageFound,
      damageNote: parsed.data.damageNote,
      damagePhotoUrls: parsed.data.damagePhotoUrls,
      deductionVnd: parsed.data.deductionVnd ? BigInt(parsed.data.deductionVnd) : null,
      minibarLines: parsed.data.minibarLines,
      actorUserId: session.user.id,
      now: new Date(),
    });
    return Response.json({
      booking: serializeBigInt(result.booking),
      record: serializeBigInt(result.record),
    });
  } catch (e) {
    if (e instanceof CheckoutRejectedError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/checkout] 실패", e);
    return Response.json({ error: "체크아웃 처리에 실패했습니다" }, { status: 500 });
  }
}
