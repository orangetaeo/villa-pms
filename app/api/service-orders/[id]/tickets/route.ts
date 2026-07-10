// /api/service-orders/[id]/tickets — 관리자 대리 티켓 발행/삭제 (ADR-0034)
//   벤더가 Zalo로 보내온 QR 티켓을 운영자가 대신 첨부하는 관행 지원.
//   POST/DELETE 모두 isOperator 가드. 벤더 발행 API와 동일 검증·저장·상한(30장).
//   ★발주 상태 전이 없음 — 단순 첨부(수락 겸행 아님). ticketsIssuedAt만 최초 기록.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { saveTicketFiles } from "@/lib/ticket-upload";

const uploadErrorStatus: Record<string, number> = {
  NO_FILES: 400,
  INVALID_TYPE: 400,
  FILE_TOO_LARGE: 400,
  TOO_MANY_TICKETS: 400,
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;
  const { id } = await params;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, ticketUrls: true, ticketsIssuedAt: true },
  });
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (order.type !== "TICKET") {
    return NextResponse.json({ error: "NOT_TICKET_ORDER" }, { status: 400 });
  }
  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    return NextResponse.json({ error: "ORDER_CLOSED", status: order.status }, { status: 409 });
  }

  const saved = await saveTicketFiles(formData, order.ticketUrls.length, actorId);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: uploadErrorStatus[saved.error] ?? 400 });
  }

  const now = new Date();
  const newUrls = [...order.ticketUrls, ...saved.urls];
  // 상태 전이 없음 — ticketUrls append + ticketsIssuedAt(최초)만. 동시성: status 종결 가드.
  const data: Prisma.ServiceOrderUpdateManyMutationInput = {
    ticketUrls: newUrls,
    ...(order.ticketsIssuedAt ? {} : { ticketsIssuedAt: now }),
  };
  const updated = await prisma.serviceOrder.updateMany({
    where: { id, status: { notIn: ["CANCELLED", "DELIVERED"] } },
    data,
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      ticketsAdded: { new: saved.urls.length },
      ticketUrls: { old: order.ticketUrls.length, new: newUrls.length },
      proxyUpload: { new: true }, // 운영자 대리 발행 표시
      ...(order.ticketsIssuedAt ? {} : { ticketsIssuedAt: { new: now.toISOString() } }),
    },
  });

  return NextResponse.json({ id, ticketUrls: newUrls });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;
  const { id } = await params;

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url : null;
  if (!url) return NextResponse.json({ error: "URL_REQUIRED" }, { status: 400 });

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, ticketUrls: true },
  });
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (order.type !== "TICKET") {
    return NextResponse.json({ error: "NOT_TICKET_ORDER" }, { status: 400 });
  }
  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    return NextResponse.json({ error: "ORDER_CLOSED", status: order.status }, { status: 409 });
  }
  if (!order.ticketUrls.includes(url)) {
    return NextResponse.json({ error: "TICKET_NOT_FOUND" }, { status: 404 });
  }

  const newUrls = order.ticketUrls.filter((u) => u !== url);
  const updated = await prisma.serviceOrder.updateMany({
    where: { id, ticketUrls: { has: url }, status: { notIn: ["CANCELLED", "DELIVERED"] } },
    data: { ticketUrls: newUrls },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: { ticketRemoved: { old: url }, ticketUrls: { old: order.ticketUrls.length, new: newUrls.length }, proxyUpload: { new: true } },
  });

  return NextResponse.json({ id, ticketUrls: newUrls });
}
