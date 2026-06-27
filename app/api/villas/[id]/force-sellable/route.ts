// POST /api/villas/[id]/force-sellable — ADMIN 강제 판매가능 처리 (ADR-0012)
// 검수 게이트 오버라이드: 직접 온보딩 모델에서 ADMIN이 검수를 생략하고
// 빌라를 isSellable=true로 강제 전환한다. 전량 감사 로그로 정당화.
// 게이트 단일 setter(approveCleaningTask)와 독립된 별도 경로 — lib/villa-gate.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { forceOpenSellableGate, VillaGateError } from "@/lib/villa-gate";
import { canOverrideGate } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const bodySchema = z.object({
  // 선택이지만 권장 — 없으면 기본 사유. trim 후 최대 500.
  reason: z.string().trim().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙). 차단 시 DB 미접근.
  const g = await requireCapability(canOverrideGate, "canOverrideGate", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;

  // body 선택 — 없거나 비JSON이면 기본 사유로 진행
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const reason = parsed.data.reason && parsed.data.reason.length > 0
    ? parsed.data.reason
    : "관리자 강제 승인";

  try {
    const result = await forceOpenSellableGate(prisma, {
      villaId: id,
      actorUserId: session.user.id,
      reason,
    });

    // 응답에 마진·판매가(KRW)·원가 미포함 (사업 핵심 원칙 2)
    return NextResponse.json({
      id: result.villaId,
      isSellable: true,
      gateAlreadyOpen: result.gateAlreadyOpen,
      resolvedTaskCount: result.resolvedTaskCount,
      openCheckoutWarning: result.openCheckoutWarning,
    });
  } catch (err) {
    if (err instanceof VillaGateError) {
      if (err.kind === "NOT_FOUND") {
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      }
      // INVALID_STATUS — 비ACTIVE 빌라
      return NextResponse.json(
        { error: "INVALID_STATUS", current: err.current },
        { status: 409 }
      );
    }
    throw err;
  }
}
