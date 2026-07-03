// /api/vendor/orders/[id]/respond — 원천 공급자 발주 가부 응답 (ADR-0023 S2 §4.3)
//   POST: Role=VENDOR + 본인 vendorId 스코프(서버 강제). PENDING_VENDOR만 응답 가능.
//   action=accept→VENDOR_ACCEPTED, reject→VENDOR_REJECTED(+사유),
//   propose→VENDOR_ACCEPTED(수락하되 대안 시간 제안: proposedServiceDate/Time·메모 기록).
//   응답 후 운영자(테오)에게 Zalo 통지. propose는 운영자가 적용/무시해야 고객확정 가능(미해결 게이트).
//   ★ 누수: 타 공급자 발주 접근 차단(vendorId 불일치 시 404). 응답에 판매가·마진 없음.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isVendor, OPERATOR_ROLES, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { assertVendorResponse, InvalidVendorResponseError } from "@/lib/vendor-order";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { enqueueNotification } from "@/lib/zalo";
import { buildAdminNotifText, enqueueInAppForOperators, type AdminNotifKind } from "@/lib/inapp-notification";
import { NotificationType } from "@prisma/client";

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
      bookingId: true, // 운영자 인앱 알림 딥링크(/bookings/{id})용
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
  // propose는 "수락하되 시간만 협의" — vendorStatus는 VENDOR_ACCEPTED, 제안 필드만 추가 기록.
  //   vendorProposalRespondedAt=null(미해결)이라 운영자가 적용/무시 전까지 고객확정 차단.
  const newStatus = action === "reject" ? "VENDOR_REJECTED" : "VENDOR_ACCEPTED";
  const trimmedNote = proposalNote?.trim() || null;
  await prisma.serviceOrder.update({
    where: { id },
    data: {
      vendorStatus: newStatus,
      vendorRespondedAt: now,
      vendorRejectReason: action === "reject" ? rejectReason?.trim() || null : null,
      ...(action === "propose"
        ? {
            proposedServiceDate: proposedDate,
            proposedServiceTime: proposedServiceTime || null,
            vendorProposalNote: trimmedNote,
            vendorProposalRespondedAt: null, // 운영자 미해결 — 적용/무시로 채워짐
          }
        : {}),
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
    // accepted: accept/propose 모두 수락 계열(true), reject만 false — 기존 분기 보존.
    accepted: action !== "reject",
    action, // "accept" | "reject" | "propose" — zalo 빌더 분기용
    itemName,
    villaName: order.booking?.villa?.name ?? "—",
    rejectReason: action === "reject" ? rejectReason?.trim() || undefined : undefined,
    // propose 전용 — 제안 일정·메모(운영자 ko 통지용)
    proposedServiceDate: action === "propose" ? proposedServiceDate ?? undefined : undefined,
    proposedServiceTime: action === "propose" ? proposedServiceTime || undefined : undefined,
    proposalNote: action === "propose" ? trimmedNote || undefined : undefined,
  };
  for (const op of operators) {
    await enqueueNotification({
      userId: op.id,
      type: NotificationType.VENDOR_PO_RESPONSE,
      payload,
    });
  }

  // 운영자 인앱 알림(벨) — Zalo 미연결 운영자도 인지(admin-vendor-ops C). 적재 실패는 본 응답에 영향 0.
  //   ★ 금액(판매가·costVnd) 미포함 — 품목·빌라·업체·제안 일정·거절 사유만.
  try {
    const kindByAction: Record<typeof action, AdminNotifKind> = {
      accept: "VENDOR_ACCEPTED",
      reject: "VENDOR_REJECTED",
      propose: "VENDOR_PROPOSED",
    };
    const kind = kindByAction[action];
    const { title, body: notifBody } = buildAdminNotifText(kind, {
      vendorName: order.vendor?.nameKo || order.vendor?.name,
      itemName,
      villaName: order.booking?.villa?.name,
      proposedServiceDate: action === "propose" ? proposedServiceDate : null,
      proposedServiceTime: action === "propose" ? proposedServiceTime : null,
      rejectReason: action === "reject" ? rejectReason : null,
    });
    await enqueueInAppForOperators({
      type: kind,
      title,
      body: notifBody,
      href: `/bookings/${order.bookingId}`,
    });
  } catch {
    // 무시 — 알림 적재 실패가 가부 응답을 깨지 않게
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
