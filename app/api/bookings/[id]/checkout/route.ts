import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { completeCheckout, CheckoutRejectedError, type MinibarLineInput } from "@/lib/checkout";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { effectivePar, computeConsumptionFromRemaining } from "@/lib/minibar-inventory";

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
  //   입력 방식 2종(호환):
  //     ① remaining(남은 수량) — 신규 UX. 서버가 par 조회 후 consumedQty=par−remaining 역산(클라 신뢰 금지).
  //     ② consumedQty(소비 수량) — 기존 호출 호환. remaining이 있으면 remaining 우선.
  //   stockedQty(비치 수량 스냅샷)는 선택. par는 서버가 VillaMinibarStock·MinibarItem로 재조회한다.
  minibarLines: z
    .array(
      z.object({
        minibarItemId: z.string().min(1),
        consumedQty: z.number().int().min(0).max(99).optional(),
        remaining: z.number().int().min(0).max(999).optional(),
        stockedQty: z.number().int().min(0).max(999).optional(),
      })
    )
    .max(100)
    .optional(),
  // 게스트 통합정산 수납 (ADR-0019 S4) — 현금/계좌이체/기타. 미지정이면 청구액만 기록(미수납).
  settlement: z
    .object({
      method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .optional()
    .nullable(),
});

type RawMinibarLine = {
  minibarItemId: string;
  consumedQty?: number;
  remaining?: number;
  stockedQty?: number;
};

/**
 * 미니바 입력 라인을 lib/checkout의 MinibarLineInput(consumedQty 확정)으로 정규화한다.
 *   - remaining(남은 수량)이 오면: par를 서버에서 조회(VillaMinibarStock.qty ?? MinibarItem.stockQty)해
 *     consumedQty = computeConsumptionFromRemaining(par, remaining)로 역산(클라 par 신뢰 금지).
 *   - remaining이 없으면: 기존 consumedQty를 그대로 사용(하위 호환).
 *   - consumedQty ≤ 0 라인은 제외(소비 없음). 알 수 없는 itemId는 lib/checkout 트랜잭션에서 거부.
 *   stockedQty 스냅샷은 remaining 입력 시 par(비치목표)로 채운다(없으면 0).
 */
async function normalizeMinibarLines(
  bookingId: string,
  lines: RawMinibarLine[] | undefined
): Promise<MinibarLineInput[]> {
  if (!lines || lines.length === 0) return [];

  // remaining 변환이 필요한 경우에만 par를 조회한다(없으면 DB 조회 생략 — consumed 직접 경로).
  const needsPar = lines.some((l) => l.remaining != null);
  let parMap = new Map<string, number>();
  if (needsPar) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { villaId: true },
    });
    const villaId = booking?.villaId;
    const itemIds = [...new Set(lines.map((l) => l.minibarItemId))];
    const [items, overrides] = await Promise.all([
      prisma.minibarItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, stockQty: true },
      }),
      villaId
        ? prisma.villaMinibarStock.findMany({
            where: { villaId, minibarItemId: { in: itemIds } },
            select: { minibarItemId: true, qty: true },
          })
        : Promise.resolve([] as { minibarItemId: string; qty: number }[]),
    ]);
    const stdStock = new Map(items.map((i) => [i.id, i.stockQty]));
    const ovr = new Map(overrides.map((o) => [o.minibarItemId, o.qty]));
    parMap = new Map(
      itemIds.map((iid) => [iid, effectivePar(ovr.get(iid) ?? null, stdStock.get(iid) ?? 0)])
    );
  }

  const out: MinibarLineInput[] = [];
  for (const l of lines) {
    let consumedQty: number;
    let stockedQty: number;
    if (l.remaining != null) {
      const par = parMap.get(l.minibarItemId) ?? 0;
      // computeConsumptionFromRemaining: remaining≥par→0, 음수→throw(zod min(0)로 1차 차단)
      consumedQty = computeConsumptionFromRemaining(par, l.remaining);
      stockedQty = par;
    } else {
      consumedQty = l.consumedQty ?? 0;
      stockedQty = l.stockedQty ?? 0;
    }
    if (consumedQty > 0) {
      out.push({ minibarItemId: l.minibarItemId, consumedQty, stockedQty });
    }
  }
  return out;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

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
    // ── 미니바 라인 정규화: remaining(남은 수량) → consumedQty(소비 수량) 서버 역산 ──────
    //   "남은 수량" 입력 UX. par(비치목표)는 서버가 VillaMinibarStock(빌라 오버라이드) ?? MinibarItem.stockQty로
    //   정확히 조회해 consumedQty=computeConsumptionFromRemaining(par, remaining)로 환산(클라 신뢰 금지).
    //   remaining 필드가 없으면 기존 consumedQty를 그대로 사용(하위 호환). 가격·차감은 lib/checkout이 재계산.
    const minibarLines = await normalizeMinibarLines(id, parsed.data.minibarLines);

    const result = await completeCheckout(prisma, {
      bookingId: id,
      photoUrls: parsed.data.photoUrls,
      damageFound: parsed.data.damageFound,
      damageNote: parsed.data.damageNote,
      damagePhotoUrls: parsed.data.damagePhotoUrls,
      deductionVnd: parsed.data.deductionVnd ? BigInt(parsed.data.deductionVnd) : null,
      minibarLines,
      settlement: parsed.data.settlement ?? null,
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
