import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { completeCheckout, CheckoutRejectedError, type MinibarLineInput } from "@/lib/checkout";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { effectivePar, computeConsumptionFromRemaining } from "@/lib/minibar-inventory";
import { getDailyRates } from "@/lib/fx-rates";

/** POST /api/bookings/[id]/checkout — 체크아웃 완료 (ADMIN 전용, SPEC F4) */

const checkoutSchema = z.object({
  // 상태 사진은 정책 변경(2026-07-10)으로 선택 — 파손 시에만 증빙 입력. 신규 폼은 미전송.
  photoUrls: z.array(z.string().min(1)).max(50).optional(),
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
  //   ★ 결제수단 혼합(분할) 지원 (T-checkout-mixed): lines[]로 수단×통화×금액을 받는다.
  //     - method는 lines가 없을 때만 필수(구 shape 하위호환) — refine으로 검증.
  //     - lines·amounts의 method 모두 MIXED 제외(enum에서 자연 거부 — 서버 파생 전용).
  //   amounts(구 shape): 통화별 실수납액. VND는 동 단위 숫자 문자열(BigInt 정밀도), KRW/USD는 정수.
  settlement: z
    .object({
      method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]).optional(),
      note: z.string().trim().max(500).optional().nullable(),
      // 혼합 수납 라인 — amount는 원본 통화 최소단위 숫자 문자열(양수 검증은 lib normalize가 담당, 0은 400).
      lines: z
        .array(
          z.object({
            method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]),
            currency: z.enum(["VND", "KRW", "USD"]),
            amount: z.string().regex(/^\d+$/),
          })
        )
        .max(12)
        .optional()
        .nullable(),
      amounts: z
        .object({
          vnd: z.string().regex(/^\d+$/).optional(),
          krw: z.number().int().min(0).max(100_000_000).optional(),
          usd: z.number().int().min(0).max(100_000).optional(),
        })
        .optional()
        .nullable(),
    })
    // lines가 없으면 method 필수(구 shape 하위호환). lines가 있으면 수단은 라인에서 파생.
    .refine((s) => (s.lines != null && s.lines.length > 0) || s.method != null, {
      message: "lines가 없으면 method가 필요합니다",
      path: ["method"],
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

    // 게스트 수납 — 혼합 라인(lines) 또는 구 shape(amounts+method)을 lib 타입(BigInt)으로 정규화.
    const rawSettlement = parsed.data.settlement ?? null;
    const rawAmounts = rawSettlement?.amounts ?? null;
    const amounts = rawAmounts
      ? {
          vnd: rawAmounts.vnd != null ? BigInt(rawAmounts.vnd) : null,
          krw: rawAmounts.krw ?? null,
          usd: rawAmounts.usd ?? null,
        }
      : null;
    // 혼합 수납 라인 — 숫자 문자열 amount를 BigInt로. 양수·중복 병합·13라인↑ 검증은 lib normalize.
    const lines =
      rawSettlement?.lines && rawSettlement.lines.length > 0
        ? rawSettlement.lines.map((l) => ({
            method: l.method,
            currency: l.currency,
            amount: BigInt(l.amount),
          }))
        : null;
    // 환율 스냅샷 조건 — 라인 합계 > 0 || 구 amounts 양수.
    const hasLineAmount = !!lines && lines.some((l) => l.amount > 0n);
    const hasSettledAmount =
      hasLineAmount ||
      (!!amounts && ((amounts.vnd ?? 0n) > 0n || (amounts.krw ?? 0) > 0 || (amounts.usd ?? 0) > 0));
    // 환율 스냅샷은 서버가 조회(클라 환율 신뢰 금지). 실수납 금액이 있을 때만.
    const rates = hasSettledAmount ? await getDailyRates(prisma) : null;
    const settlementFx = rates
      ? { date: rates.date, vndPerKrw: rates.vndPerUnit.KRW, vndPerUsd: rates.vndPerUnit.USD }
      : null;

    const result = await completeCheckout(prisma, {
      bookingId: id,
      photoUrls: parsed.data.photoUrls,
      damageFound: parsed.data.damageFound,
      damageNote: parsed.data.damageNote,
      damagePhotoUrls: parsed.data.damagePhotoUrls,
      deductionVnd: parsed.data.deductionVnd ? BigInt(parsed.data.deductionVnd) : null,
      minibarLines,
      settlement: rawSettlement
        ? { method: rawSettlement.method ?? null, note: rawSettlement.note, lines, amounts }
        : null,
      settlementFx,
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
