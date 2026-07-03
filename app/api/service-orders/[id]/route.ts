// /api/service-orders/[id] — 부가서비스 주문 상태 전이·확정 (ADR-0019 S2)
//   PATCH: 상태 전이(REQUESTED→CONFIRMED→DELIVERED, 종결 전 CANCELLED) + 확정 시 원가·판매가 조정.
//   원가(costVnd)·판매가 조정은 canViewFinance(돈 경계). 상태만 바꾸는 건 isOperator.
//   상태 전이표는 lib/service-order.ts 재사용(단일 소스).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, type Role } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { assertServiceTransition, InvalidServiceTransitionError } from "@/lib/service-order";
import { canConfirmCustomer, vendorHasLivePo } from "@/lib/vendor-order";
import { enqueueNotification } from "@/lib/zalo";
import { enqueueInAppNotification, buildVendorNotifText, vendorNotifLocale } from "@/lib/inapp-notification";
import { toDateOnlyString } from "@/lib/date-vn";
import { NotificationType, type ServiceOrderStatus } from "@prisma/client";

const patchSchema = z.object({
  status: z.enum(["REQUESTED", "CONFIRMED", "DELIVERED", "CANCELLED"]).optional(),
  // 확정 시 운영자 원가·판매가 조정(canViewFinance) — 모두 선택
  costVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional().nullable(),
  priceVnd: z.string().regex(/^\d{1,15}$/).optional().nullable(),
  vendorName: z.string().max(100).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  // ADR-0023 S2 — 발주 건별 정산(canViewFinance 전용)
  markSettled: z.boolean().optional(),
  vendorSettleMethod: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]).optional(),
  vendorSettleNote: z.string().max(500).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role as Role | undefined;
  const actorId = session.user.id;
  const canFinance = canViewFinance(role);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  // 돈 필드는 canViewFinance만 — STAFF가 보내면 거부(가격·원가·정산 변경은 돈 경계)
  const touchesMoney =
    d.costVnd !== undefined ||
    d.priceKrw !== undefined ||
    d.priceVnd !== undefined ||
    d.markSettled !== undefined ||
    d.vendorSettleMethod !== undefined ||
    d.vendorSettleNote !== undefined;
  if (touchesMoney && !canFinance) {
    return NextResponse.json({ error: "FORBIDDEN_FINANCE" }, { status: 403 });
  }

  const existing = await prisma.serviceOrder.findUnique({
    where: { id },
    // 제안 2필드 포함 — 미해결 일정제안이면 canConfirmCustomer가 CONFIRMED 차단(서버측 게이트, 일정협의)
    select: {
      id: true,
      status: true,
      vendorId: true,
      vendorStatus: true,
      proposedServiceDate: true,
      vendorProposalRespondedAt: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (d.status && d.status !== existing.status) {
    try {
      assertServiceTransition(existing.status, d.status as ServiceOrderStatus);
    } catch (e) {
      if (e instanceof InvalidServiceTransitionError) {
        return NextResponse.json(
          { error: "INVALID_TRANSITION", from: e.from, to: e.to },
          { status: 409 }
        );
      }
      throw e;
    }
    // 고객확정 추가 게이트(ADR-0023 §4.3) — 발주 공급자가 수락 전이면 CONFIRMED 차단
    if (d.status === "CONFIRMED" && !canConfirmCustomer(existing)) {
      return NextResponse.json(
        { error: "VENDOR_NOT_ACCEPTED", vendorStatus: existing.vendorStatus },
        { status: 409 }
      );
    }
    data.status = d.status;
  }
  if (canFinance) {
    if (d.costVnd !== undefined) data.costVnd = d.costVnd ? BigInt(d.costVnd) : 0n;
    if (d.priceKrw !== undefined && d.priceKrw !== null) data.priceKrw = d.priceKrw;
    if (d.priceVnd !== undefined) data.priceVnd = d.priceVnd ? BigInt(d.priceVnd) : null;
    // 발주 건별 정산(ADR-0023 §4.4)
    if (d.markSettled === true) {
      data.vendorSettledAt = new Date();
      if (d.vendorSettleMethod !== undefined) data.vendorSettleMethod = d.vendorSettleMethod;
      if (d.vendorSettleNote !== undefined) data.vendorSettleNote = d.vendorSettleNote?.trim() || null;
    } else if (d.markSettled === false) {
      data.vendorSettledAt = null;
      data.vendorSettleMethod = null;
      data.vendorSettleNote = null;
    } else {
      // markSettled 미지정이어도 method·note만 갱신 허용(이미 정산된 건 보정)
      if (d.vendorSettleMethod !== undefined) data.vendorSettleMethod = d.vendorSettleMethod;
      if (d.vendorSettleNote !== undefined) data.vendorSettleNote = d.vendorSettleNote?.trim() || null;
    }
  }
  if (d.vendorName !== undefined) data.vendorName = d.vendorName?.trim() || null;
  if (d.note !== undefined) data.note = d.note?.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ id, changed: false });
  }

  await prisma.serviceOrder.update({ where: { id }, data });

  // ★발주된 주문 취소 → 원천 공급자에게 Zalo 취소 통보(vi). 공급자가 살아있는 발주(PENDING_VENDOR·
  //   VENDOR_ACCEPTED)로 준비 중일 수 있으므로 stale PO 방지. 게스트 취소 경로는 발주건을 차단하므로
  //   여기가 유일한 통보 지점. zaloUserId 연결된 공급자에만 큐 적재(미연결이면 통보 생략).
  let vendorNotified = false;
  const isCancelNotify = data.status === "CANCELLED" && vendorHasLivePo(existing);
  // ★발주 건별 정산 완료(markSettled=true)도 공급자에게 통보 — 본인 지급액(costVnd) 인앱 알림.
  const isSettledNotify = d.markSettled === true;
  if (isCancelNotify || isSettledNotify) {
    const info = await prisma.serviceOrder.findUnique({
      where: { id },
      select: {
        quantity: true,
        serviceDate: true,
        catalogItemId: true,
        vendorName: true,
        costVnd: true, // 정산 통보용 — 공급자 본인 지급액(우리 판매가·마진 아님)
        vendor: { select: { userId: true, user: { select: { zaloUserId: true, locale: true } } } },
        booking: { select: { villa: { select: { name: true } } } },
      },
    });
    const vendorUserId = info?.vendor?.userId;
    const vendorZalo = info?.vendor?.user?.zaloUserId;
    const notifLocale = vendorNotifLocale(info?.vendor?.user?.locale);
    // 카탈로그 항목명(공급자 vi 통지용) — catalogItemId는 관계 미정의 스칼라라 별도 조회.
    const item = info?.catalogItemId
      ? await prisma.serviceCatalogItem.findUnique({
          where: { id: info.catalogItemId },
          select: { nameKo: true },
        })
      : null;
    const itemName = item?.nameKo ?? info?.vendorName ?? "—";
    const villaName = info?.booking?.villa?.name ?? "—";
    const serviceDate = info?.serviceDate ? toDateOnlyString(info.serviceDate) : null;

    // 발주 취소 — Zalo(연결 시) + 인앱.
    if (isCancelNotify && vendorUserId && vendorZalo) {
      await enqueueNotification({
        userId: vendorUserId,
        type: NotificationType.VENDOR_PO_CANCELLED,
        payload: { itemName, quantity: info?.quantity ?? 0, villaName, serviceDate },
      });
      vendorNotified = true;
    }

    // 인앱 알림센터 적재(Zalo 미연결 공급자도 앱에서 인지). ★ 누수: 가격·마진 없음(정산은 본인 지급액만).
    //   try/catch 격리 — 알림 적재 실패가 본 상태 전이/정산 로직을 깨지 않게.
    if (vendorUserId) {
      if (isCancelNotify) {
        try {
          const { title, body } = buildVendorNotifText(NotificationType.VENDOR_PO_CANCELLED, {
            itemName,
            quantity: info?.quantity ?? 0,
            villaName,
            serviceDate,
          }, notifLocale);
          await enqueueInAppNotification({
            userId: vendorUserId,
            type: NotificationType.VENDOR_PO_CANCELLED,
            title,
            body,
            href: "/vendor",
          });
        } catch {
          // 무시 — 본 로직 영향 0
        }
      }
      if (isSettledNotify) {
        try {
          const { title, body } = buildVendorNotifText("VENDOR_SETTLED", {
            itemName,
            quantity: info?.quantity ?? 0,
            villaName,
            costVnd: info?.costVnd != null ? info.costVnd.toString() : null,
          }, notifLocale);
          await enqueueInAppNotification({
            userId: vendorUserId,
            type: "VENDOR_SETTLED",
            title,
            body,
            href: "/vendor",
          });
        } catch {
          // 무시 — 본 로직 영향 0
        }
      }
    }
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      ...(data.status ? { status: { old: existing.status, new: data.status } } : {}),
      ...(data.costVnd !== undefined ? { costVnd: { new: (data.costVnd as bigint).toString() } } : {}),
      ...(d.markSettled !== undefined
        ? { vendorSettledAt: { new: data.vendorSettledAt instanceof Date ? data.vendorSettledAt.toISOString() : null } }
        : {}),
      ...(data.vendorSettleMethod !== undefined
        ? { vendorSettleMethod: { new: data.vendorSettleMethod } }
        : {}),
      ...(vendorNotified ? { vendorPoCancelNotified: { new: true } } : {}),
    },
  });
  return NextResponse.json({ id, changed: true, ...(vendorNotified ? { vendorNotified: true } : {}) });
}
