// POST /api/g/[token]/service-orders — 게스트 셀프 부가옵션 요청 (ADR-0019 v2)
//   비로그인(토큰). 서버가 카탈로그 기준으로 가격 재계산(클라 금액 신뢰 금지, §9.5) — VND 단일통화.
//   priceVnd 스냅샷 + priceKrw=priceKrwCeil(totalVnd, fx) 스냅샷 저장(현재 환율, 미설정이면 0).
//   상태=REQUESTED, requestedVia=GUEST, costVnd=0(운영자 확정 시 입력). 결제 없음 — 체크아웃 정산.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { parseCatalogOptions, resolveOrderPricing, ServiceSelectionError, parseAudiences } from "@/lib/service-catalog";
import { priceKrwCeil } from "@/lib/service-display";
import { getFxVndPerKrw } from "@/lib/pricing";
import { parseUtcDateOnly } from "@/lib/date-vn";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  catalogItemId: z.string().min(1).max(40),
  variantKey: z.string().max(40).optional().nullable(),
  addonKeys: z.array(z.string().max(40)).max(60).optional(),
  modifierKeys: z.array(z.string().max(40)).max(40).optional(),
  quantity: z.number().int().min(1).max(99),
  serviceDate: z.string().optional().nullable(),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
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

  let serviceDate: Date | null = null;
  if (d.serviceDate != null && d.serviceDate !== "") {
    serviceDate = parseUtcDateOnly(d.serviceDate);
    if (serviceDate === null) {
      return NextResponse.json({ error: "INVALID_SERVICE_DATE" }, { status: 400 });
    }
  }

  const item = await prisma.serviceCatalogItem.findUnique({ where: { id: d.catalogItemId } });
  // 게스트 자격(GUEST) 항목만 주문 가능 — 과일 바구니 등 PARTNER 전용은 차단(ADR-0023 §9.2, id 추측 방지).
  if (!item || !item.active || !parseAudiences(item.audiences).includes("GUEST")) {
    return NextResponse.json({ error: "CATALOG_ITEM_NOT_FOUND" }, { status: 404 });
  }

  let pricing;
  try {
    pricing = resolveOrderPricing(
      { priceVnd: item.priceVnd },
      parseCatalogOptions(item.options),
      { variantKey: d.variantKey, addonKeys: d.addonKeys, modifierKeys: d.modifierKeys, quantity: d.quantity }
    );
  } catch (e) {
    if (e instanceof ServiceSelectionError) {
      return NextResponse.json({ error: "INVALID_SELECTION", code: e.code }, { status: 400 });
    }
    throw e;
  }

  // KRW 스냅샷 — 현재 환율로 VND→KRW 올림(미설정이면 0). VND가 진실원천.
  const fx = await getFxVndPerKrw(prisma);
  const priceKrw = fx ? priceKrwCeil(pricing.totalPriceVnd, fx) : 0;

  const created = await prisma.serviceOrder.create({
    data: {
      bookingId: t.bookingId,
      type: item.type,
      status: "REQUESTED",
      serviceDate,
      serviceTime: d.serviceTime ?? null,
      costVnd: 0n, // 운영자 확정 시 실원가 입력
      priceKrw,
      priceVnd: pricing.totalPriceVnd,
      catalogItemId: item.id,
      vendorId: item.vendorId, // 원천 공급자 스냅샷 — 운영자 발주(dispatch) 대상 (ADR-0023 §4.3)
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
