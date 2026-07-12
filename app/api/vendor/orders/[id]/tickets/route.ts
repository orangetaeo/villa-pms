// /api/vendor/orders/[id]/tickets — 티켓형 부가서비스(TICKET) QR 티켓 발행 (ADR-0034)
//   POST: Role=VENDOR + 본인 vendorId 스코프(404 은닉). type=TICKET 주문만.
//     multipart(files 다중 이미지) → 검증·저장 → ticketUrls append + ticketsIssuedAt(최초).
//     ★발행=수락 겸행(완료 게이트, ADR-0034 개정): PENDING_VENDOR이고 업로드 반영 후 발행 수량이
//       주문 수량 이상일 때만 VENDOR_ACCEPTED로 원자 전이(updateMany 가드) +
//       (status=REQUESTED면 ADR-0034 §3-4대로 requestedVia 무관 status=CONFIRMED) + 운영자 통보.
//       미달 업로드는 ticketUrls만 추가(PENDING_VENDOR 유지·통보 없음). 부족 발행 수동 수락=respond accept.
//     ★발행=완료(ADR-0034 §3-3): 업로드 반영 후 수량 충족이고 vendorCompletedAt 미기록이면 자동 세팅
//       (수락 전이와 동시든, 이미 수락된 주문의 추가 발행이든 동일). 별도 완료 통보는 없음(수락 통보로 충분).
//   DELETE: body {url} 단건 제거(본인·TICKET·DELIVERED/CANCELLED 전만). 저장 파일 자체는 미삭제.
//     ★삭제 시 수량 미달이 되면 vendorCompletedAt=null로 완료 해제(대칭·정정 구간 오표시 방지). 수락 상태는 유지.
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
      bookingId: true,
      vendorId: true,
      vendorStatus: true,
      ticketUrls: true,
      ticketsIssuedAt: true,
      vendorCompletedAt: true,
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
  // ★발행 완료 게이트(ADR-0034 개정): 발행=수락 겸행은 "업로드 반영 후 발행 수량 ≥ 주문 수량"일 때만.
  //   미달이면 ticketUrls만 추가하고 PENDING_VENDOR 유지(발주함 잔류)·통보 미발송 — 나눠 업로드로
  //   충족되는 시점(마지막 업로드)에 1회 전이+통보. 부족 발행 상태의 수동 수락은 respond accept가 담당.
  const wasPending = order.vendorStatus === "PENDING_VENDOR";
  const meetsQuantity = newUrls.length >= order.quantity;
  const accept = wasPending && meetsQuantity;
  // ★TICKET은 수락 시 requestedVia 무관 자동 확정(ADR-0034 §3-4) — variant 가격이 사전 확정이라
  //   운영자 가격 검토 단계가 무의미. 이 라우트는 TICKET 전용(위 가드)이므로 주체와 무관하게,
  //   수락 전이가 실제로 일어나고(accept) status=REQUESTED일 때만 CONFIRMED 겸행.
  const autoConfirm = accept && order.status === "REQUESTED";
  // ★발행=완료(ADR-0034 §3-3): 업로드 반영 후 수량 충족이고 아직 완료 미기록이면 vendorCompletedAt 자동 세팅.
  //   수락 전이(accept)와 동시 발동(신규 수락)이든, 이미 VENDOR_ACCEPTED인 주문의 추가 발행으로
  //   충족되는 케이스든 동일 — 전이 여부와 무관하게 완료 필드만 조건부로 추가한다(상태 불변 경로에도 적용).
  //   별도 완료 통보는 없음(accept 통보로 충분·이중 알림 방지). 스냅샷이 이미 완료면 재기록 안 함(멱등).
  const autoComplete = meetsQuantity && order.vendorCompletedAt === null;

  // ★동시성 가드 — 읽은 스냅샷(vendorStatus·status) 위에서만 반영. count===0 → 409(저장 파일 orphan 허용:
  //   DB 미기록이라 노출 URL 없음). autoConfirm은 where에 status=REQUESTED도 넣어 운영자 동시 취소 레이스 차단.
  //   미달 업로드(accept=false)는 vendorStatus 가드 없이 ticketUrls만 append.
  const where: Prisma.ServiceOrderWhereInput = {
    id,
    vendorId,
    status: { notIn: ["CANCELLED", "DELIVERED"] },
    ...(accept ? { vendorStatus: "PENDING_VENDOR" } : {}),
    ...(autoConfirm ? { status: "REQUESTED" } : {}),
  };
  const data: Prisma.ServiceOrderUpdateManyMutationInput = {
    ticketUrls: newUrls,
    ...(order.ticketsIssuedAt ? {} : { ticketsIssuedAt: now }),
    ...(accept ? { vendorStatus: "VENDOR_ACCEPTED", vendorRespondedAt: now } : {}),
    ...(autoConfirm ? { status: "CONFIRMED" } : {}),
    ...(autoComplete ? { vendorCompletedAt: now } : {}),
  };
  const updated = await prisma.serviceOrder.updateMany({ where, data });
  if (updated.count === 0) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  const newVendorStatus = accept ? "VENDOR_ACCEPTED" : order.vendorStatus;
  const newStatus = autoConfirm ? "CONFIRMED" : order.status;
  const newVendorCompletedAt = autoComplete ? now : order.vendorCompletedAt;

  // 수락 겸행 시 운영자 통보(respond accept와 동일 — 공용 헬퍼). 단순 추가발행·미달 업로드면 통보 없음.
  if (accept) {
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
      ...(accept
        ? { vendorStatus: { old: order.vendorStatus, new: "VENDOR_ACCEPTED" }, vendorRespondedAt: { new: now.toISOString() } }
        : {}),
      ...(autoConfirm ? { status: { old: "REQUESTED", new: "CONFIRMED" } } : {}),
      ...(autoComplete ? { vendorCompletedAt: { old: null, new: now.toISOString() } } : {}),
    },
  });

  return NextResponse.json({
    id,
    ticketUrls: newUrls,
    vendorStatus: newVendorStatus,
    status: newStatus,
    vendorCompletedAt: newVendorCompletedAt,
  });
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
    select: {
      id: true,
      type: true,
      status: true,
      vendorId: true,
      ticketUrls: true,
      quantity: true,
      vendorCompletedAt: true,
    },
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
  // ★삭제=완료 해제(ADR-0034 §3-3 대칭): 삭제로 발행 수량이 주문 수량 미만이 되고 이미 완료 기록이
  //   있으면 vendorCompletedAt=null로 해제(정정 구간 동안 "완료" 오표시 방지). 수락 상태는 유지(un-accept 없음).
  //   여전히 충족(초과분 삭제)이거나 애초에 미완료면 완료 필드는 건드리지 않는다.
  const clearComplete = newUrls.length < order.quantity && order.vendorCompletedAt !== null;
  // 동시성 가드 — 삭제 대상 url이 아직 목록에 있을 때만(has). 저장 파일 자체는 미삭제.
  const updated = await prisma.serviceOrder.updateMany({
    where: { id, vendorId, ticketUrls: { has: url }, status: { notIn: ["CANCELLED", "DELIVERED"] } },
    data: { ticketUrls: newUrls, ...(clearComplete ? { vendorCompletedAt: null } : {}) },
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
      ticketRemoved: { old: url },
      ticketUrls: { old: order.ticketUrls.length, new: newUrls.length },
      ...(clearComplete
        ? { vendorCompletedAt: { old: order.vendorCompletedAt?.toISOString() ?? null, new: null } }
        : {}),
    },
  });

  return NextResponse.json({
    id,
    ticketUrls: newUrls,
    vendorCompletedAt: clearComplete ? null : order.vendorCompletedAt,
  });
}
