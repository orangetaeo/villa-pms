// /api/vendor/orders/[id]/respond — 원천 공급자 발주 가부 응답 (ADR-0023 S2 §4.3)
//   POST: Role=VENDOR + 본인 vendorId 스코프(서버 강제). PENDING_VENDOR만 응답 가능.
//   accept→VENDOR_ACCEPTED, 거절→VENDOR_REJECTED(+사유). 응답 후 운영자(테오)에게 Zalo 통지.
//   ★ 누수: 타 공급자 발주 접근 차단(vendorId 불일치 시 404). 응답에 판매가·마진 없음.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isVendor, OPERATOR_ROLES, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { assertVendorResponse, InvalidVendorResponseError } from "@/lib/vendor-order";
import { enqueueNotification } from "@/lib/zalo";
import { NotificationType } from "@prisma/client";

const respondSchema = z.object({
  accept: z.boolean(),
  rejectReason: z.string().max(300).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = session.user.id;
  const { id } = await params;

  const vendorId = await getVendorIdForUser(actorId);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { accept, rejectReason } = parsed.data;

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      vendorId: true,
      vendorStatus: true,
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
  // ★종결 가드 — 운영자가 이미 취소(CANCELLED)한 발주는 가부 불가. vendorStatus가 PENDING_VENDOR로
  //   남아 있어도 주문이 취소됐으면 공급자는 응답할 수 없음(취소 통보 Zalo가 별도로 발송됨).
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "ORDER_CANCELLED" }, { status: 409 });
  }

  // 카탈로그 항목명(운영자 통지 ko용) — catalogItemId는 관계 미정의 스칼라이므로 별도 조회.
  const item = order.catalogItemId
    ? await prisma.serviceCatalogItem.findUnique({
        where: { id: order.catalogItemId },
        select: { nameKo: true },
      })
    : null;
  const itemName = item?.nameKo ?? order.vendorName ?? "—";

  try {
    assertVendorResponse(order.vendorStatus);
  } catch (e) {
    if (e instanceof InvalidVendorResponseError) {
      return NextResponse.json(
        { error: "NOT_PENDING", vendorStatus: order.vendorStatus },
        { status: 409 }
      );
    }
    throw e;
  }

  const now = new Date();
  const newStatus = accept ? "VENDOR_ACCEPTED" : "VENDOR_REJECTED";
  await prisma.serviceOrder.update({
    where: { id },
    data: {
      vendorStatus: newStatus,
      vendorRespondedAt: now,
      vendorRejectReason: accept ? null : rejectReason?.trim() || null,
    },
  });

  // 운영자(테오)들에게 가부 통지(ko) — zaloUserId 연결된 활성 운영자 전원.
  const operators = await prisma.user.findMany({
    where: {
      role: { in: [...OPERATOR_ROLES] },
      isActive: true,
      zaloUserId: { not: null },
    },
    select: { id: true },
  });
  const payload = {
    vendorName: order.vendor?.nameKo || order.vendor?.name || "—",
    accepted: accept,
    itemName,
    villaName: order.booking?.villa?.name ?? "—",
    rejectReason: accept ? undefined : rejectReason?.trim() || undefined,
  };
  for (const op of operators) {
    await enqueueNotification({
      userId: op.id,
      type: NotificationType.VENDOR_PO_RESPONSE,
      payload,
    });
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      vendorStatus: { old: order.vendorStatus, new: newStatus },
      vendorRespondedAt: { new: now.toISOString() },
      ...(accept ? {} : { vendorRejectReason: { new: rejectReason?.trim() || null } }),
    },
  });

  return NextResponse.json({ id, vendorStatus: newStatus });
}
