// /api/vendor/orders/[id]/tickets — 티켓형 부가서비스(TICKET) QR 티켓 발행 (ADR-0034)
//   POST: Role=VENDOR + 본인 vendorId 스코프(404 은닉). type=TICKET 주문만.
//     multipart(files 다중 이미지) → 검증·저장 → ticketUrls append + ticketsIssuedAt(최초).
//     ★발행=수락 겸행: PENDING_VENDOR였으면 VENDOR_ACCEPTED로 원자 전이(updateMany 가드) +
//       (requestedVia=GUEST·REQUESTED면 ADR-0033 규칙대로 status=CONFIRMED) + 운영자 통보.
//   DELETE: body {url} 단건 제거(본인·TICKET·DELIVERED/CANCELLED 전만). 저장 파일 자체는 미삭제.
//   ★ 누수: 타 공급자 발주 404. 응답에 판매가·마진·costVnd 없음.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { saveTicketFiles } from "@/lib/ticket-upload";
import { sendVendorResponseOperatorNotifications } from "@/lib/vendor-dispatch";

const uploadErrorStatus: Record<string, number> = {
  NO_FILES: 400,
  INVALID_TYPE: 400,
  FILE_TOO_LARGE: 400,
  TOO_MANY_TICKETS: 400,
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const role = g.session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = g.session.user.id;
  const { id } = await params;

  const vendorId = await getVendorIdForUser(actorId);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      requestedVia: true,
      bookingId: true,
      vendorId: true,
      vendorStatus: true,
      ticketUrls: true,
      ticketsIssuedAt: true,
      catalogItemId: true,
      vendorName: true,
      serviceDate: true,
      serviceTime: true,
      quantity: true,
      costVnd: true,
      vendor: { select: { name: true, nameKo: true } },
      booking: { select: { villa: { select: { name: true } } } },
    },
  });
  // ★ 본인 발주가 아니면 존재 자체를 숨김(404) — 타 공급자 발주 누수 차단
  if (!order || order.vendorId !== vendorId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (order.type !== "TICKET") {
    return NextResponse.json({ error: "NOT_TICKET_ORDER" }, { status: 400 });
  }
  // 종결 발주(취소·이행완료)엔 추가 발행 불가.
  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    return NextResponse.json({ error: "ORDER_CLOSED", status: order.status }, { status: 409 });
  }
  // ★거절한 발주에도 발행 불가(QA P3) — 거절 후 마음이 바뀌면 운영자 재발주(발주 사이클 리셋)가 정로.
  //   status 축만 보면 REJECTED가 열려 "거절한 주문에 산출물 첨부" 의미 불일치가 생긴다(두 축 짝검토).
  if (order.vendorStatus === "VENDOR_REJECTED") {
    return NextResponse.json({ error: "ORDER_REJECTED" }, { status: 409 });
  }

  // 이미지 검증·저장(합계 30장 상한). 실패면 400(코드별). 저장은 검증 전량 통과 후에만.
  const saved = await saveTicketFiles(formData, order.ticketUrls.length, actorId);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: uploadErrorStatus[saved.error] ?? 400 });
  }

  const now = new Date();
  const newUrls = [...order.ticketUrls, ...saved.urls];
  // 발행=수락 겸행: PENDING_VENDOR였을 때만 VENDOR_ACCEPTED 전이. 게스트 직접 발주(REQUESTED)면 CONFIRMED도.
  const wasPending = order.vendorStatus === "PENDING_VENDOR";
  const autoConfirm =
    wasPending && order.requestedVia === "GUEST" && order.status === "REQUESTED";

  // ★동시성 가드 — 읽은 스냅샷(vendorStatus·status) 위에서만 반영. count===0 → 409(저장 파일 orphan 허용:
  //   DB 미기록이라 노출 URL 없음). autoConfirm은 where에 status=REQUESTED도 넣어 운영자 동시 취소 레이스 차단.
  const where: Prisma.ServiceOrderWhereInput = {
    id,
    vendorId,
    status: { notIn: ["CANCELLED", "DELIVERED"] },
    ...(wasPending ? { vendorStatus: "PENDING_VENDOR" } : {}),
    ...(autoConfirm ? { status: "REQUESTED" } : {}),
  };
  const data: Prisma.ServiceOrderUpdateManyMutationInput = {
    ticketUrls: newUrls,
    ...(order.ticketsIssuedAt ? {} : { ticketsIssuedAt: now }),
    ...(wasPending ? { vendorStatus: "VENDOR_ACCEPTED", vendorRespondedAt: now } : {}),
    ...(autoConfirm ? { status: "CONFIRMED" } : {}),
  };
  const updated = await prisma.serviceOrder.updateMany({ where, data });
  if (updated.count === 0) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  const newVendorStatus = wasPending ? "VENDOR_ACCEPTED" : order.vendorStatus;
  const newStatus = autoConfirm ? "CONFIRMED" : order.status;

  // 수락 겸행 시 운영자 통보(respond accept와 동일 — 공용 헬퍼). 단순 추가발행이면 통보 없음.
  if (wasPending) {
    const item = order.catalogItemId
      ? await prisma.serviceCatalogItem.findUnique({
          where: { id: order.catalogItemId },
          select: { nameKo: true },
        })
      : null;
    const itemName = item?.nameKo ?? order.vendorName ?? "—";
    await sendVendorResponseOperatorNotifications({
      action: "accept",
      vendorNameKo: order.vendor?.nameKo ?? null,
      vendorName: order.vendor?.name ?? null,
      itemName,
      villaName: order.booking?.villa?.name ?? null,
      bookingId: order.bookingId,
      serviceDate: order.serviceDate,
      serviceTime: order.serviceTime,
      quantity: order.quantity,
      costVnd: order.costVnd,
    });
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
      ...(order.ticketsIssuedAt ? {} : { ticketsIssuedAt: { new: now.toISOString() } }),
      ...(wasPending
        ? { vendorStatus: { old: order.vendorStatus, new: "VENDOR_ACCEPTED" }, vendorRespondedAt: { new: now.toISOString() } }
        : {}),
      ...(autoConfirm ? { status: { old: "REQUESTED", new: "CONFIRMED" } } : {}),
    },
  });

  return NextResponse.json({ id, ticketUrls: newUrls, vendorStatus: newVendorStatus, status: newStatus });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const role = g.session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = g.session.user.id;
  const { id } = await params;

  const vendorId = await getVendorIdForUser(actorId);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

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
    select: { id: true, type: true, status: true, vendorId: true, ticketUrls: true },
  });
  if (!order || order.vendorId !== vendorId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (order.type !== "TICKET") {
    return NextResponse.json({ error: "NOT_TICKET_ORDER" }, { status: 400 });
  }
  // 이행완료·취소된 발주의 티켓은 삭제 불가(증빙 고정).
  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    return NextResponse.json({ error: "ORDER_CLOSED", status: order.status }, { status: 409 });
  }
  if (!order.ticketUrls.includes(url)) {
    return NextResponse.json({ error: "TICKET_NOT_FOUND" }, { status: 404 });
  }

  const newUrls = order.ticketUrls.filter((u) => u !== url);
  // 동시성 가드 — 삭제 대상 url이 아직 목록에 있을 때만(has). 저장 파일 자체는 미삭제.
  const updated = await prisma.serviceOrder.updateMany({
    where: { id, vendorId, ticketUrls: { has: url }, status: { notIn: ["CANCELLED", "DELIVERED"] } },
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
    changes: { ticketRemoved: { old: url }, ticketUrls: { old: order.ticketUrls.length, new: newUrls.length } },
  });

  return NextResponse.json({ id, ticketUrls: newUrls });
}
