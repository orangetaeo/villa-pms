// POST /api/g/[token]/service-orders — 게스트 셀프 부가옵션 요청 (ADR-0019 S3)
//   비로그인(토큰). 서버가 카탈로그 기준으로 가격 재계산(클라 금액 신뢰 금지, §9.5).
//   상태=REQUESTED, requestedVia=GUEST, costVnd=0(운영자 확정 시 입력). 결제 없음 — 체크아웃 정산.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { parseCatalogOptions, resolveOrderPricing, ServiceSelectionError } from "@/lib/service-catalog";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  catalogItemId: z.string().min(1).max(40),
  variantKey: z.string().max(40).optional().nullable(),
  addonKeys: z.array(z.string().max(40)).max(60).optional(),
  modifierKeys: z.array(z.string().max(40)).max(40).optional(),
  quantity: z.number().int().min(1).max(99),
  guestNote: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true, firstUsedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const item = await prisma.serviceCatalogItem.findUnique({ where: { id: d.catalogItemId } });
  if (!item || !item.active) {
    return NextResponse.json({ error: "CATALOG_ITEM_NOT_FOUND" }, { status: 404 });
  }

  let pricing;
  try {
    pricing = resolveOrderPricing(
      { priceKrw: item.priceKrw, priceVnd: item.priceVnd },
      parseCatalogOptions(item.options),
      { variantKey: d.variantKey, addonKeys: d.addonKeys, modifierKeys: d.modifierKeys, quantity: d.quantity }
    );
  } catch (e) {
    if (e instanceof ServiceSelectionError) {
      return NextResponse.json({ error: "INVALID_SELECTION", code: e.code }, { status: 400 });
    }
    throw e;
  }

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: t.bookingId,
      type: item.type,
      status: "REQUESTED",
      costVnd: 0n, // 운영자 확정 시 실원가 입력
      priceKrw: pricing.totalPriceKrw ?? 0,
      priceVnd: pricing.totalPriceVnd,
      catalogItemId: item.id,
      quantity: pricing.quantity,
      selectedOptions: pricing.snapshot as unknown as Prisma.InputJsonValue,
      requestedVia: "GUEST",
      guestNote: d.guestNote ?? null,
    },
    select: { id: true },
  });

  if (t.firstUsedAt == null) {
    await prisma.guestCheckinToken.update({ where: { token }, data: { firstUsedAt: new Date() } });
  }

  await writeAuditLog({
    db: prisma,
    userId: null,
    action: "CREATE",
    entity: "ServiceOrder",
    entityId: created.id,
    changes: { requestedVia: { new: "GUEST" }, catalogItemId: { new: item.id } },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
