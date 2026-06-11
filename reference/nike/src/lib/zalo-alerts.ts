// [SHARED-MODULE] from Nike src/lib/zalo-alerts.ts
/**
 * Zalo OA 알람 — 재사용 가능한 공통 알람 함수 모듈
 *
 * 사용처:
 *   - sync-inventory.ts: KV sync 큰 변동 알람 (Phase 1)
 *   - (예정) sync-approvals: 승인 대기 알람 (Phase 2)
 *
 * 정책:
 *   - fire-and-forget — 알람 실패가 본 작업 실패로 전파되지 않도록 호출자가 catch
 *   - ZALO_ALERT_GROUP_ID 미설정 시 silently skip (개발 환경 대응)
 *   - 활성 ZaloAccount의 userId로 전송 (lastConnected DESC)
 */
import prisma from "@/lib/prisma";
import { sendZaloMessage } from "@/lib/zalo";
import { ensureConnectionForUser } from "@/lib/zalo-pool";

export interface SyncChange {
  productCode: string;
  productSize?: string | null;
  beforeQty: number;
  afterQty: number;
  delta: number;
}

export interface InventorySyncAlertPayload {
  source: "cron" | "webhook";
  appliedLargeChanges: SyncChange[];
  heldLargeChanges: SyncChange[];
}

/**
 * 큰 sync 변동 발생 시 Zalo OA 그룹 알람
 *
 * - 적용된 큰 변동(|Δ|≥10 또는 ≥50%) + 보류된 큰 변동을 묶음 메시지로 발송
 * - 변동이 없으면 발송하지 않음
 * - 환경변수 ZALO_ALERT_GROUP_ID 미설정 시 silently skip
 */
export async function sendInventorySyncAlert(
  payload: InventorySyncAlertPayload
): Promise<{ sent: boolean; reason?: string }> {
  const { source, appliedLargeChanges, heldLargeChanges } = payload;
  if (appliedLargeChanges.length === 0 && heldLargeChanges.length === 0) {
    return { sent: false, reason: "no_large_changes" };
  }

  const groupId = process.env.ZALO_ALERT_GROUP_ID || process.env.ZALO_NOTIFICATION_GROUP_ID;
  if (!groupId) {
    return { sent: false, reason: "no_group_id" };
  }

  const account = await prisma.zaloAccount.findFirst({
    where: { isActive: true },
    orderBy: { lastConnected: "desc" },
    select: { userId: true },
  });
  if (!account?.userId) {
    return { sent: false, reason: "no_active_account" };
  }

  const lines: string[] = [
    `⚠️ [Nike Store] KV sync 큰 변동 감지 (${source})`,
    "",
  ];

  if (appliedLargeChanges.length > 0) {
    lines.push(`[적용됨] ${appliedLargeChanges.length}건 (자동 적용 — 매장 확인 권장):`);
    const top = appliedLargeChanges.slice(0, 10);
    for (const c of top) {
      const sizeSeg = c.productSize ? ` (${c.productSize})` : "";
      const deltaSeg = c.delta > 0 ? `+${c.delta}` : String(c.delta);
      lines.push(`  ${c.productCode}${sizeSeg}: ${c.beforeQty} → ${c.afterQty} (${deltaSeg})`);
    }
    if (appliedLargeChanges.length > 10) {
      lines.push(`  ... 외 ${appliedLargeChanges.length - 10}건`);
    }
    lines.push("");
  }

  if (heldLargeChanges.length > 0) {
    lines.push(`[보류] ${heldLargeChanges.length}건 (다음 사이클 재확인):`);
    const top = heldLargeChanges.slice(0, 10);
    for (const c of top) {
      const sizeSeg = c.productSize ? ` (${c.productSize})` : "";
      const deltaSeg = c.delta > 0 ? `+${c.delta}` : String(c.delta);
      lines.push(`  ${c.productCode}${sizeSeg}: local ${c.beforeQty} vs KV ${c.afterQty} (${deltaSeg})`);
    }
    if (heldLargeChanges.length > 10) {
      lines.push(`  ... 외 ${heldLargeChanges.length - 10}건`);
    }
    lines.push("");
  }

  lines.push(
    `시간: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Ho_Chi_Minh" })}`
  );

  try {
    await ensureConnectionForUser(account.userId);
    await sendZaloMessage(account.userId, groupId, lines.join("\n"), undefined, undefined, true);
    return { sent: true };
  } catch (e) {
    console.error("[zalo-alerts] sendInventorySyncAlert 실패:", e);
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 큰 변동 판정 (sync-inventory.ts와 동일 임계값)
 */
export function isLargeSyncChange(beforeQty: number, afterQty: number): boolean {
  if (beforeQty <= 0) return false;
  const delta = Math.abs(afterQty - beforeQty);
  if (delta >= 10) return true;
  if (delta / beforeQty >= 0.5) return true;
  return false;
}
