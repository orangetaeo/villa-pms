// /api/vendor/orders/[id]/complete — 원천 공급자 서비스 이행 완료 보고 (vendor-gaps-p1 계약 C)
//   POST: Role=VENDOR + 본인 vendorId 스코프(서버 강제). VENDOR_ACCEPTED·미취소·미보고 건만.
//   vendorCompletedAt=now 기록 후 운영자(테오)에게 Zalo 통지(VENDOR_PO_RESPONSE action="complete").
//   ★ 멱등·동시성: updateMany where {vendorCompletedAt:null} — 이미 보고된 건 재보고 0건→409.
//   ★ 누수: 타 공급자 발주 접근 차단(vendorId 불일치 시 404). 응답·통지에 판매가·마진 없음.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isVendor, OPERATOR_ROLES, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { canReportComplete } from "@/lib/vendor-order";
import { enqueueNotification } from "@/lib/zalo";
import { NotificationType } from "@prisma/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = session.user.id;
  const { id } = await params;

  const vendorId = await getVendorIdForUser(actorId);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      vendorId: true,
      vendorStatus: true,
      vendorCompletedAt: true,
      catalogItemId: true,
      vendorName: true,
      vendor: { select: { name: true, nameKo: true } },
      booking: { select: { villa: { select: { name: true } } } },
    },
  });
  // ★ 본인 발주가 아니면 존재 자체를 숨김(404) — 타 공급자 발주 누수 차단
  if (!order || order.vendorId !== vendorId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!canReportComplete(order)) {
    return NextResponse.json(
      {
        error: order.vendorCompletedAt ? "ALREADY_COMPLETED" : "NOT_COMPLETABLE",
        vendorStatus: order.vendorStatus,
        status: order.status,
      },
      { status: 409 }
    );
  }

  const now = new Date();
  // ★동시성 가드 — 미보고(null)·수락 유지·미취소 행만 갱신(RMW: 조회~갱신 사이 취소 레이스 차단). 0건→409.
  const res = await prisma.serviceOrder.updateMany({
    where: {
      id,
      vendorId,
      vendorCompletedAt: null,
      vendorStatus: "VENDOR_ACCEPTED",
      status: { not: "CANCELLED" },
    },
    data: { vendorCompletedAt: now },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }

  // 카탈로그 항목명(운영자 통지 ko용) — catalogItemId는 관계 미정의 스칼라이므로 별도 조회.
  const item = order.catalogItemId
    ? await prisma.serviceCatalogItem.findUnique({
        where: { id: order.catalogItemId },
        select: { nameKo: true },
      })
    : null;
  const itemName = item?.nameKo ?? order.vendorName ?? "—";

  // 운영자(테오)들에게 완료 통지(ko) — respond 라우트와 동일 수신자 규칙.
  const operators = await prisma.user.findMany({
    where: { role: { in: [...OPERATOR_ROLES] }, isActive: true, zaloUserId: { not: null } },
    select: { id: true },
  });
  for (const op of operators) {
    await enqueueNotification({
      userId: op.id,
      type: NotificationType.VENDOR_PO_RESPONSE,
      payload: {
        action: "complete",
        vendorName: order.vendor?.nameKo || order.vendor?.name || "—",
        itemName,
        villaName: order.booking?.villa?.name ?? "—",
      },
    });
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: { vendorCompletedAt: { new: now.toISOString() } },
  });

  return NextResponse.json({ id, vendorCompletedAt: now.toISOString() });
}
