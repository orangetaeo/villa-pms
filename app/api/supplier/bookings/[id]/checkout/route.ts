// POST /api/supplier/bookings/[id]/checkout — 공급자 직접예약 체크아웃 (T10.5, F10 D5/D6 / ADR-0021 §6·§6.1)
//
// 공급자가 자기 빌라 현장에서 자기 직접예약 게스트를 체크아웃한다(기준사진 대조·파손·미니바 정산).
// 비즈니스 로직은 운영자와 동일한 lib/checkout.completeCheckout 재사용
//   → CHECKED_OUT + CleaningTask 생성 + isSellable=false(검수 게이트 닫기) + 미니바 소모 라인(D6).
// 미니바=운영자 재고·매출: 소비분(소비수량×판매가)은 우리 매출로 게스트 청구(공급자 직접판매여도).
//   ★ 가격은 서버가 MinibarItem에서 스냅샷 — 클라가 보낸 가격 신뢰 금지(마진 비공개·무결성). 응답에 costVnd·마진 0.
// 권한·누수: SUPPLIER + seller=SUPPLIER + villa.supplierId === 본인. 미일치=404(존재 비노출, T10.2 패턴).
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { completeCheckout, CheckoutRejectedError } from "@/lib/checkout";
import { serializeBigInt } from "@/lib/serialize";
import {
  SupplierBookingForbiddenError,
  assertSupplierCanInspectBooking,
} from "@/lib/supplier-booking-access";

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
  // 게스트 통합정산 수납 (ADR-0019 S4) — 현금/계좌이체/기타. 미지정이면 청구액만 기록.
  settlement: z
    .object({
      method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 첫 줄 권한 검사 — SUPPLIER 전용
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  if (session.user.role !== "SUPPLIER") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const supplierId = session.user.id;

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
    // 소유·주체 가드 — 자기 빌라 AND seller=SUPPLIER 가 아니면 404(존재 비노출)
    await assertSupplierCanInspectBooking(prisma, id, supplierId);

    const result = await completeCheckout(prisma, {
      bookingId: id,
      photoUrls: parsed.data.photoUrls,
      damageFound: parsed.data.damageFound,
      damageNote: parsed.data.damageNote,
      damagePhotoUrls: parsed.data.damagePhotoUrls,
      deductionVnd: parsed.data.deductionVnd ? BigInt(parsed.data.deductionVnd) : null,
      minibarLines: parsed.data.minibarLines,
      settlement: parsed.data.settlement ?? null,
      actorUserId: supplierId,
      now: new Date(),
    });
    // 응답은 공급자 안전 필드만 — booking 전체(totalSaleKrw·supplierCostVnd 등)·record 원본을 그대로
    //   내보내지 않는다. UI는 라우팅·완료 표시만 필요하므로 상태·미니바 합계(VND 판매가)만 반환(마진 비공개).
    return Response.json(
      serializeBigInt({
        bookingId: result.booking.id,
        status: result.booking.status,
        depositStatus: result.booking.depositStatus,
        minibarChargeVnd: result.record.minibarChargeVnd, // 미니바 판매 합계(VND, 판매가) — 원가·마진 아님
        guestChargeVnd: result.record.guestChargeVnd,
      })
    );
  } catch (e) {
    if (e instanceof SupplierBookingForbiddenError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (e instanceof CheckoutRejectedError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[supplier/checkout] 실패", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "체크아웃 처리에 실패했습니다" }, { status: 500 });
  }
}
