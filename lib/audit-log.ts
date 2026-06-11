import { prisma } from "@/lib/prisma";

type AuditAction = "CREATE" | "UPDATE" | "DELETE";

interface WriteAuditLogParams {
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  changes?: Record<string, { old?: unknown; new?: unknown }>;
}

export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  await prisma.auditLog.create({
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
