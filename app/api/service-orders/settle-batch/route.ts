// /api/service-orders/settle-batch — 공급자별 묶음 입금(정산) 처리 (ADR-0023 §4.4 확장)
//   POST: canViewFinance 전용. orderIds[]를 한 번에 정산완료 처리(수단·메모 공통 적용).
//   각 건은 VENDOR_ACCEPTED + 미정산 + 미취소만 대상(그 외 id는 조용히 스킵 — stale 방지).
//   건별 PATCH /api/service-orders/[id] (markSettled)를 반복 호출하는 대신 원자적 updateMany 1회로
//   처리하고, 감사로그·인앱알림은 건별로 남긴다(추적성·공급자 통보 유지).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueInAppNotification, buildVendorNotifText } from "@/lib/inapp-notification";

const schema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(200),
  vendorSettleMethod: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]).optional(),
  vendorSettleNote: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const actorId = g.session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const method = d.vendorSettleMethod ?? null;
  const note = d.vendorSettleNote?.trim() || null;

  // 정산 가능 상태만 후보로 조회(수락·미정산·미취소). 그 외 id는 무시(stale·중복 클릭 방지).
  const candidates = await prisma.serviceOrder.findMany({
    where: {
      id: { in: d.orderIds },
      vendorStatus: "VENDOR_ACCEPTED",
      vendorSettledAt: null,
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      quantity: true,
      catalogItemId: true,
      vendorName: true,
      costVnd: true, // 정산 통보용 — 공급자 본인 지급액(우리 판매가·마진 아님)
      vendor: { select: { userId: true } },
      booking: { select: { villa: { select: { name: true } } } },
    },
  });
  if (candidates.length === 0) return NextResponse.json({ settled: 0 });

  const now = new Date();
  const ids = candidates.map((c) => c.id);
  // 원자적 묶음 정산 — vendorSettledAt: null 재확인으로 동시 정산 경쟁(RMW) 차단.
  await prisma.serviceOrder.updateMany({
    where: { id: { in: ids }, vendorSettledAt: null },
    data: { vendorSettledAt: now, vendorSettleMethod: method, vendorSettleNote: note },
  });

  // 카탈로그 항목명(인앱 알림 vi 본문용) — 일괄 조회 후 매핑.
  const itemIds = Array.from(
    new Set(candidates.map((c) => c.catalogItemId).filter((v): v is string => !!v))
  );
  const items = itemIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true },
      })
    : [];
  const nameById = new Map(items.map((i) => [i.id, i.nameKo]));

  // 감사로그 + 공급자 인앱 알림(건별). 알림 실패는 정산 결과에 영향 주지 않음(try/catch 격리).
  for (const c of candidates) {
    await writeAuditLog({
      db: prisma,
      userId: actorId,
      action: "UPDATE",
      entity: "ServiceOrder",
      entityId: c.id,
      changes: {
        vendorSettledAt: { new: now.toISOString() },
        vendorSettleMethod: { new: method },
        batchSettle: { new: true },
      },
    });
    const vendorUserId = c.vendor?.userId;
    if (vendorUserId) {
      try {
        const itemName = (c.catalogItemId ? nameById.get(c.catalogItemId) : null) ?? c.vendorName ?? "—";
        const { title, body: notifBody } = buildVendorNotifText("VENDOR_SETTLED", {
          itemName,
          quantity: c.quantity,
          villaName: c.booking?.villa?.name ?? "—",
          costVnd: c.costVnd.toString(),
        });
        await enqueueInAppNotification({
          userId: vendorUserId,
          type: "VENDOR_SETTLED",
          title,
          body: notifBody,
          href: "/vendor",
        });
      } catch {
        // 무시 — 본 정산 로직 영향 0
      }
    }
  }

  return NextResponse.json({ settled: candidates.length });
}
