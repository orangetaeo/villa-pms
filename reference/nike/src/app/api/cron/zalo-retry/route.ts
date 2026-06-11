// [SHARED-MODULE] from Nike src/app/api/cron/zalo-retry/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendZaloMessage, ensureConnection } from "@/lib/zalo";
import logger from "@/lib/logger";

import { withRequestLog } from "@/lib/request-log";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/zalo-retry
 * zaloNotified=false인 이동요청을 모아서 배치 Zalo 메시지 발송.
 * AUTO: 여러 건을 하나의 메시지로 그룹핑 (10분 간격 크론)
 * MANUAL/RETURN: 개별 발송
 */
async function handler(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const pending = await prisma.stockTransfer.findMany({
    where: {
      zaloNotified: false,
      createdAt: { gte: cutoff },
    },
    include: {
      items: {
        include: {
          product: {
            select: {
              code: true,
              name: true,
              sizeEU: true,
              sizeKR: true,
              category: { select: { name: true } },
              inventory: { select: { warehouseQty: true } },
            },
          },
        },
      },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (pending.length === 0) {
    return NextResponse.json({ success: true, retried: 0 });
  }

  // Zalo 계정: OWNER 우선, 없으면 아무 활성 계정
  const zaloAccount =
    (await prisma.zaloAccount.findFirst({
      where: { isActive: true, user: { role: "OWNER" } },
      select: { userId: true },
    })) ||
    (await prisma.zaloAccount.findFirst({
      where: { isActive: true },
      select: { userId: true },
    }));

  if (!zaloAccount?.userId) {
    return NextResponse.json({ success: false, error: "활성 Zalo 계정 없음" });
  }

  const config = await prisma.syncConfig.findUnique({
    where: { key: "stock-transfer-zalo-group" },
  });
  const groupId = (config?.metadata as { groupId?: string } | null)?.groupId;
  if (!groupId) {
    return NextResponse.json({ success: false, error: "Zalo 그룹 미설정" });
  }

  const autoTransfers = pending.filter((t) => t.type === "AUTO");
  const otherTransfers = pending.filter((t) => t.type !== "AUTO");

  let success = 0;
  let failed = 0;

  try {
    await ensureConnection(zaloAccount.userId);
  } catch (err) {
    console.error("[ZaloRetry] Zalo 연결 실패:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Zalo 연결 실패" });
  }

  const cta = "👉 Vui lòng kiểm tra tại trang Yêu cầu chuyển hàng";

  // ── AUTO: 단일 배치 메시지 (카테고리 합계 + CTA만) ──
  if (autoTransfers.length > 0) {
    let shoeQty = 0;
    let otherQty = 0;
    for (const transfer of autoTransfers) {
      for (const item of transfer.items) {
        const category =
          (item.product as { category?: { name: string } | null }).category?.name || "";
        if (category === "신발") shoeQty += item.requestedQty;
        else otherQty += item.requestedQty;
      }
    }

    const summaryParts: string[] = [];
    if (shoeQty > 0) summaryParts.push(`Giày: ${shoeQty} đôi`);
    if (otherQty > 0) summaryParts.push(`Quần áo & phụ kiện: ${otherQty} cái`);
    const summary =
      summaryParts.join(" / ") || `${autoTransfers.reduce((s, t) => s + t.items.length, 0)} SP`;

    const message = `🔔 Tự động bổ sung (${autoTransfers.length} yêu cầu)\n━━━━━━━━━━\n${summary}\n━━━━━━━━━━\n${cta}`;

    let sent = false;
    try {
      await sendZaloMessage(zaloAccount.userId, groupId, message, undefined, undefined, true);
      logger.info(`[ZaloRetry] AUTO 배치 발송 성공: ${autoTransfers.length}건`);
      sent = true;
    } catch (err) {
      console.error("[ZaloRetry] AUTO 배치 발송 실패:", err instanceof Error ? err.message : err);
    }

    // 발송 성공하면 전부 notified 처리 (중복 발송 방지 우선)
    if (sent) {
      await prisma.stockTransfer.updateMany({
        where: { id: { in: autoTransfers.map((t) => t.id) } },
        data: { zaloNotified: true },
      });
      logger.info(`[ZaloRetry] AUTO ${autoTransfers.length}건 zaloNotified=true`);
      success += autoTransfers.length;
    } else {
      failed += autoTransfers.length;
    }
  }

  // ── MANUAL/RETURN: 개별 발송 (카테고리 합계 + CTA만) ──
  for (const transfer of otherTransfers) {
    let shoeQty = 0;
    let otherQty = 0;
    for (const item of transfer.items) {
      const category =
        (item.product as { category?: { name: string } | null }).category?.name || "";
      if (category === "신발") shoeQty += item.requestedQty;
      else otherQty += item.requestedQty;
    }

    const summaryParts: string[] = [];
    if (shoeQty > 0) summaryParts.push(`Giày: ${shoeQty} đôi`);
    if (otherQty > 0) summaryParts.push(`Quần áo & phụ kiện: ${otherQty} cái`);
    const summary = summaryParts.join(" / ") || `${transfer.items.length} SP`;

    const requester = transfer.requestedBy?.name || "";
    const headerMap: Record<string, string> = {
      MANUAL: `📋 Yêu cầu chuyển hàng — ${requester}`,
      RETURN: `↩ Trả hàng về kho — ${requester}`,
    };
    const header = headerMap[transfer.type] || `📋 ${requester}`;
    const message = `${header}\n━━━━━━━━━━\n${summary}\n━━━━━━━━━━\n${cta}`;

    try {
      await sendZaloMessage(zaloAccount.userId, groupId, message, undefined, undefined, true);
      await prisma.stockTransfer.update({
        where: { id: transfer.id },
        data: { zaloNotified: true },
      });
      logger.info(`[ZaloRetry] ${transfer.type} 발송 성공: ${transfer.id}`);
      success++;
    } catch (err) {
      console.error(
        `[ZaloRetry] ${transfer.type} 발송 실패: ${transfer.id}`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  return NextResponse.json({ success: true, retried: success, failed, total: pending.length });
}

export const GET = withRequestLog(handler);
