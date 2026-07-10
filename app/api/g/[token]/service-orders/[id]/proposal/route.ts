// POST /api/g/[token]/service-orders/[id]/proposal — 게스트 시간 제안 응답 (ADR-0035)
//   비로그인(토큰). 벤더가 propose(대안 시간)한 GUEST 주문을 게스트가 승인/거절.
//   ★ 해결 주체 = 소비자(운영자 apply-proposal은 대리 처리로 유지). 게스트 알림 채널 없음 → 페이지 내 확인.
//   accept → 제안 일정으로 교체 + status REQUESTED→CONFIRMED 원자(벤더는 이미 VENDOR_ACCEPTED, ADR-0033 일관).
//   decline → vendorStatus VENDOR_ACCEPTED→PENDING_VENDOR 복귀(발주함 재노출, 벤더 재응답). outcome 스냅샷 기록.
//   동시성: updateMany where 스냅샷 가드 — 운영자 apply-proposal과 레이스 시 한쪽만 승리(count=0→409).
//   ★ 누수: 판매가·마진·bankInfo 신규 노출 없음. 벤더에는 이름·일정만 통보(costVnd 미포함).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit } from "@/lib/guest-rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { toDateOnlyString } from "@/lib/date-vn";
import {
  enqueueInAppNotification,
  enqueueInAppForOperators,
  buildVendorNotifText,
  buildAdminNotifText,
  vendorNotifLocale,
} from "@/lib/inapp-notification";
import { enqueueNotification } from "@/lib/zalo";
import { NotificationType } from "@prisma/client";

const bodySchema = z.object({ action: z.enum(["accept", "decline"]) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  // 비인증 게스트 mutation 폭주 방어 (보안 P0-3)
  const rl = await guestRateLimit("g-service-order-proposal", token, req);
  if (rl) return rl;
  const csrf = await assertSameOrigin(req, "g-service-order-proposal");
  if (csrf) return csrf;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { action } = parsed.data;

  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  // 교차검증 — 토큰 예약 소속 + 게스트 신청(requestedVia=GUEST)만. 아니면 404(id 추측 방지).
  //   벤더 관계 select — 통보용(★ bankInfo·costVnd 미포함, 누수 0).
  const order = await prisma.serviceOrder.findFirst({
    where: { id, bookingId: t.bookingId, requestedVia: "GUEST" },
    select: {
      id: true,
      status: true,
      vendorStatus: true,
      serviceDate: true, // 원래 일정(거절 시 복귀 통보용)
      serviceTime: true,
      proposedServiceDate: true, // 제안 일정(승인 시 확정)
      proposedServiceTime: true,
      vendorProposalRespondedAt: true,
      catalogItemId: true,
      vendorName: true,
      bookingId: true,
      vendor: { select: { userId: true, user: { select: { zaloUserId: true, locale: true } } } },
      booking: { select: { villa: { select: { name: true } } } },
    },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  // 제안 자체가 없으면 처리할 게 없음.
  if (order.proposedServiceDate == null) {
    return NextResponse.json({ error: "NO_PROPOSAL" }, { status: 409 });
  }
  // 이미 해결된 제안(운영자 apply-proposal 또는 앞선 게스트 응답) — 재처리 불가.
  if (order.vendorProposalRespondedAt != null) {
    return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
  }
  // 취소된 주문은 응답 불가.
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "ORDER_CANCELLED" }, { status: 409 });
  }

  const now = new Date();

  // ── 원자 전이 (동시성 가드: respondedAt=null 스냅샷 위에서만) ──
  let res;
  if (action === "accept") {
    // 승인 — 제안 일정으로 교체 + 고객확정(CONFIRMED). 벤더는 이미 VENDOR_ACCEPTED(propose 경로).
    //   where에 status=REQUESTED — 운영자 동시 취소/확정 레이스를 DB가 판정(count=0→409).
    res = await prisma.serviceOrder.updateMany({
      where: { id, vendorProposalRespondedAt: null, status: "REQUESTED" },
      data: {
        serviceDate: order.proposedServiceDate,
        serviceTime: order.proposedServiceTime,
        vendorProposalRespondedAt: now,
        vendorProposalOutcome: "APPLIED",
        status: "CONFIRMED",
      },
    });
  } else {
    // 거절 — 발주 사이클 복귀(PENDING_VENDOR). where에 vendorStatus=VENDOR_ACCEPTED로 propose 스냅샷 가드.
    //   ★status=REQUESTED도 필수(accept와 대칭) — 운영자가 그 사이 취소하면 status만 CANCELLED가 되고
    //     vendorStatus는 VENDOR_ACCEPTED로 불변이다. status 가드가 없으면 count=1로 통과해 CANCELLED 주문에
    //     PENDING_VENDOR+DECLINED가 덧씌워지고 벤더에게 유령 재응답 통보가 나간다. status 가드로 그 레이스를
    //     DB가 원자 판정(count=0→409).
    res = await prisma.serviceOrder.updateMany({
      where: { id, vendorProposalRespondedAt: null, vendorStatus: "VENDOR_ACCEPTED", status: "REQUESTED" },
      data: {
        vendorProposalRespondedAt: now,
        vendorProposalOutcome: "DECLINED",
        vendorStatus: "PENDING_VENDOR",
      },
    });
  }
  if (res.count === 0) {
    return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
  }

  const applied = action === "accept";
  const originalDateStr = order.serviceDate ? toDateOnlyString(order.serviceDate) : null;
  const proposedDateStr = toDateOnlyString(order.proposedServiceDate);
  // 통보 표기 일정 — 승인=확정된 제안값, 거절=복귀되는 원래값.
  const resultDate = applied ? proposedDateStr : originalDateStr;
  const resultTime = applied ? order.proposedServiceTime ?? null : order.serviceTime ?? null;

  // 벤더 통보 (count 성공 후, try/catch 격리) — 인앱(항상) + Zalo(연결 시). 판매가·마진 없음.
  if (order.vendor?.userId) {
    const notifLocale = vendorNotifLocale(order.vendor.user?.locale);
    let itemName: string | null = null;
    try {
      const item = order.catalogItemId
        ? await prisma.serviceCatalogItem.findUnique({
            where: { id: order.catalogItemId },
            select: { nameKo: true },
          })
        : null;
      itemName = item?.nameKo ?? order.vendorName ?? null;
      const notifType = applied ? "VENDOR_PROPOSAL_APPLIED" : "VENDOR_PROPOSAL_DECLINED";
      const { title, body } = buildVendorNotifText(
        notifType,
        {
          itemName,
          villaName: order.booking?.villa?.name ?? null,
          serviceDate: resultDate,
          serviceTime: resultTime,
        },
        notifLocale
      );
      await enqueueInAppNotification({
        userId: order.vendor.userId,
        type: notifType,
        title,
        body,
        href: "/vendor",
      });
    } catch {
      // 인앱 회신 실패는 제안 처리 성공을 막지 않는다.
    }
    if (order.vendor.user?.zaloUserId) {
      try {
        await enqueueNotification({
          userId: order.vendor.userId,
          type: NotificationType.VENDOR_PROPOSAL_RESULT,
          payload: {
            applied,
            // 거절=고객 거절 분기(zalo 빌더가 발주함 복귀 문구로 전환, 구 payload 하위호환)
            ...(applied ? {} : { declinedByGuest: true }),
            locale: notifLocale,
            itemName: itemName ?? order.vendorName ?? "—",
            villaName: order.booking?.villa?.name ?? "—",
            serviceDate: resultDate,
            serviceTime: resultTime,
          },
        });
      } catch {
        // Zalo 큐 적재 실패도 본 처리를 깨지 않는다.
      }
    }
  }

  // 운영자 인앱 정보 알림 — 현황 인지(딥링크 /bookings/{id}). try/catch 격리.
  try {
    const item = order.catalogItemId
      ? await prisma.serviceCatalogItem.findUnique({
          where: { id: order.catalogItemId },
          select: { nameKo: true },
        })
      : null;
    const kind = applied ? "GUEST_PROPOSAL_ACCEPTED" : "GUEST_PROPOSAL_DECLINED";
    const { title, body } = buildAdminNotifText(kind, {
      vendorName: order.vendorName ?? null,
      itemName: item?.nameKo ?? order.vendorName ?? null,
      villaName: order.booking?.villa?.name ?? null,
      proposedServiceDate: proposedDateStr,
      proposedServiceTime: order.proposedServiceTime ?? null,
    });
    await enqueueInAppForOperators({ type: kind, title, body, href: `/bookings/${order.bookingId}` });
  } catch {
    // 운영자 알림 실패는 본 처리를 막지 않는다.
  }

  await writeAuditLog({
    db: prisma,
    userId: null,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      via: { new: "GUEST_PROPOSAL_RESPONSE" },
      action: { new: action },
      vendorProposalOutcome: { new: applied ? "APPLIED" : "DECLINED" },
      vendorProposalRespondedAt: { new: now.toISOString() },
      ...(applied
        ? {
            status: { old: "REQUESTED", new: "CONFIRMED" },
            serviceDate: { old: originalDateStr, new: proposedDateStr },
            serviceTime: { old: order.serviceTime ?? null, new: order.proposedServiceTime ?? null },
          }
        : {
            vendorStatus: { old: "VENDOR_ACCEPTED", new: "PENDING_VENDOR" },
          }),
    },
  });

  return NextResponse.json({ id, action, applied, status: applied ? "CONFIRMED" : order.status });
}
