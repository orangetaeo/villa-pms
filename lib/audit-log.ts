import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";

type AuditAction = "CREATE" | "UPDATE" | "DELETE";

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
