// /api/service-orders/[id]/apply-proposal — 공급자 일정 제안 적용/무시 (ADR-0023 S2 §4.3 확장)
//   POST: Role=isOperator. body {apply:boolean}.
//   apply=true  → serviceDate/serviceTime ← 제안값(proposedServiceDate/Time), vendorProposalRespondedAt=now.
//   apply=false → 제안 필드는 보존하되 vendorProposalRespondedAt=now(해결 표시)만.
//   해결되면 미해결 게이트가 풀려 운영자가 고객확정(CONFIRMED) 가능.
//   ★ 동시성: updateMany where {id, vendorProposalRespondedAt:null} — 이미 처리된 제안 재처리 차단(0건→409).
//   ★ 누수: 운영자 전용. 응답에 판매가·마진 없음(제안은 일정 협의일 뿐).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { toDateOnlyString } from "@/lib/date-vn";
import { enqueueInAppNotification, buildVendorNotifText } from "@/lib/inapp-notification";

const bodySchema = z.object({ apply: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const actorId = g.session.user.id;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { apply } = parsed.data;

  const existing = await prisma.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      serviceDate: true,
      serviceTime: true,
      proposedServiceDate: true,
      proposedServiceTime: true,
      vendorProposalRespondedAt: true,
      quantity: true,
      catalogItemId: true,
      vendorName: true,
      vendor: { select: { userId: true } },
      booking: { select: { villa: { select: { name: true } } } },
    },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // 제안 자체가 없으면 처리할 게 없음.
  if (existing.proposedServiceDate == null) {
    return NextResponse.json({ error: "NO_PROPOSAL" }, { status: 409 });
  }
  // 이미 해결된 제안은 재처리 불가(멱등·동시성 가드의 사전 빠른 응답).
  if (existing.vendorProposalRespondedAt != null) {
    return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
  }

  const now = new Date();
  const data: Record<string, unknown> = { vendorProposalRespondedAt: now };
  if (apply) {
    // 적용 — 제안 일정으로 실 일정 교체(@db.Date·HH:MM 그대로).
    data.serviceDate = existing.proposedServiceDate;
    data.serviceTime = existing.proposedServiceTime;
  }

  // ★동시성 가드 — vendorProposalRespondedAt이 여전히 null인 행만 갱신. 다른 요청이 먼저 해결했으면 0건→409.
  const res = await prisma.serviceOrder.updateMany({
    where: { id, vendorProposalRespondedAt: null },
    data,
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
  }

  const proposedDateStr = toDateOnlyString(existing.proposedServiceDate);

  // 제안 결과를 공급자에게 인앱 회신(vendor-gaps-p1 계약 B) — 적용/무시 어느 쪽이든 공급자가 결과를 알아야 함.
  //   InAppNotification.type은 String이라 enum 변경 없음. try/catch 격리(회신 실패가 본 처리를 깨지 않음).
  if (existing.vendor?.userId) {
    try {
      const item = existing.catalogItemId
        ? await prisma.serviceCatalogItem.findUnique({
            where: { id: existing.catalogItemId },
            select: { nameKo: true },
          })
        : null;
      const notifType = apply ? "VENDOR_PROPOSAL_APPLIED" : "VENDOR_PROPOSAL_DISMISSED";
      const { title, body } = buildVendorNotifText(notifType, {
        itemName: item?.nameKo ?? existing.vendorName ?? null,
        villaName: existing.booking?.villa?.name ?? null,
        // 적용 시 확정된 새 일정(=제안값), 무시 시 유지되는 기존 일정.
        serviceDate: apply
          ? proposedDateStr
          : existing.serviceDate
            ? toDateOnlyString(existing.serviceDate)
            : null,
        serviceTime: apply ? existing.proposedServiceTime ?? null : existing.serviceTime ?? null,
      });
      await enqueueInAppNotification({
        userId: existing.vendor.userId,
        type: notifType,
        title,
        body,
        href: "/vendor",
      });
    } catch {
      // 인앱 회신 실패는 제안 처리 성공을 막지 않는다.
    }
  }
  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      vendorProposalRespondedAt: { new: now.toISOString() },
      proposalApplied: { new: apply },
      ...(apply
        ? {
            serviceDate: {
              old: existing.serviceDate ? toDateOnlyString(existing.serviceDate) : null,
              new: proposedDateStr,
            },
            serviceTime: {
              old: existing.serviceTime ?? null,
              new: existing.proposedServiceTime ?? null,
            },
          }
        : {}),
    },
  });

  return NextResponse.json({ id, applied: apply });
}
