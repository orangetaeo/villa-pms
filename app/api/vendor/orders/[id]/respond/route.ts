// /api/vendor/orders/[id]/respond — 원천 공급자 발주 가부 응답 (ADR-0023 S2 §4.3 · ADR-0033 자동 확정)
//   POST: Role=VENDOR + 본인 vendorId 스코프(서버 강제). PENDING_VENDOR만 응답 가능.
//   action=accept→VENDOR_ACCEPTED, reject→VENDOR_REJECTED(+사유),
//   propose→VENDOR_ACCEPTED(수락하되 대안 시간 제안: proposedServiceDate/Time·메모 기록).
//   ★게스트 직접 발주 자동 확정(테오 지시): accept + requestedVia=GUEST + status=REQUESTED이면 같은
//     updateMany에서 status=CONFIRMED로 원자 전이(운영자 개입 0, 소비자↔벤더 직접). where에도 status=REQUESTED를
//     넣어 운영자 동시 취소 레이스 차단. 파트너/운영자 발주(requestedVia≠GUEST)는 현행 유지(REQUESTED 잔류).
//   응답 후 운영자(테오)에게 Zalo 통지. propose는 운영자가 적용/무시해야 고객확정 가능(미해결 게이트).
//   ★ 누수: 타 공급자 발주 접근 차단(vendorId 불일치 시 404). 응답에 판매가·마진 없음.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { assertVendorResponse, InvalidVendorResponseError } from "@/lib/vendor-order";
import { sendVendorResponseOperatorNotifications } from "@/lib/vendor-dispatch";
import { parseUtcDateOnly } from "@/lib/date-vn";

const respondSchema = z.object({
  action: z.enum(["accept", "reject", "propose"]),
  rejectReason: z.string().max(300).optional().nullable(),
  // propose 전용 — 대안 날짜/시각/메모. 날짜는 실존성까지 parseUtcDateOnly로 재검증.
  proposedServiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  proposedServiceTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .nullable(),
  proposalNote: z.string().max(500).optional().nullable(),
});

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
  const { action, rejectReason, proposedServiceDate, proposedServiceTime, proposalNote } =
    parsed.data;

  // propose면 대안 날짜 필수·실존 검증(@db.Date — UTC 자정으로 정규화). 시각은 선택.
  let proposedDate: Date | null = null;
  if (action === "propose") {
    if (!proposedServiceDate) {
      return NextResponse.json({ error: "PROPOSAL_DATE_REQUIRED" }, { status: 400 });
    }
    proposedDate = parseUtcDateOnly(proposedServiceDate);
    if (!proposedDate) {
      return NextResponse.json({ error: "PROPOSAL_DATE_INVALID" }, { status: 400 });
    }
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      requestedVia: true, // GUEST 직접 발주면 수락 시 자동 확정(CONFIRMED)
      bookingId: true, // 운영자 인앱 알림 딥링크(/bookings/{id})용
      vendorId: true,
      vendorStatus: true,
      catalogItemId: true,
      vendorName: true,
      // 발주 요약(운영자 ko 통지용) — 일정·수량·발주액(costVnd=벤더 정산액, 운영자 정당 열람)
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
  // propose는 "수락하되 시간만 협의" — vendorStatus는 VENDOR_ACCEPTED, 제안 필드만 추가 기록.
  //   vendorProposalRespondedAt=null(미해결)이라 운영자가 적용/무시 전까지 고객확정 차단.
  const newStatus = action === "reject" ? "VENDOR_REJECTED" : "VENDOR_ACCEPTED";
  const trimmedNote = proposalNote?.trim() || null;
  // ★게스트 직접 발주 자동 확정 — accept(단순 수락)이고 GUEST 발주의 REQUESTED면 status=CONFIRMED로.
  //   propose(시간 협의)는 제외 — 일정 미확정이라 운영자 조율 후 확정. 파트너/운영자 발주도 제외(현행 유지).
  const autoConfirm =
    action === "accept" && order.requestedVia === "GUEST" && order.status === "REQUESTED";
  // ★동시성 가드 — PENDING_VENDOR였던 스냅샷(order.vendorStatus) 위에서만 응답 반영. 동시 수락+거절 시
  //   count===0 → 409로 차단해 last-writer-wins와 이중 운영자 통지를 막는다.
  //   자동 확정 시 where에 status=REQUESTED도 넣어 운영자 동시 취소(CANCELLED)와의 레이스를 DB가 판정.
  const responded = await prisma.serviceOrder.updateMany({
    where: {
      id,
      vendorId,
      vendorStatus: order.vendorStatus,
      ...(autoConfirm ? { status: "REQUESTED" as const } : {}),
    },
    data: {
      vendorStatus: newStatus,
      vendorRespondedAt: now,
      vendorRejectReason: action === "reject" ? rejectReason?.trim() || null : null,
      ...(autoConfirm ? { status: "CONFIRMED" as const } : {}),
      ...(action === "propose"
        ? {
            proposedServiceDate: proposedDate,
            proposedServiceTime: proposedServiceTime || null,
            vendorProposalNote: trimmedNote,
            vendorProposalRespondedAt: null, // 미해결 — 게스트 승인/거절·운영자 적용/무시로 채워짐
            vendorProposalOutcome: null, // ADR-0035 — 재제안이면 이전 결과(DECLINED 등) 스냅샷 리셋
          }
        : {}),
    },
  });
  if (responded.count === 0) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  // 운영자(테오)들에게 가부 통지 — Zalo(연결 운영자) + 인앱(전원). 티켓 발행=수락 겸행과 공용 헬퍼.
  //   ★ 누수: 판매가·마진 없음(품목·빌라·업체·제안 일정·거절 사유·정산액만).
  await sendVendorResponseOperatorNotifications({
    action,
    vendorNameKo: order.vendor?.nameKo ?? null,
    vendorName: order.vendor?.name ?? null,
    itemName,
    villaName: order.booking?.villa?.name ?? null,
    bookingId: order.bookingId,
    serviceDate: order.serviceDate,
    serviceTime: order.serviceTime,
    quantity: order.quantity,
    costVnd: order.costVnd,
    rejectReason: action === "reject" ? rejectReason : null,
    proposedServiceDate: action === "propose" ? proposedServiceDate ?? null : null,
    proposedServiceTime: action === "propose" ? proposedServiceTime ?? null : null,
    proposalNote: action === "propose" ? trimmedNote : null,
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      vendorStatus: { old: order.vendorStatus, new: newStatus },
      vendorRespondedAt: { new: now.toISOString() },
      // 게스트 직접 발주 자동 확정 — status 전이 기록(운영자 개입 없이 CONFIRMED)
      ...(autoConfirm ? { status: { old: "REQUESTED", new: "CONFIRMED" } } : {}),
      ...(action === "reject" ? { vendorRejectReason: { new: rejectReason?.trim() || null } } : {}),
      ...(action === "propose"
        ? {
            proposedServiceDate: { new: proposedServiceDate ?? null },
            proposedServiceTime: { new: proposedServiceTime || null },
            vendorProposalNote: { new: trimmedNote },
          }
        : {}),
    },
  });

  return NextResponse.json({ id, vendorStatus: newStatus, action });
}
