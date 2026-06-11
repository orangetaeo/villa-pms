import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createHoldFromProposalItem, HoldRejectedError } from "@/lib/hold";
import { MissingRateError } from "@/lib/pricing";

/**
 * POST /api/p/[token]/hold — 공개 가예약 생성 (비로그인, SPEC F3 흐름 3)
 *
 * T2.3 QA 이관 이행:
 * - 거부 사유는 "expired"/"closed" 2종으로만 축약 — HoldRejectedError의 내부
 *   reasons(검수 게이트 NOT_SELLABLE 등)는 공개 응답에 절대 미노출
 * - MissingRateError는 500이 아닌 "closed"로 처리
 */

const bodySchema = z.object({
  itemId: z.string().min(1),
  guestName: z.string().trim().min(1).max(100),
  guestPhone: z.string().trim().regex(/^[0-9+\-\s]{9,20}$/),
  guestCount: z.number().int().min(1).max(16),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // 교차 토큰 차단 — itemId가 이 token의 제안 소속인지 확인
  const item = await prisma.proposalItem.findUnique({
    where: { id: parsed.data.itemId },
    select: { id: true, proposal: { select: { token: true } } },
  });
  if (!item || item.proposal.token !== token) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const booking = await createHoldFromProposalItem(prisma, {
      proposalItemId: item.id,
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      guestPhone: parsed.data.guestPhone,
      now: new Date(),
    });
    return Response.json({ bookingId: booking.id }, { status: 201 });
  } catch (e) {
    if (e instanceof HoldRejectedError) {
      // 만료 계열 → expired, 그 외(마감·중복·재고 소실) → closed — 내부 사유 미노출
      const publicReason =
        e.reason === "PROPOSAL_EXPIRED" || e.reason === "HOLD_EXPIRED" ? "expired" : "closed";
      return Response.json({ error: publicReason }, { status: 409 });
    }
    if (e instanceof MissingRateError) {
      return Response.json({ error: "closed" }, { status: 409 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input" }, { status: 400 });
    }
    console.error("[p/hold] 가예약 생성 실패", e);
    return Response.json({ error: "신청 처리에 실패했습니다" }, { status: 500 });
  }
}
