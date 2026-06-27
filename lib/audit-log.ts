import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";

// 표준 변경 액션 + 공개(게스트) 특수 신호. AuditLog.action 컬럼은 자유 String이라 스키마 변경 없음.
// GUEST_PAYMENT_NOTICE: 제안 게스트가 계좌이체 후 "입금했어요" 신호(B1). 상태 전이 아님 — 운영자 수동 확정 대조용.
type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "GUEST_PAYMENT_NOTICE";

interface WriteAuditLogParams {
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  changes?: Record<string, { old?: unknown; new?: unknown }>;
  /** 트랜잭션 안에서 원자적으로 기록할 때 tx 주입 (기본: 전역 prisma) */
  db?: DbClient;
}

export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  const db = params.db ?? prisma;
  await db.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      // Prisma Json 컬럼: Record<string, ...>를 InputJsonValue로 캐스팅
      changes: params.changes
        ? (params.changes as Parameters<typeof prisma.auditLog.create>[0]["data"]["changes"])
        : undefined,
    },
  });
}
